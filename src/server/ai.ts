import { promises as fs } from "node:fs";
import path from "node:path";
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

export async function openChatStream(
  endpoint: EndpointConfig,
  messages: Array<{
    role: string;
    content: string | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
  }>,
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

/** Answer and reasoning text of one streamed chat-completion chunk; servers name the reasoning field differently. */
export function streamDelta(chunk: unknown) {
  const delta = (chunk as { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }> } | null)
    ?.choices?.[0]?.delta;
  return { content: delta?.content || "", reasoning: delta?.reasoning_content || delta?.reasoning || "" };
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
  /** False when the endpoint does not describe itself and these are SparklingKit's defaults. */
  reported: boolean;
}

export const DEFAULT_IMAGE_SIZES: ImageSizeOption[] = [
  { value: "1024x1024", label: "Square", ratio: "1:1", quality: "standard" },
  { value: "1536x1024", label: "Landscape", ratio: "3:2", quality: "standard" },
  { value: "1024x1536", label: "Portrait", ratio: "2:3", quality: "standard" },
];

/** Reads the SparklingKit image adapter's /v1/capabilities; other OpenAI-compatible servers get the defaults. */
export async function imageCapabilities(endpoint: EndpointConfig, signal?: AbortSignal): Promise<ImageCapabilities> {
  const fallback: ImageCapabilities = { sizes: DEFAULT_IMAGE_SIZES, reported: false };
  try {
    const response = await fetch(url(endpoint.baseUrl, "capabilities"), { headers: headers(endpoint, false), signal: requestSignal(5000, signal) });
    if (!response.ok) return fallback;
    const payload = (await response.json()) as { model?: unknown; sizes?: unknown; defaultSteps?: unknown; maxSteps?: unknown };
    const sizes = (Array.isArray(payload.sizes) ? payload.sizes : []).flatMap((size): ImageSizeOption[] => {
      const { value, label, ratio, quality } = (size || {}) as Record<string, unknown>;
      return typeof value === "string" && /^\d{3,4}x\d{3,4}$/.test(value)
        ? [{ value, label: typeof label === "string" ? label : value, ratio: typeof ratio === "string" ? ratio : "", quality: quality === "high" ? "high" : "standard" }]
        : [];
    });
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
