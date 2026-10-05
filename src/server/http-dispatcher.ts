import { Agent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

/**
 * Model calls can run for many minutes (a 2048² image, a long translation chunk on a busy GPU). Node's fetch
 * gives up after undici's default 300 s headers and body timeouts with a bare "fetch failed", before the
 * per-request AbortSignal timeouts in ai.ts apply. Turning those two off leaves timing to the signals.
 */
export const modelDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export function useModelDispatcher() {
  if (getGlobalDispatcher() !== modelDispatcher) setGlobalDispatcher(modelDispatcher);
}

useModelDispatcher();
