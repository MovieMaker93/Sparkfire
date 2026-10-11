import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobManifest } from "./models.js";

describe("overlapping changes to one job", () => {
  let root = "";
  const previousDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sparkfire-lock-"));
    process.env.DATA_DIR = root;
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
    vi.resetModules();
  });

  async function storeWithJob(id = "lock-job") {
    const store = await import("./store.js");
    await store.initializeData();
    const jobRoot = store.jobDir(id);
    await Promise.all(["input", "work", "output"].map((folder) => fs.mkdir(path.join(jobRoot, folder), { recursive: true })));
    const now = new Date().toISOString();
    const job: JobManifest = {
      id,
      type: "pdf",
      status: "processing",
      createdAt: now,
      updatedAt: now,
      title: "Source.pdf",
      progress: 0,
      stage: "Reading pages",
      inputs: [{ name: "Source.pdf", storedName: "001-source.pdf", mimeType: "application/pdf", size: 6 }],
      outputFiles: [],
      warnings: [],
      params: {},
    };
    await store.atomicWriteJson(path.join(jobRoot, "job.json"), job);
    return { store, id, jobRoot };
  }

  it("keeps a rename made while a worker reports progress", async () => {
    const { store, id } = await storeWithJob();
    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) => store.updateJob(id, { progress: index + 1 })),
      store.renameJob(id, "Course notes"),
      ...Array.from({ length: 20 }, (_, index) => store.updateJob(id, { progress: index + 21 })),
    ]);
    const job = await store.readJob(id);
    expect(job.title).toBe("Course notes");
    expect(job.progress).toBe(40);
  });

  it("builds each patch from the manifest as it is when the change runs", async () => {
    const { store, id } = await storeWithJob();
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.updateJob(id, (job) => ({ params: { ...job.params, [`key${index}`]: index } }))));
    expect(Object.keys((await store.readJob(id)).params)).toHaveLength(20);
  });

  it("keeps a stop request on a run while the run reports its own changes", async () => {
    const { store, id } = await storeWithJob();
    const { run } = await store.createWorkflowRun(id, "ocr", "ocr.default", {});
    await Promise.all([
      ...Array.from({ length: 10 }, (_, index) => store.updateWorkflowRun(id, run.id, { progress: index + 1 })),
      store.updateWorkflowRun(id, run.id, { cancelRequested: true, stage: "Stopping…" }),
      ...Array.from({ length: 10 }, (_, index) => store.updateWorkflowRun(id, run.id, { params: { step: index } })),
    ]);
    const job = await store.readJob(id);
    expect(job.runs.find((candidate) => candidate.id === run.id)?.cancelRequested).toBe(true);
    expect(job.cancelRequested).toBe(true);
  });

  it("frees the job after a change that fails", async () => {
    const { store, id } = await storeWithJob();
    await expect(store.updateJob(id, () => { throw new Error("broken patch"); })).rejects.toThrow("broken patch");
    expect((await store.updateJob(id, { progress: 50 })).progress).toBe(50);
  });

  it("does not bring a deleted job back when an update was already waiting", async () => {
    const { store, id, jobRoot } = await storeWithJob();
    const results = await Promise.allSettled([store.deleteJob(id), store.updateJob(id, { progress: 50 })]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    await expect(fs.access(jobRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
