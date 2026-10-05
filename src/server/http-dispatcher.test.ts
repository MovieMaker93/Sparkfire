import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent, getGlobalDispatcher } from "undici";
import { modelDispatcher, useModelDispatcher } from "./http-dispatcher.js";

// A model server that takes a while before sending headers, like a long generation that does not stream.
// undici checks timeouts on a coarse (about 1 s) timer, so the delay is well above the strict limit.
let server: http.Server;
let baseUrl = "";
beforeAll(async () => {
  server = http.createServer((_request, response) => setTimeout(() => response.end("ok"), 3000));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("model dispatcher", () => {
  it("is the global dispatcher once imported", () => {
    useModelDispatcher();
    expect(getGlobalDispatcher()).toBe(modelDispatcher);
  });

  it("lets a slow response finish where a headers timeout would cut it off", { timeout: 15_000 }, async () => {
    const strict = new Agent({ headersTimeout: 1000 });
    await expect(fetch(baseUrl, { dispatcher: strict } as RequestInit)).rejects.toThrow("fetch failed");
    await strict.close();
    const response = await fetch(baseUrl);
    expect(await response.text()).toBe("ok");
  });
});
