import { describe, expect, it, vi } from "vitest";
import { HeavyGpuLane, type LanePeer } from "./gpu-lane.js";
import type { EndpointConfig, ModuleId } from "./models.js";

const endpoint = (port: number): EndpointConfig => ({ baseUrl: `http://127.0.0.1:${port}/v1`, model: "m", apiKey: "", enabled: true });
const VIDEO = "text-to-video" as ModuleId;
const MUSIC = "text-to-music" as ModuleId;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function lane(peers: Record<string, LanePeer[]> = {}, unload = vi.fn(async (_endpoint: EndpointConfig, _signal?: AbortSignal) => undefined)) {
  return { unload, lane: new HeavyGpuLane(async (moduleId) => peers[moduleId] || [], unload) };
}

describe("heavy GPU lane", () => {
  it("runs one heavy job at a time and tells the waiting run who holds the GPU", async () => {
    const { lane: gpu } = lane();
    const first = deferred();
    const order: string[] = [];
    const onWait = vi.fn();
    const video = gpu.run(VIDEO, async () => { order.push("video start"); await first.promise; order.push("video end"); });
    const music = gpu.run(MUSIC, async () => { order.push("music"); }, { onWait });
    await vi.waitFor(() => expect(order).toEqual(["video start"]));
    expect(onWait).toHaveBeenCalledWith(VIDEO);
    expect(gpu.busyWith).toBe(VIDEO);
    first.resolve();
    await Promise.all([video, music]);
    expect(order).toEqual(["video start", "video end", "music"]);
    expect(gpu.busyWith).toBeUndefined();
  });

  it("serves waiting runs in arrival order", async () => {
    const { lane: gpu } = lane();
    const first = deferred();
    const order: number[] = [];
    const runs = [gpu.run(VIDEO, () => first.promise.then(() => { order.push(0); }))];
    for (const index of [1, 2, 3]) runs.push(gpu.run(index % 2 ? MUSIC : VIDEO, async () => { order.push(index); }));
    first.resolve();
    await Promise.all(runs);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("lets a run stopped while waiting leave the line without blocking the next one", async () => {
    const { lane: gpu } = lane();
    const first = deferred();
    const stopped = new AbortController();
    const ran: string[] = [];
    const video = gpu.run(VIDEO, () => first.promise);
    const cancelled = gpu.run(MUSIC, async () => { ran.push("cancelled"); }, { signal: stopped.signal });
    const next = gpu.run(MUSIC, async () => { ran.push("next"); });
    stopped.abort();
    await expect(cancelled).rejects.toThrow();
    first.resolve();
    await Promise.all([video, next]);
    expect(ran).toEqual(["next"]);
  });

  it("refuses a run that was already stopped", async () => {
    const { lane: gpu } = lane();
    const work = vi.fn(async () => undefined);
    await expect(gpu.run(VIDEO, work, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it("frees the other heavy services when the work switches module, and not between runs of the same module", async () => {
    const { lane: gpu, unload } = lane({ [VIDEO]: [{ moduleId: MUSIC, endpoint: endpoint(1) }], [MUSIC]: [{ moduleId: VIDEO, endpoint: endpoint(2) }] });
    await gpu.run(VIDEO, async () => undefined);
    expect(unload.mock.calls.map(([target]) => target.baseUrl)).toEqual(["http://127.0.0.1:1/v1"]);
    await gpu.run(VIDEO, async () => undefined);
    expect(unload).toHaveBeenCalledTimes(1);
    await gpu.run(MUSIC, async () => undefined);
    expect(unload.mock.calls.map(([target]) => target.baseUrl)).toEqual(["http://127.0.0.1:1/v1", "http://127.0.0.1:2/v1"]);
  });

  it("frees the peer before the work starts", async () => {
    const order: string[] = [];
    const { lane: gpu } = lane({ [MUSIC]: [{ moduleId: VIDEO, endpoint: endpoint(2) }] }, vi.fn(async () => { order.push("unload"); }));
    await gpu.run(MUSIC, async () => { order.push("work"); });
    expect(order).toEqual(["unload", "work"]);
  });

  it("goes on when a peer cannot be freed, since a service that is down holds no weights", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { lane: gpu } = lane({ [MUSIC]: [{ moduleId: VIDEO, endpoint: endpoint(2) }] }, vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }));
    await expect(gpu.run(MUSIC, async () => "song")).resolves.toBe("song");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    warn.mockRestore();
  });

  it("releases the lane when the work fails", async () => {
    const { lane: gpu } = lane();
    await expect(gpu.run(VIDEO, async () => { throw new Error("generation failed"); })).rejects.toThrow("generation failed");
    expect(gpu.busyWith).toBeUndefined();
    await expect(gpu.run(MUSIC, async () => "next")).resolves.toBe("next");
  });
});
