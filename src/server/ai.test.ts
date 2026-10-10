import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { asrProfile, cleanAsrText, DEFAULT_IMAGE_SIZES, generateImage, imageCapabilities, ocrPage, ocrProfile, streamDelta, thinkingOptions, transcribeAudio } from "./ai.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((work) => work())); });

describe("ASR requests", () => {
  it("sends the configured completion-token limit", async () => {
    let requestBody = "";
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requestBody = Buffer.concat(chunks).toString("utf8");
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ text: "hello" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");

    const folder = await fs.mkdtemp(path.join(tmpdir(), "sparklingkit-ai-"));
    cleanup.push(() => fs.rm(folder, { recursive: true, force: true }));
    const audio = path.join(folder, "sample.wav");
    await fs.writeFile(audio, "test audio");

    await transcribeAudio(
      { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: "test-asr", apiKey: "" },
      audio,
      0,
      { maxCompletionTokens: 777, timeoutMs: 2000 },
    );

    expect(requestBody).toContain('name="max_completion_tokens"');
    expect(requestBody).toContain("777");
  });

  it("chooses the ASR profile from the model id", () => {
    expect(asrProfile("Parakeet-TDT-0.6B-v3")).toBe("parakeet");
    expect(asrProfile("nvidia/parakeet-tdt-0.6b-v3")).toBe("parakeet");
    expect(asrProfile("Qwen3-ASR-1.7B")).toBe("default");
  });

  it("asks Parakeet for word timestamps and shifts them by the chunk offset", async () => {
    const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/parakeet-verbose.json", import.meta.url), "utf8")) as {
      words: Array<{ word: string; start: number; end: number; conf: number }>;
    };
    let body = "";
    const baseUrl = await jsonServer((_url, requestBody) => { body = requestBody; return fixture; });
    const result = await transcribeAudio({ baseUrl, model: "Parakeet-TDT-0.6B-v3", apiKey: "" }, await audioFile(), 60, { timeoutMs: 2000 });
    expect(body).toContain('name="response_format"');
    expect(body).toContain("verbose_json");
    expect(body).toContain('name="timestamp_granularities[]"');
    expect(body).toMatch(/name="timestamp_granularities\[\]"\r\n\r\nword\r\n/);
    expect(result.words!.length).toBe(fixture.words.length);
    expect(result.words![0]).toEqual({ word: fixture.words[0].word.trim(), start: fixture.words[0].start + 60, end: fixture.words[0].end + 60 });
    expect(Object.keys(result.words![0]).sort()).toEqual(["end", "start", "word"]);
  });

  it("reads words nested in segments and drops empty ones", async () => {
    const baseUrl = await jsonServer(() => ({
      text: "Hi",
      segments: [{ start: 0, end: 1, text: "Hi", words: [{ word: " Hi ", start: 0.1, end: 0.3 }, { word: "", start: 0.4, end: 0.5 }] }],
    }));
    const result = await transcribeAudio({ baseUrl, model: "Parakeet-TDT-0.6B-v3", apiKey: "" }, await audioFile(), 10, { timeoutMs: 2000 });
    expect(result.words).toEqual([{ word: "Hi", start: 10.1, end: 10.3 }]);
  });

  it("drops Parakeet's <unk> marks from words", async () => {
    // parakeet.cpp writes <unk> for characters it cannot spell ("13°"); its own text already leaves them out.
    const baseUrl = await jsonServer(() => ({
      text: "13 posto",
      words: [{ word: "13<unk>", start: 0, end: 0.5 }, { word: "<unk>", start: 0.5, end: 0.6 }, { word: "posto", start: 0.6, end: 1 }],
    }));
    const result = await transcribeAudio({ baseUrl, model: "Parakeet-TDT-0.6B-v3", apiKey: "" }, await audioFile(), 0, { timeoutMs: 2000 });
    expect(result.words!.map((word) => word.word)).toEqual(["13", "posto"]);
  });

  it("returns no words for a silent Parakeet chunk and defaults a missing end to the start", async () => {
    const silent = await jsonServer(() => ({ text: "", segments: [] }));
    const quiet = await transcribeAudio({ baseUrl: silent, model: "Parakeet-TDT-0.6B-v3", apiKey: "" }, await audioFile(), 5, { timeoutMs: 2000 });
    expect(quiet.words).toEqual([]);
    const clipped = await jsonServer(() => ({ text: "Go", words: [{ word: "Go", start: 1.5 }] }));
    const result = await transcribeAudio({ baseUrl: clipped, model: "Parakeet-TDT-0.6B-v3", apiKey: "" }, await audioFile(), 5, { timeoutMs: 2000 });
    expect(result.words).toEqual([{ word: "Go", start: 6.5, end: 6.5 }]);
  });

  it("keeps the plain JSON request for other models", async () => {
    let body = "";
    const baseUrl = await jsonServer((_url, requestBody) => { body = requestBody; return { text: "hello", words: [{ word: "hello", start: 0, end: 1 }] }; });
    const result = await transcribeAudio({ baseUrl, model: "test-asr", apiKey: "" }, await audioFile(), 0, { timeoutMs: 2000 });
    expect(body).not.toContain("timestamp_granularities");
    expect(body).not.toContain("verbose_json");
    expect(result.words).toBeUndefined();
  });
});

async function audioFile() {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "sparklingkit-asr-"));
  cleanup.push(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "chunk.wav");
  await fs.writeFile(file, "test audio");
  return file;
}

async function jsonServer(handler: (url: string, body: string) => unknown) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(handler(request.url || "", Buffer.concat(chunks).toString("utf8"))));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function pageImage() {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "sparklingkit-ocr-"));
  cleanup.push(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, "page-1.png");
  await fs.writeFile(file, "png bytes");
  return file;
}

describe("OCR profiles", () => {
  it("chooses the profile from the model id", () => {
    expect(ocrProfile("Unlimited-OCR")).toBe("unlimited-ocr");
    expect(ocrProfile("PaddlePaddle/PaddleOCR-VL-1.6")).toBe("paddleocr-vl");
    expect(ocrProfile("something-else")).toBe("unlimited-ocr");
  });

  it("keeps the Unlimited-OCR request and strips its detection tags", async () => {
    let seen = { url: "", body: "" };
    const baseUrl = await jsonServer((url, body) => {
      seen = { url, body };
      return { choices: [{ message: { content: "<|det|>title [10, 20, 30, 40]<|/det|>Report\n<|det|>text [1, 2, 3, 4]<|/det|>Body text" } }] };
    });
    const page = await ocrPage({ baseUrl, model: "Unlimited-OCR", apiKey: "", enabled: true }, await pageImage(), "page 1");
    expect(seen.url).toBe("/v1/chat/completions");
    expect(JSON.parse(seen.body)).toMatchObject({ model: "Unlimited-OCR", images_config: { image_mode: "gundam" } });
    expect(page).toEqual({ markdown: "# Report\nBody text", blocks: [] });
  });

  it("reads Markdown and valid layout blocks from the PaddleOCR-VL adapter", async () => {
    let seen = { url: "", body: "" };
    const baseUrl = await jsonServer((url, body) => {
      seen = { url, body };
      return { markdown: "## Total\n\n| Item | Price |", width: 1240, height: 1754, blocks: [
        { label: "title", bbox: [80, 60, 600, 110], text: "Total" },
        { label: "table", bbox: [80, 140, 1100, "x"], text: "bad box" },
        { bbox: [1, 2, 3, 4] },
      ] };
    });
    const page = await ocrPage({ baseUrl, model: "PaddleOCR-VL-1.6", apiKey: "", enabled: true }, await pageImage(), "page 1");
    expect(seen.url).toBe("/v1/ocr");
    expect(seen.body).toContain('name="image"');
    expect(page).toEqual({ markdown: "## Total\n\n| Item | Price |", width: 1240, height: 1754, blocks: [
      { label: "title", bbox: [80, 60, 600, 110], text: "Total" },
      { label: "text", bbox: [1, 2, 3, 4], text: "" },
    ] });
  });
});

describe("image generation", () => {
  it("reads the adapter's capabilities and falls back to the defaults", async () => {
    const baseUrl = await jsonServer((url) => url === "/v1/capabilities"
      ? { model: "Qwen-Image-2.1", defaultSteps: 40, maxSteps: 60, sizes: [{ value: "1024x1024", label: "Square", ratio: "1:1", quality: "standard" }, { value: "2048x2048", label: "Square", ratio: "1:1", quality: "high" }, { value: "huge" }] }
      : {});
    const reported = await imageCapabilities({ baseUrl, model: "Qwen-Image-2.1", apiKey: "", enabled: true });
    expect(reported).toMatchObject({ model: "Qwen-Image-2.1", defaultSteps: 40, maxSteps: 60, reported: true });
    expect(reported.sizes.map((size) => `${size.value}:${size.quality}`)).toEqual(["1024x1024:standard", "2048x2048:high"]);
    const silent = await jsonServer(() => ({ unrelated: true }));
    expect(await imageCapabilities({ baseUrl: silent, model: "x", apiKey: "", enabled: true })).toEqual({ sizes: DEFAULT_IMAGE_SIZES, reported: false });
  });

  it("sends seed and steps and reports what the server used", async () => {
    let body = "";
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const baseUrl = await jsonServer((_url, requestBody) => { body = requestBody; return { model: "Z-Image-Turbo", seed: 7, steps: 9, data: [{ b64_json: png }] }; });
    const result = await generateImage({ baseUrl, model: "configured-name", apiKey: "", enabled: true }, "a harbor", { size: "1536x1024", seed: 7, steps: 9 });
    expect(JSON.parse(body)).toMatchObject({ prompt: "a harbor", size: "1536x1024", seed: 7, steps: 9 });
    expect(result).toMatchObject({ model: "Z-Image-Turbo", seed: 7, steps: 9, mimeType: "image/png" });
  });
});

describe("chat thinking", () => {
  it("maps each effort onto the chat template switches", () => {
    expect(thinkingOptions()).toEqual({});
    expect(thinkingOptions("off")).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(thinkingOptions("low")).toEqual({ chat_template_kwargs: { enable_thinking: true, reasoning_effort: "low" } });
    expect(thinkingOptions("medium")).toEqual({ chat_template_kwargs: { enable_thinking: true, reasoning_effort: "medium" } });
    // High leaves the effort to the model's default (xhigh on Qwen3.8), which older templates also accept.
    expect(thinkingOptions("high")).toEqual({ chat_template_kwargs: { enable_thinking: true } });
  });

  it("reads answer and reasoning text from either server's stream chunks", () => {
    expect(streamDelta({ choices: [{ delta: { content: "Hi" } }] })).toEqual({ content: "Hi", reasoning: "" });
    expect(streamDelta({ choices: [{ delta: { reasoning_content: "Let me think" } }] })).toEqual({ content: "", reasoning: "Let me think" });
    expect(streamDelta({ choices: [{ delta: { reasoning: "Hmm", content: null } }] })).toEqual({ content: "", reasoning: "Hmm" });
    expect(streamDelta({ object: "bookkeeping" })).toEqual({ content: "", reasoning: "" });
    expect(streamDelta(null)).toEqual({ content: "", reasoning: "" });
  });
});

describe("ASR text cleanup", () => {
  it("removes Qwen3-ASR language tags wherever they appear", () => {
    expect(cleanAsrText("language English<asr_text>Hello there.</asr_text>")).toBe("Hello there.");
    // A long chunk can switch windows mid-text; the tag used to leak into the transcript.
    expect(cleanAsrText("is really.language English<asr_text>Greek, after all")).toBe("is really. Greek, after all");
    expect(cleanAsrText("<asr_text>Ciao a tutti.</asr_text>")).toBe("Ciao a tutti.");
    expect(cleanAsrText("We study the language English speakers use.")).toBe("We study the language English speakers use.");
  });
});
