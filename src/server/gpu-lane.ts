import { unloadModel } from "./ai.js";
import { MODULE_CONTRACTS } from "../shared/module-router.js";
import type { EndpointConfig, ModuleId } from "./models.js";
import { readSettings } from "./store.js";

export interface LanePeer {
  moduleId: ModuleId;
  endpoint: EndpointConfig;
}

interface Waiter {
  moduleId: ModuleId;
  resolve: () => void;
}

/**
 * One heavy job at a time, in arrival order. Video and music each load tens of GiB while they work and keep
 * them for a while afterwards, and on one Spark the two do not fit together next to the always-on stack
 * (docs/validation.md). The lane serialises them and, when the work switches from one module to another,
 * asks every other heavy service to free its weights first instead of waiting out its idle timeout.
 */
export class HeavyGpuLane {
  private holder: ModuleId | undefined;
  private readonly waiters: Waiter[] = [];
  /** The last module that held the lane; unknown after a restart, so the first job frees everyone else. */
  private lastModule: ModuleId | undefined;

  constructor(
    private readonly peers: (moduleId: ModuleId) => Promise<LanePeer[]>,
    private readonly unload: (endpoint: EndpointConfig, signal?: AbortSignal) => Promise<void>,
  ) {}

  get busyWith() {
    return this.holder;
  }

  async run<T>(moduleId: ModuleId, work: () => Promise<T>, options: { signal?: AbortSignal; onWait?: (holder: ModuleId) => unknown } = {}): Promise<T> {
    await this.acquire(moduleId, options);
    try {
      if (this.lastModule !== moduleId) await this.handOff(moduleId, options.signal);
      this.lastModule = moduleId;
      return await work();
    } finally {
      this.release();
    }
  }

  private async acquire(moduleId: ModuleId, { signal, onWait }: { signal?: AbortSignal; onWait?: (holder: ModuleId) => unknown }) {
    signal?.throwIfAborted();
    if (!this.holder) {
      this.holder = moduleId;
      return;
    }
    const holder = this.holder;
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { moduleId, resolve: () => { signal?.removeEventListener("abort", abort); resolve(); } };
      // A run stopped while it waits leaves the line without ever holding the lane.
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal?.reason ?? new DOMException("Stopped while waiting for the GPU", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
      Promise.resolve(onWait?.(holder)).catch(() => undefined);
    });
  }

  private release() {
    const next = this.waiters.shift();
    this.holder = next?.moduleId;
    next?.resolve();
  }

  private async handOff(moduleId: ModuleId, signal?: AbortSignal) {
    for (const peer of await this.peers(moduleId)) {
      try {
        await this.unload(peer.endpoint, signal);
      } catch (error) {
        signal?.throwIfAborted();
        // A service that is down holds no weights; one that refuses still has its own memory check.
        console.warn(`[gpu lane] could not free ${peer.moduleId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/** The other heavy modules whose service is configured, read fresh so a Settings change applies to the next job. */
async function configuredPeers(moduleId: ModuleId): Promise<LanePeer[]> {
  const settings = await readSettings();
  return MODULE_CONTRACTS.filter((contract) => contract.gpuLane === "heavy" && contract.id !== moduleId).flatMap((contract) => {
    const endpoint = settings.endpoints[contract.providerKind];
    return endpoint?.enabled && endpoint.baseUrl ? [{ moduleId: contract.id, endpoint }] : [];
  });
}

export const heavyGpuLane = new HeavyGpuLane(configuredPeers, unloadModel);
