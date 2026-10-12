import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(256, 7)]);
const SCORE = "X:1\nT:\nM:4/4\nL:1/8\nK:C\nV: Vocal\nCDEF GABc|\n";

/** The music adapter's answer: the FLAC, the score and the metadata as multipart/form-data. */
function multipart(metadata: Record<string, unknown>, score = SCORE) {
  const boundary = "sparkfire-test";
  const part = (name: string, type: string, body: Buffer, filename?: string) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}\r\nContent-Type: ${type}\r\n\r\n`),
    body,
    Buffer.from("\r\n"),
  ]);
  return {
    type: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      part("metadata", "application/json", Buffer.from(JSON.stringify(metadata))),
      part("score", "text/vnd.abc; charset=utf-8", Buffer.from(score), "score.abc"),
      part("audio", "audio/flac", FLAC, "song.flac"),
      Buffer.from(`--${boundary}--\r\n`),
    ]),
  };
}

describe("text-to-music executor", () => {
  let root = "";
  let requests: Array<Record<string, unknown>> = [];
  let baseUrl = "";
  let truncated = { abc: false, semantic: false };
  const previousDataDir = process.env.DATA_DIR;
  const closers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sparkfire-music-run-"));
    process.env.DATA_DIR = root;
    vi.resetModules();
    requests = [];
    truncated = { abc: false, semantic: false };
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requests.push(body);
        const answer = multipart({ model: "YuE2-3B", seed: body.seed ?? 99, durationSeconds: 46.8, elapsedSeconds: 51.1, truncated, license: "YuE2 weights: CC BY-NC 4.0" }, body.score || SCORE);
        response.writeHead(200, { "Content-Type": answer.type });
        response.end(answer.body);
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
    settings.endpoints["music-generation"] = { baseUrl, model: "YuE2-3B", apiKey: "", enabled: true };
    await store.writeSettings(settings);
    const { processTextToMusic } = await import("./executor.js");
    return { store, processTextToMusic };
  }

  it("sings lyrics in a style, keeps the song and its score, and records what made it", async () => {
    const { store, processTextToMusic } = await setup();
    const job = await store.createTextToMusicJob("[Verse]\nCade la sera sul porto\nIl mare parla piano", "Italian, pop ballad, male tenor", { seed: 1234 });
    expect(job.moduleId).toBe("text-to-music");
    expect(job.title).toBe("Cade la sera sul porto");
    expect(job.artifacts.map((artifact) => [artifact.name, artifact.kind])).toEqual([["Lyrics.txt", "text"]]);

    const result = await processTextToMusic(job, job.runs[0]);
    expect(result).toEqual({ outputFiles: ["song.flac", "score.abc"], warnings: [] });
    expect(requests).toEqual([{ model: "YuE2-3B", style: "Italian, pop ballad, male tenor", lyrics: "[Verse]\nCade la sera sul porto\nIl mare parla piano", seed: 1234 }]);
    expect(await fs.readFile(store.safeOutputPath(job.id, "song.flac"))).toEqual(FLAC);
    expect(await fs.readFile(store.safeOutputPath(job.id, "score.abc"), "utf8")).toBe(SCORE);
    const saved = await store.updateJob(job.id, { outputFiles: result.outputFiles });
    expect(saved.artifacts.filter((artifact) => artifact.role !== "source").map((artifact) => [artifact.name, artifact.kind])).toEqual([["song.flac", "generated-audio"], ["score.abc", "score"]]);
    expect(saved.runs[0].params).toMatchObject({ model: "YuE2-3B", seed: 1234, durationSeconds: 46.8, elapsedSeconds: 51.1, license: "YuE2 weights: CC BY-NC 4.0" });
  });

  it("sings a song's score again, with that song's lyrics and style unless the run gives others", async () => {
    const { store, processTextToMusic } = await setup();
    const first = await store.createTextToMusicJob("[Chorus]\nResta con me", "Italian, pop ballad");
    const done = await store.updateJob(first.id, { outputFiles: (await processTextToMusic(first, first.runs[0])).outputFiles });
    const score = done.artifacts.find((artifact) => artifact.kind === "score")!;
    await fs.writeFile(store.safeArtifactPath(done.id, score.path), SCORE.replace("CDEF", "EDCD"));

    const { job, run } = await store.createWorkflowRun(done.id, "text-to-music", "text-to-music.default", { style: "smoky late-night jazz" }, [score.id]);
    const result = await processTextToMusic(job, run);
    expect(requests[1]).toMatchObject({ lyrics: "[Chorus]\nResta con me", style: "smoky late-night jazz", score: SCORE.replace("CDEF", "EDCD").trim() });
    expect(result.outputFiles).toEqual(["song.flac", "score.abc", `song-${run.id.replace(/^run-/, "").slice(0, 8)}.flac`, `score-${run.id.replace(/^run-/, "").slice(0, 8)}.abc`]);
    const saved = await store.updateJob(done.id, { outputFiles: result.outputFiles });
    expect(saved.artifacts.find((artifact) => artifact.name === result.outputFiles[2])).toMatchObject({ kind: "generated-audio", derivedFrom: [score.id] });
  });

  it("takes the lyrics from a text it was handed", async () => {
    const { store, processTextToMusic } = await setup();
    const created = await store.createTextToMusicJob("unused", "pop");
    await fs.writeFile(store.safeOutputPath(created.id, "translation.md"), "Ogni parola che dici\n");
    const withText = await store.updateJob(created.id, { outputFiles: ["translation.md"] });
    const translation = withText.artifacts.find((artifact) => artifact.kind === "translation")!;
    const { job, run } = await store.createWorkflowRun(created.id, "text-to-music", "text-to-music.default", { style: "Italian ballad" }, [translation.id]);
    await processTextToMusic(job, run);
    expect(requests[0]).toMatchObject({ lyrics: "Ogni parola che dici", style: "Italian ballad" });
  });

  it("warns when the song ran out of room and ends early", async () => {
    const { store, processTextToMusic } = await setup();
    truncated = { abc: false, semantic: true };
    const job = await store.createTextToMusicJob("la la la", "pop");
    const result = await processTextToMusic(job, job.runs[0]);
    expect(result.warnings).toEqual(["The song ran out of room in the semantic stage and ends early; try shorter lyrics"]);
  });

  it("refuses a song without a style or without a configured service", async () => {
    const store = await import("../../store.js");
    await store.initializeData();
    await expect(store.createTextToMusicJob("la", " ")).rejects.toThrow(/Describe the style/);
    await expect(store.createTextToMusicJob(" ", "pop")).rejects.toThrow(/Enter the lyrics/);
    const { processTextToMusic } = await import("./executor.js");
    const job = await store.createTextToMusicJob("la", "pop");
    await expect(processTextToMusic(job, job.runs[0])).rejects.toThrow(/Music generation service/);
    expect(requests).toEqual([]);
  });
});
