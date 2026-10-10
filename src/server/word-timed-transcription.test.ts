import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobManifest } from "./models.js";

// The fake ASR cannot know which chunk it is asked about, so it answers with chunk-relative times and
// transcribeAudio shifts them by the chunk's start.
const w = (word: string, start: number, end: number) => ({ word, start, end });

describe("word-timed transcripts", () => {
  let root = "";
  let server: Server | undefined;
  const previousDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sparklingkit-word-timed-"));
    process.env.DATA_DIR = root;
    vi.resetModules();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) || resolve());
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
    vi.resetModules();
  });

  async function runAudioJob({ model, seconds, respond, audio = {}, seed }: {
    model: string;
    seconds: number;
    respond: (request: number) => Record<string, unknown>;
    audio?: Record<string, unknown>;
    seed?: (workFolder: string) => Promise<void>;
  }) {
    let requests = 0;
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        requests += 1;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(respond(requests)));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");

    const store = await import("./store.js");
    const media = await import("./media.js");
    await store.initializeData();
    const settings = await store.readSettings();
    await store.writeSettings({
      ...settings,
      endpoints: { ...settings.endpoints, stt: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model, apiKey: "" } },
      audio: { ...settings.audio, chunkTargetSec: 15, chunkOverlapSec: 1, maxCompletionTokens: 512, requestTimeoutSec: 5, ...audio },
      queue: { ...settings.queue, maxRetriesPerChunk: 0 },
    });

    const id = "word-timed-job";
    const jobRoot = store.jobDir(id);
    await Promise.all(["input", "work", "output"].map((folder) => fs.mkdir(path.join(jobRoot, folder), { recursive: true })));
    const input = path.join(jobRoot, "input", "001-source.wav");
    await media.runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", String(seconds), "-c:a", "pcm_s16le", input], 5000);
    const now = new Date().toISOString();
    const job: JobManifest = {
      id,
      type: "audio",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      title: "Source.wav",
      progress: 0,
      stage: "Waiting for a worker",
      inputs: [{ name: "Source.wav", storedName: "001-source.wav", mimeType: "audio/wav", size: (await fs.stat(input)).size }],
      outputFiles: [],
      warnings: [],
      params: {},
    };
    await store.atomicWriteJson(path.join(jobRoot, "job.json"), job);

    await seed?.(path.join(jobRoot, "work"));
    const processor = await import("./processor.js");
    await processor.processJob(id);

    expect((await store.readJob(id)).status).toBe("done");
    const output = (name: string) => fs.readFile(path.join(jobRoot, "output", name), "utf8");
    return {
      json: JSON.parse(await output("transcript.json")) as { text: string; segments: Array<{ start: number; end: number; text: string }>; words?: unknown[] },
      srt: await output("transcript.srt"),
      md: await output("transcript.md"),
      requests,
    };
  }

  it("writes one line per sentence, short cues and the words when the ASR returns word times", async () => {
    const { json, srt, md, requests } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 40,
      respond: () => ({ text: "Hello. Again.", words: [w("Hello.", 0.2, 0.6), w("Again.", 2.0, 2.4)] }),
    });
    expect(requests).toBeGreaterThan(1);
    expect(json.segments.map((segment) => segment.text)).toEqual(Array(requests).fill(["Hello.", "Again."]).flat());
    expect(json.words).toHaveLength(2 * requests);
    expect(srt.match(/ --> /g)).toHaveLength(2 * requests);
    expect(md).toContain("Hello. Again.");
  });

  it("keeps word-timed output when one chunk has no speech", async () => {
    const { json, requests } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 40,
      respond: (request) => (request === 2 ? { text: "", words: [] } : { text: "Hello. Again.", words: [w("Hello.", 0.2, 0.6), w("Again.", 2.0, 2.4)] }),
    });
    expect(requests).toBeGreaterThan(2);
    expect(json.words).toHaveLength(2 * (requests - 1));
    expect(json.segments).toHaveLength(2 * (requests - 1));
  });

  it("joins the halves' words when a difficult chunk is split", async () => {
    const { json } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 20,
      audio: { adaptiveSplit: true, minAdaptiveChunkSec: 5 },
      respond: (request) => {
        if (request === 1) return { text: "repeated-block!".repeat(24) };
        return request === 2 ? { text: "Left.", words: [w("Left.", 0.2, 0.6)] } : { text: "Right.", words: [w("Right.", 0.2, 0.6)] };
      },
    });
    expect(json.segments.map((segment) => segment.text)).toEqual(["Left.", "Right."]);
    // Today each half contributes a chunk-wide segment with the same text; the word times tell the two apart.
    expect(json.words).toHaveLength(2);
    expect(json.segments[0].start).toBeCloseTo(0.2, 1);
    expect(json.segments[1].start).toBeCloseTo(9.2, 1);
  });

  it("keeps today's output when one half of a split chunk has text but no words", async () => {
    const { json, requests } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 20,
      audio: { adaptiveSplit: true, minAdaptiveChunkSec: 5 },
      respond: (request) => {
        if (request === 1) return { text: "repeated-block!".repeat(24) };
        return request === 2 ? { text: "Left.", words: [w("Left.", 0.2, 0.6)] } : { text: "Right.", words: [] };
      },
    });
    expect(requests).toBe(3);
    expect(json.words).toBeUndefined();
    expect(json.segments.map((segment) => segment.text)).toEqual(["Left.", "Right."]);
  });

  it("keeps one segment per chunk and no words for models without word times", async () => {
    const { json, requests } = await runAudioJob({
      model: "test-asr",
      seconds: 40,
      respond: () => ({ text: "Plain words." }),
    });
    expect(requests).toBeGreaterThan(1);
    expect(json.words).toBeUndefined();
    expect(json.segments).toHaveLength(requests);
  });

  it("keeps the text when a Parakeet endpoint returns no word times at all", async () => {
    const { json, md, requests } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 40,
      respond: () => ({ text: "Plain words." }),
    });
    expect(requests).toBeGreaterThan(1);
    expect(json.words).toBeUndefined();
    expect(json.segments).toHaveLength(requests);
    expect(md).toContain("Plain words.");
  });

  it("keeps today's output when one chunk has text but no words", async () => {
    const { json, md, requests } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 40,
      respond: (request) => (request === 2 ? { text: "Lost words.", words: [] } : { text: "Hello. Again.", words: [w("Hello.", 0.2, 0.6), w("Again.", 2.0, 2.4)] }),
    });
    expect(requests).toBeGreaterThan(2);
    expect(json.words).toBeUndefined();
    expect(json.segments).toHaveLength(requests);
    expect(md).toContain("Lost words.");
  });

  it("keeps one segment per chunk when a checkpoint from before word times has none", async () => {
    const { json, requests } = await runAudioJob({
      model: "Parakeet-TDT-0.6B-v3",
      seconds: 40,
      respond: () => ({ text: "Hello. Again.", words: [w("Hello.", 0.2, 0.6), w("Again.", 2.0, 2.4)] }),
      seed: (work) => fs.writeFile(path.join(work, "transcript-0002.json"), JSON.stringify({ text: "Old checkpoint.", segments: [{ start: 14, end: 30, text: "Old checkpoint." }] })),
    });
    expect(requests).toBe(2);
    expect(json.words).toBeUndefined();
    expect(json.segments.map((segment) => segment.text)).toEqual(["Hello. Again.", "Old checkpoint.", "Hello. Again."]);
  });
});
