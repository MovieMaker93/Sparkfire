import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { EndpointConfig, EndpointHealth } from "./models.js";
import type { ChatEffort } from "../shared/contracts.js";

function url(baseUrl: string, route: string) {
  return `${baseUrl.replace(/\/$/, "")}/${route.replace(/^\//, "")}`;
}

function headers(endpoint: EndpointConfig, json = true): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
  };
}

function requestSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function responseError(response: Response) {
  const body = await response.text().catch(() => "");
  return `${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 500)}` : ""}`;
}

export async function checkEndpoint(kind: EndpointHealth["kind"], endpoint: EndpointConfig): Promise<EndpointHealth> {
  const started = performance.now();
  if (endpoint.enabled === false || !endpoint.baseUrl || !endpoint.model) {
    return {
      kind,
      enabled: false,
      ok: false,
      latencyMs: 0,
      model: endpoint.model,
      availableModels: [],
      error: "Not configured",
    };
  }
  try {
    const response = await fetch(url(endpoint.baseUrl, "models"), {
      headers: headers(endpoint, false),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return {
      kind,
      enabled: true,
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      model: endpoint.model,
      availableModels: payload.data?.flatMap((item) => (item.id ? [item.id] : [])) || [],
    };
  } catch (error) {
    return {
      kind,
      enabled: true,
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      model: endpoint.model,
      availableModels: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function chatCompletion(
  endpoint: EndpointConfig,
  messages: Array<{ role: string; content: unknown }>,
  params: { temperature?: number; maxTokens?: number; extraBody?: Record<string, unknown> } = {},
  signal?: AbortSignal,
) {
  const response = await fetch(url(endpoint.baseUrl, "chat/completions"), {
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify({
      model: endpoint.model,
      messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 4096,
      stream: false,
      ...params.extraBody,
    }),
    signal: requestSignal(10 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  const message = payload.choices?.[0]?.message;
  const content = message?.content?.trim();
  if (!content) throw new Error("The endpoint returned no content");
  return content;
}

export interface OcrBlock {
  label: string;
  /** Pixel box on the page image: x1, y1, x2, y2. */
  bbox: [number, number, number, number];
  text: string;
}

export interface OcrPage {
  markdown: string;
  width?: number;
  height?: number;
  blocks: OcrBlock[];
}

export type OcrProfile = "unlimited-ocr" | "paddleocr-vl";

/**
 * OCR models differ in prompt, transport and output format, so each has a profile chosen by the
 * configured model id. Unlimited-OCR stays the default for unknown ids.
 */
export function ocrProfile(model: string): OcrProfile {
  return /paddleocr/i.test(model) ? "paddleocr-vl" : "unlimited-ocr";
}

export async function ocrPage(endpoint: EndpointConfig, file: string, pageLabel: string, signal?: AbortSignal): Promise<OcrPage> {
  if (ocrProfile(endpoint.model) === "paddleocr-vl") return paddleOcrPage(endpoint, file, pageLabel, signal);
  return { markdown: await unlimitedOcrPage(endpoint, file, pageLabel, signal), blocks: [] };
}

export async function ocrImage(endpoint: EndpointConfig, file: string, pageLabel: string, signal?: AbortSignal) {
  return (await ocrPage(endpoint, file, pageLabel, signal)).markdown;
}

function imageMime(file: string) {
  const extension = path.extname(file).slice(1).toLowerCase();
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
}

/** PaddleOCR-VL runs behind services/dgx-models/paddleocr-vl, which adds layout detection and returns Markdown plus blocks. */
async function paddleOcrPage(endpoint: EndpointConfig, file: string, pageLabel: string, signal?: AbortSignal): Promise<OcrPage> {
  const bytes = await fs.readFile(file);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: imageMime(file) }), path.basename(file));
  const serviceRoot = endpoint.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const response = await fetch(`${serviceRoot}/v1/ocr`, {
    method: "POST",
    headers: headers(endpoint, false),
    body: form,
    signal: requestSignal(10 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as { markdown?: unknown; width?: unknown; height?: unknown; blocks?: unknown };
  const markdown = typeof payload.markdown === "string" ? payload.markdown.trim() : "";
  if (!markdown) throw new Error(`The OCR endpoint returned no text for ${pageLabel}`);
  const dimension = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
  const blocks = (Array.isArray(payload.blocks) ? payload.blocks : []).flatMap((block): OcrBlock[] => {
    const { label, bbox, text } = (block || {}) as { label?: unknown; bbox?: unknown; text?: unknown };
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((value) => typeof value === "number" && Number.isFinite(value))) return [];
    return [{ label: typeof label === "string" ? label : "text", bbox: bbox as OcrBlock["bbox"], text: typeof text === "string" ? text : "" }];
  });
  return { markdown, width: dimension(payload.width), height: dimension(payload.height), blocks };
}

async function unlimitedOcrPage(endpoint: EndpointConfig, file: string, pageLabel: string, signal?: AbortSignal) {
  const bytes = await fs.readFile(file);
  const mime = imageMime(file);
  const output = await chatCompletion(
    endpoint,
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "document parsing.",
          },
          { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } },
        ],
      },
    ],
    {
      temperature: 0,
      maxTokens: 8192,
      extraBody: { skip_special_tokens: false, images_config: { image_mode: "gundam" } },
    },
    signal,
  );
  return cleanOcrOutput(output, pageLabel);
}

function cleanOcrOutput(value: string, pageLabel: string) {
  const cleaned = value
    .replace(/(?:<\|det\|>)?title\s*\[[^\]]+\](?:<\|\/det\|>)?/gi, "# ")
    .replace(/(?:<\|det\|>)?[a-z_]+\s*\[[^\]]+\](?:<\|\/det\|>)?/gi, "")
    .replace(/<\|[^|]+\|>/g, "")
    .trim();
  if (!cleaned) throw new Error(`The OCR endpoint returned no text for ${pageLabel}`);
  return cleaned;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// One recognised word with absolute times in seconds, as ASR models that report word timestamps return it.
export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

export type AsrProfile = "parakeet" | "default";

/**
 * Speech models differ in what the transcription endpoint accepts, so the configured model id picks a profile.
 * Parakeet reports word timestamps; every other id keeps the plain request that Qwen3-ASR needs.
 */
export function asrProfile(model: string): AsrProfile {
  return /parakeet/i.test(model) ? "parakeet" : "default";
}

export async function transcribeAudio(
  endpoint: EndpointConfig,
  file: string,
  offset = 0,
  options: { maxCompletionTokens?: number; timeoutMs?: number } = {},
  signal?: AbortSignal,
): Promise<{ text: string; segments: TranscriptSegment[]; words?: TimedWord[] }> {
  const profile = asrProfile(endpoint.model);
  const bytes = await fs.readFile(file);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), path.basename(file));
  form.append("model", endpoint.model);
  // Qwen3-ASR (default profile) supports the OpenAI JSON response but not verbose_json, so chunk boundaries
  // provide subtitle timing when the server omits segments. Parakeet (the adapter forwards both fields to its
  // engine) gets verbose_json plus word granularity, so sentences and cues can follow the speech itself.
  if (profile === "parakeet") {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
  } else {
    form.append("response_format", "json");
  }
  form.append("temperature", "0");
  if (options.maxCompletionTokens) form.append("max_completion_tokens", String(options.maxCompletionTokens));
  const response = await fetch(url(endpoint.baseUrl, "audio/transcriptions"), {
    method: "POST",
    headers: headers(endpoint, false),
    body: form,
    signal: requestSignal(options.timeoutMs || 20 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  type RawWord = { word?: unknown; start?: unknown; end?: unknown };
  const payload = (await response.json()) as {
    text?: string;
    segments?: Array<{ start?: number; end?: number; text?: string; words?: RawWord[] }>;
    words?: RawWord[];
  };
  const text = cleanAsrText(payload.text || "");
  const segments: TranscriptSegment[] = (payload.segments || [])
    .filter((segment) => segment.text)
    .map((segment) => ({
      start: offset + (segment.start || 0),
      end: offset + (segment.end || segment.start || 0),
      text: segment.text!.trim(),
    }));
  if (profile !== "parakeet") return { text, segments };
  // Servers put the words either next to the segments (Parakeet's adapter) or inside each segment (OpenAI style).
  const rawWords = Array.isArray(payload.words) && payload.words.length
    ? payload.words
    : (payload.segments || []).flatMap((segment) => (Array.isArray(segment.words) ? segment.words : []));
  const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const words = rawWords.flatMap((entry): TimedWord[] => {
    // parakeet.cpp writes <unk> for characters it cannot spell ("13°"); its own text leaves them out, and the
    // lines are built from these words.
    const word = typeof entry?.word === "string" ? entry.word.replaceAll("<unk>", "").trim() : "";
    if (!word) return [];
    const start = offset + (seconds(entry.start) ?? 0);
    return [{ word, start, end: offset + (seconds(entry.end) ?? seconds(entry.start) ?? 0) }];
  });
  return { text, segments, words };
}

/** Qwen3-ASR prefixes each stretch of audio it hears with "language X<asr_text>"; long chunks carry several. */
export function cleanAsrText(value: string) {
  return value
    .replace(/language\s+[^<\r\n]{1,40}<asr_text>/gi, " ")
    .replace(/<\/?asr_text>/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}

/** A tool call as the model asked for it, its arguments still a JSON string. */
export interface ModelToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A chat-completion message, including the assistant turns that call tools and the tool results sent back. */
export type ChatCompletionMessage =
  | {
    role: string;
    content: string | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
  }
  | { role: "assistant"; content: string; tool_calls: ModelToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export async function openChatStream(
  endpoint: EndpointConfig,
  messages: ChatCompletionMessage[],
  temperature: number,
  signal?: AbortSignal,
  extraBody: Record<string, unknown> = {},
) {
  const response = await fetch(url(endpoint.baseUrl, "chat/completions"), {
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify({ model: endpoint.model, messages, temperature, stream: true, ...extraBody }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok) throw new Error(await responseError(response));
  if (!response.body) throw new Error("The endpoint returned no response stream");
  return response.body;
}

/**
 * Request fields for a thinking effort. Qwen3-family chat templates read `enable_thinking`; Qwen3.8 builds such
 * as Saluki also read `reasoning_effort` (low, medium, or xhigh by default). No effort keeps the model's default.
 */
export function thinkingOptions(effort?: ChatEffort): Record<string, unknown> {
  if (!effort) return {};
  if (effort === "off") return { chat_template_kwargs: { enable_thinking: false } };
  if (effort === "high") return { chat_template_kwargs: { enable_thinking: true } };
  return { chat_template_kwargs: { enable_thinking: true, reasoning_effort: effort } };
}

/** A piece of one tool call in a stream; the fragments with the same index add up to the whole call. */
export interface ToolCallFragment {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

/**
 * Answer and reasoning text of one streamed chat-completion chunk, plus any tool-call fragments; servers name the
 * reasoning field differently.
 */
export function streamDelta(chunk: unknown): { content: string; reasoning: string; toolCalls?: ToolCallFragment[] } {
  const delta = (chunk as { choices?: Array<{ delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: Array<{ index?: number; id?: string | null; function?: { name?: string | null; arguments?: string | null } }> | null;
  } }> } | null)?.choices?.[0]?.delta;
  const part = { content: delta?.content || "", reasoning: delta?.reasoning_content || delta?.reasoning || "" };
  if (!Array.isArray(delta?.tool_calls) || !delta.tool_calls.length) return part;
  const toolCalls = delta.tool_calls.map((call, position) => ({
    index: typeof call.index === "number" ? call.index : position,
    ...(call.id ? { id: call.id } : {}),
    ...(call.function?.name ? { name: call.function.name } : {}),
    ...(call.function?.arguments ? { arguments: call.function.arguments } : {}),
  }));
  return { ...part, toolCalls };
}

export interface GeneratedImageResult {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: ".png" | ".jpg" | ".webp";
  revisedPrompt?: string;
  /** Reported by the server when it can, so the gallery records what actually produced the image. */
  model?: string;
  seed?: number;
  steps?: number;
}

export interface ImageSizeOption { value: string; label: string; ratio: string; quality: "standard" | "high" }

export interface ImageCapabilities {
  model?: string;
  sizes: ImageSizeOption[];
  defaultSteps?: number;
  maxSteps?: number;
  /** False when the endpoint does not describe itself and these are Sparkfire's defaults. */
  reported: boolean;
}

export const DEFAULT_IMAGE_SIZES: ImageSizeOption[] = [
  { value: "1024x1024", label: "Square", ratio: "1:1", quality: "standard" },
  { value: "1536x1024", label: "Landscape", ratio: "3:2", quality: "standard" },
  { value: "1024x1536", label: "Portrait", ratio: "2:3", quality: "standard" },
];

/** The size list an adapter's /v1/capabilities reports, keeping only well-formed entries. */
function sizeOptions(sizes: unknown): ImageSizeOption[] {
  return (Array.isArray(sizes) ? sizes : []).flatMap((size): ImageSizeOption[] => {
    const { value, label, ratio, quality } = (size || {}) as Record<string, unknown>;
    return typeof value === "string" && /^\d{3,4}x\d{3,4}$/.test(value)
      ? [{ value, label: typeof label === "string" ? label : value, ratio: typeof ratio === "string" ? ratio : "", quality: quality === "high" ? "high" : "standard" }]
      : [];
  });
}

/** Reads the Sparkfire image adapter's /v1/capabilities; other OpenAI-compatible servers get the defaults. */
export async function imageCapabilities(endpoint: EndpointConfig, signal?: AbortSignal): Promise<ImageCapabilities> {
  const fallback: ImageCapabilities = { sizes: DEFAULT_IMAGE_SIZES, reported: false };
  try {
    const response = await fetch(url(endpoint.baseUrl, "capabilities"), { headers: headers(endpoint, false), signal: requestSignal(5000, signal) });
    if (!response.ok) return fallback;
    const payload = (await response.json()) as { model?: unknown; sizes?: unknown; defaultSteps?: unknown; maxSteps?: unknown };
    const sizes = sizeOptions(payload.sizes);
    if (!sizes.length) return fallback;
    const integer = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined);
    return { model: typeof payload.model === "string" ? payload.model : undefined, sizes, defaultSteps: integer(payload.defaultSteps), maxSteps: integer(payload.maxSteps), reported: true };
  } catch (error) {
    if (signal?.aborted) throw error;
    return fallback;
  }
}

function imageFormat(bytes: Buffer, advertised?: string | null): Pick<GeneratedImageResult, "mimeType" | "extension"> {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mimeType: "image/jpeg", extension: ".jpg" };
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { mimeType: "image/webp", extension: ".webp" };
  if (advertised?.includes("jpeg") || advertised?.includes("jpg")) return { mimeType: "image/jpeg", extension: ".jpg" };
  if (advertised?.includes("webp")) return { mimeType: "image/webp", extension: ".webp" };
  return { mimeType: "image/png", extension: ".png" };
}

export async function generateImage(
  endpoint: EndpointConfig,
  prompt: string,
  options: { size?: string; seed?: number; steps?: number } = {},
  signal?: AbortSignal,
): Promise<GeneratedImageResult> {
  const response = await fetch(url(endpoint.baseUrl, "images/generations"), {
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify({
      model: endpoint.model,
      prompt,
      n: 1,
      size: options.size || "1024x1024",
      response_format: "b64_json",
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.steps !== undefined ? { steps: options.steps } : {}),
    }),
    signal: requestSignal(30 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>; model?: unknown; seed?: unknown; steps?: unknown };
  const item = payload.data?.[0];
  if (!item) throw new Error("The image endpoint returned no image");
  let bytes: Buffer;
  let advertised: string | null | undefined;
  if (item.b64_json) {
    bytes = Buffer.from(item.b64_json, "base64");
  } else if (item.url?.startsWith("data:")) {
    const match = item.url.match(/^data:([^;,]+)?;base64,(.+)$/s);
    if (!match) throw new Error("The image endpoint returned an invalid data URL");
    advertised = match[1];
    bytes = Buffer.from(match[2], "base64");
  } else if (item.url) {
    const imageResponse = await fetch(new URL(item.url, endpoint.baseUrl), { signal: requestSignal(10 * 60_000, signal) });
    if (!imageResponse.ok) throw new Error(`Could not download the generated image: ${await responseError(imageResponse)}`);
    advertised = imageResponse.headers.get("content-type");
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  } else {
    throw new Error("The image endpoint returned neither image data nor an image URL");
  }
  if (!bytes.length) throw new Error("The image endpoint returned an empty image");
  const integer = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : undefined);
  return {
    bytes,
    ...imageFormat(bytes, advertised),
    revisedPrompt: item.revised_prompt,
    model: typeof payload.model === "string" ? payload.model : undefined,
    seed: integer(payload.seed),
    steps: integer(payload.steps),
  };
}

export interface VideoVariantOption { id: string; label: string; description: string }

export interface VideoCapabilities {
  model?: string;
  sizes: ImageSizeOption[];
  /** Clip lengths in seconds. */
  durations: number[];
  variants: VideoVariantOption[];
  defaultVariant?: string;
  /** Whether the service can start a video from an image. */
  firstFrame: boolean;
  /** The line the model's license asks shared videos to carry. */
  disclosure?: string;
  /** False when the endpoint does not describe itself and these are Sparkfire's defaults. */
  reported: boolean;
}

export const DEFAULT_VIDEO_CAPABILITIES: VideoCapabilities = {
  sizes: [{ value: "864x480", label: "480p", ratio: "16:9", quality: "standard" }],
  durations: [5],
  variants: [],
  firstFrame: false,
  reported: false,
};

/** Reads the Sparkfire video adapter's /v1/capabilities; other servers get one conservative option. */
export async function videoCapabilities(endpoint: EndpointConfig, signal?: AbortSignal): Promise<VideoCapabilities> {
  try {
    const response = await fetch(url(endpoint.baseUrl, "capabilities"), { headers: headers(endpoint, false), signal: requestSignal(5000, signal) });
    if (!response.ok) return DEFAULT_VIDEO_CAPABILITIES;
    const payload = (await response.json()) as Record<string, unknown>;
    const sizes = sizeOptions(payload.sizes);
    const durations = (Array.isArray(payload.durations) ? payload.durations : []).filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 60);
    if (!sizes.length || !durations.length) return DEFAULT_VIDEO_CAPABILITIES;
    const variants = (Array.isArray(payload.variants) ? payload.variants : []).flatMap((variant): VideoVariantOption[] => {
      const { id, label, description } = (variant || {}) as Record<string, unknown>;
      return typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id)
        ? [{ id, label: typeof label === "string" ? label : id, description: typeof description === "string" ? description : "" }]
        : [];
    });
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const defaultVariant = text(payload.defaultVariant);
    return {
      model: text(payload.model),
      sizes,
      durations,
      variants,
      defaultVariant: variants.some((variant) => variant.id === defaultVariant) ? defaultVariant : variants[0]?.id,
      firstFrame: payload.firstFrame === true,
      disclosure: text(payload.disclosure),
      reported: true,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return DEFAULT_VIDEO_CAPABILITIES;
  }
}

export interface VideoRequest {
  prompt: string;
  sound?: string;
  music?: string;
  size: string;
  duration: number;
  variant?: string;
  seed?: number;
  firstFrame?: { bytes: Buffer; mimeType: string };
}

export interface GeneratedVideoResult {
  bytes: number;
  /** Reported by the server when it can, so the gallery records what actually produced the video. */
  model?: string;
  seed?: number;
  variant?: string;
  frames?: number;
  elapsedSeconds?: number;
  /** The line the model's license asks shared outputs to carry. */
  disclosure?: string;
}

/** Tells an on-demand service to free its weights now rather than after its idle timeout. */
export async function unloadModel(endpoint: EndpointConfig, signal?: AbortSignal) {
  const response = await fetch(url(endpoint.baseUrl, "unload"), {
    method: "POST",
    headers: headers(endpoint, false),
    signal: requestSignal(2 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
}

/** Asks the video service for one video and streams the MP4 into `destination`, so it never sits in memory. */
export async function generateVideo(endpoint: EndpointConfig, request: VideoRequest, destination: string, signal?: AbortSignal): Promise<GeneratedVideoResult> {
  const response = await fetch(url(endpoint.baseUrl, "videos/generations"), {
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify({
      model: endpoint.model,
      prompt: request.prompt,
      size: request.size,
      duration: request.duration,
      ...(request.sound ? { sound: request.sound } : {}),
      ...(request.music ? { music: request.music } : {}),
      ...(request.variant ? { variant: request.variant } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.firstFrame ? { first_frame: `data:${request.firstFrame.mimeType};base64,${request.firstFrame.bytes.toString("base64")}` } : {}),
    }),
    // The service answers only once the whole video exists, which takes minutes for long or sharp clips.
    signal: requestSignal(60 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  if (!response.body || !(response.headers.get("content-type") || "").startsWith("video/")) throw new Error("The video endpoint did not return a video");
  const partial = `${destination}.part`;
  let bytes = 0;
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(partial));
    bytes = (await fs.stat(partial)).size;
    if (!bytes) throw new Error("The video endpoint returned an empty video");
    await fs.rename(partial, destination);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
  const header = (name: string) => response.headers.get(name) || undefined;
  const integer = (value?: string) => (value && /^\d+$/.test(value) ? Number(value) : undefined);
  const elapsed = Number(header("x-elapsed-seconds"));
  return {
    bytes,
    model: header("x-model"),
    seed: integer(header("x-seed")),
    variant: header("x-variant"),
    frames: integer(header("x-frames")),
    elapsedSeconds: Number.isFinite(elapsed) && elapsed > 0 ? elapsed : undefined,
    disclosure: header("x-disclosure"),
  };
}

export interface MusicCapabilities {
  model?: string;
  maxStyleChars: number;
  maxLyricsChars: number;
  /** Whether the service sings a given ABC score instead of writing one. */
  acceptsScore: boolean;
  /** The weights' license, shown with every song. */
  license?: string;
  /** False when the endpoint does not describe itself and these are Sparkfire's defaults. */
  reported: boolean;
}

export const DEFAULT_MUSIC_CAPABILITIES: MusicCapabilities = { maxStyleChars: 1000, maxLyricsChars: 20_000, acceptsScore: false, reported: false };

/** Reads the Sparkfire music adapter's /v1/capabilities; other servers get conservative defaults. */
export async function musicCapabilities(endpoint: EndpointConfig, signal?: AbortSignal): Promise<MusicCapabilities> {
  try {
    const response = await fetch(url(endpoint.baseUrl, "capabilities"), { headers: headers(endpoint, false), signal: requestSignal(5000, signal) });
    if (!response.ok) return DEFAULT_MUSIC_CAPABILITIES;
    const payload = (await response.json()) as Record<string, unknown>;
    const limit = (value: unknown, fallback: number) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback);
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    return {
      model: text(payload.model),
      maxStyleChars: limit(payload.maxStyleChars, DEFAULT_MUSIC_CAPABILITIES.maxStyleChars),
      maxLyricsChars: limit(payload.maxLyricsChars, DEFAULT_MUSIC_CAPABILITIES.maxLyricsChars),
      acceptsScore: payload.acceptsScore === true,
      license: text(payload.license),
      reported: true,
    };
  } catch {
    return DEFAULT_MUSIC_CAPABILITIES;
  }
}

export interface MusicRequest {
  style: string;
  lyrics: string;
  /** An ABC score to sing as written. */
  score?: string;
  seed?: number;
}

export interface GeneratedMusicResult {
  bytes: number;
  score: string;
  model?: string;
  seed?: number;
  durationSeconds?: number;
  elapsedSeconds?: number;
  /** Stages that ran out of room before the song ended, so the song stops early. */
  truncated: string[];
  license?: string;
}

/**
 * Asks the music service for one song. The answer is multipart: the FLAC goes to `destination`, the ABC score
 * and the metadata come back. A song of a few minutes is tens of MB, which fits in memory while it is split.
 */
export async function generateMusic(endpoint: EndpointConfig, request: MusicRequest, destination: string, signal?: AbortSignal): Promise<GeneratedMusicResult> {
  const response = await fetch(url(endpoint.baseUrl, "music/generations"), {
    method: "POST",
    headers: headers(endpoint),
    body: JSON.stringify({
      model: endpoint.model,
      style: request.style,
      lyrics: request.lyrics,
      ...(request.score ? { score: request.score } : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
    }),
    // A long song on a busy Spark took 15 minutes (docs/validation.md).
    signal: requestSignal(60 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  if (!(response.headers.get("content-type") || "").startsWith("multipart/form-data")) throw new Error("The music endpoint did not return a song");
  const form = await response.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || !audio.size) throw new Error("The music endpoint returned no audio");
  const score = form.get("score");
  const metadataPart = form.get("metadata");
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(typeof metadataPart === "string" ? metadataPart : metadataPart instanceof Blob ? await metadataPart.text() : "{}") as Record<string, unknown>;
  } catch {
    // The song is still worth keeping without its details.
  }
  const partial = `${destination}.part`;
  try {
    await fs.writeFile(partial, Buffer.from(await audio.arrayBuffer()));
    await fs.rename(partial, destination);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
  const truncated = metadata.truncated && typeof metadata.truncated === "object"
    ? Object.entries(metadata.truncated as Record<string, unknown>).filter(([, value]) => value === true).map(([stage]) => stage)
    : [];
  return {
    bytes: audio.size,
    score: typeof score === "string" ? score : score instanceof Blob ? await score.text() : "",
    model: typeof metadata.model === "string" ? metadata.model : undefined,
    seed: Number.isInteger(metadata.seed) ? Number(metadata.seed) : undefined,
    durationSeconds: number(metadata.durationSeconds),
    elapsedSeconds: number(metadata.elapsedSeconds),
    truncated,
    license: typeof metadata.license === "string" ? metadata.license : undefined,
  };
}

export interface GroundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GroundingResult {
  answer: string;
  imageWidth: number;
  imageHeight: number;
  boxes: GroundingBox[];
  points: Array<{ x: number; y: number }>;
}

export async function groundImage(
  endpoint: EndpointConfig,
  file: string,
  query: string,
  signal?: AbortSignal,
): Promise<GroundingResult> {
  const bytes = await fs.readFile(file);
  const extension = path.extname(file).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: mime }), path.basename(file));
  form.append("task", "ground_text");
  form.append("phrase", query);
  form.append("output_type", "box");
  const serviceRoot = endpoint.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const response = await fetch(`${serviceRoot}/predict-upload`, {
    method: "POST",
    headers: headers(endpoint, false),
    body: form,
    signal: requestSignal(10 * 60_000, signal),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as {
    answer?: string;
    image_width?: number;
    image_height?: number;
    boxes?: Array<{ x1?: number; y1?: number; x2?: number; y2?: number }>;
    points?: Array<{ x?: number; y?: number }>;
  };
  const imageWidth = Number(payload.image_width);
  const imageHeight = Number(payload.image_height);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("The grounding endpoint returned invalid image dimensions");
  }
  const boxes = (payload.boxes || []).flatMap((box) => {
    const values = [box.x1, box.y1, box.x2, box.y2].map(Number);
    if (!values.every(Number.isFinite)) return [];
    const [x1, y1, x2, y2] = values;
    if (x2 <= x1 || y2 <= y1) return [];
    return [{
      x1: Math.max(0, Math.min(imageWidth, x1)),
      y1: Math.max(0, Math.min(imageHeight, y1)),
      x2: Math.max(0, Math.min(imageWidth, x2)),
      y2: Math.max(0, Math.min(imageHeight, y2)),
    }];
  });
  const points = (payload.points || []).flatMap((point) => {
    const x = Number(point.x); const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
  return { answer: payload.answer || "", imageWidth, imageHeight, boxes, points };
}
