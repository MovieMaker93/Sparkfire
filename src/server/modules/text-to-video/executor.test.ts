import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4 = Buffer.concat([Buffer.from("ftypmp42"), Buffer.alloc(512, 3)]);

describe("text-to-video executor", () => {
  let root = "";
  let requests: Array<Record<string, unknown>> = [];
  let baseUrl = "";
  /** When set, the fake service holds every answer until it settles, like a long generation. */
  let gate: Promise<void> | undefined;
  const previousDataDir = process.env.DATA_DIR;
  const closers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sparkfire-video-run-"));
    process.env.DATA_DIR = root;
    vi.resetModules();
    requests = [];
    gate = undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", async () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        await gate;
        response.writeHead(200, { "Content-Type": "video/mp4", "X-Model": "FastH3", "X-Seed": "42", "X-Variant": "fast", "X-Frames": "124", "X-Disclosure": "AI-generated with MiniMax H3 (FastH3)" });
        response.end(MP4);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
    vi.resetModules();
  });

  async function setup() {
    const store = await import("../../store.js");
    await store.initializeData();
    const settings = await store.readSettings();
    settings.endpoints["video-generation"] = { baseUrl, model: "FastH3", apiKey: "", enabled: true };
    await store.writeSettings(settings);
    const { processTextToVideo } = await import("./executor.js");
    return { store, processTextToVideo };
  }

  it("generates from a prompt and an uploaded first frame and records what produced the video", async () => {
    const { store, processTextToVideo } = await setup();
    const upload = path.join(root, "tmp", "upload-1");
    await fs.writeFile(upload, PNG);
    const job = await store.createTextToVideoJob("A paper boat drifting in the rain", { size: "864x480", duration: 5, variant: "fast", sound: "rain on tin" }, {
      path: upload, originalname: "Boat.PNG", mimetype: "image/png", size: PNG.length,
    } as Express.Multer.File);
    expect(job.moduleId).toBe("text-to-video");
    expect(job.artifacts.map((artifact) => [artifact.name, artifact.kind])).toEqual([["Prompt.txt", "text"], ["Boat.PNG", "source-image"]]);
    expect(job.runs[0].inputArtifactIds).toHaveLength(2);

    const result = await processTextToVideo(job, job.runs[0]);
    expect(result.outputFiles).toEqual(["generated-video.mp4"]);
    expect(await fs.readFile(store.safeOutputPath(job.id, "generated-video.mp4"))).toEqual(MP4);
    expect(requests[0]).toMatchObject({ prompt: "A paper boat drifting in the rain", size: "864x480", duration: 5, variant: "fast", sound: "rain on tin" });
    expect(requests[0].first_frame).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    const run = (await store.readJob(job.id)).runs[0];
    expect(run.params).toMatchObject({ model: "FastH3", seed: 42, variant: "fast", frames: 124, firstFrameArtifactId: job.artifacts[1].id, disclosure: "AI-generated with MiniMax H3 (FastH3)" });
  });

  it("animates a generated image with the prompt that made it", async () => {
    const { store, processTextToVideo } = await setup();
    const created = await store.createTextToImageJob("Neon harbor at dawn, long exposure");
    await fs.writeFile(store.safeOutputPath(created.id, "generated-image.png"), PNG);
    const withImage = await store.updateJob(created.id, { outputFiles: ["generated-image.png"] });
    const image = withImage.artifacts.find((artifact) => artifact.kind === "generated-image")!;
    const { job, run } = await store.createWorkflowRun(created.id, "text-to-video", "text-to-video.default", { size: "864x480", duration: 5 }, [image.id]);

    const result = await processTextToVideo(job, run);
    expect(requests[0]).toMatchObject({ prompt: "Neon harbor at dawn, long exposure", first_frame: `data:image/png;base64,${PNG.toString("base64")}` });
    expect(result.outputFiles).toEqual(["generated-image.png", "generated-video.mp4"]);
    const saved = await store.updateJob(created.id, { outputFiles: result.outputFiles });
    expect(saved.artifacts.find((artifact) => artifact.name === "generated-video.mp4")).toMatchObject({ kind: "generated-video", mimeType: "video/mp4", derivedFrom: [image.id] });
  });

  it("runs a second video only after the first, showing it waits for the GPU", async () => {
    const { store } = await setup();
    const { executeWorkflow } = await import("../executors.js");
    let release!: () => void;
    gate = new Promise((resolve) => { release = resolve; });
    const first = await store.createTextToVideoJob("A paper boat", {});
    const second = await store.createTextToVideoJob("A red kite", {});
    const firstRun = executeWorkflow("text-to-video.default", first, first.runs[0]);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const secondRun = executeWorkflow("text-to-video.default", second, second.runs[0]);
    await vi.waitFor(async () => expect((await store.readJob(second.id)).stage).toBe("Waiting for the GPU"));
    expect((await store.readJob(second.id)).detail).toMatch(/^Text to video is running/);
    expect(requests).toHaveLength(1);
    release();
    await Promise.all([firstRun, secondRun]);
    expect(requests.map((request) => request.prompt)).toEqual(["A paper boat", "A red kite"]);
  });

  it("refuses to run without a configured video service", async () => {
    const store = await import("../../store.js");
    await store.initializeData();
    const { processTextToVideo } = await import("./executor.js");
    const job = await store.createTextToVideoJob("A boat", {});
    await expect(processTextToVideo(job, job.runs[0])).rejects.toThrow(/Video generation service/);
    expect(requests).toEqual([]);
  });
});
