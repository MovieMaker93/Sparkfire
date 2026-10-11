import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DGX Spark model images", () => {
  it("keeps the Hy-MT2 image tag aligned with its required Transformers runtime", async () => {
    const [dockerfile, compose] = await Promise.all([
      fs.readFile(new URL("../../services/dgx-models/hy-mt2/Dockerfile", import.meta.url), "utf8"),
      fs.readFile(new URL("../../compose.dgx.yaml", import.meta.url), "utf8"),
    ]);
    const runtimeVersion = dockerfile.match(/"transformers==([^"]+)"/)?.[1];
    const imageVersion = compose.match(/image:\s+sparklingkit\/hy-mt2-1\.8b-fp8:transformers-([^\s]+)/)?.[1];

    expect(runtimeVersion).toBe("5.6.0");
    expect(imageVersion).toBe(runtimeVersion);
  });

  it("keeps the Parakeet image tag aligned with the pinned parakeet.cpp release", async () => {
    const [dockerfile, compose] = await Promise.all([
      fs.readFile(new URL("../../services/dgx-models/parakeet/Dockerfile", import.meta.url), "utf8"),
      fs.readFile(new URL("../../compose.dgx.yaml", import.meta.url), "utf8"),
    ]);

    expect(dockerfile.match(/ARG PARAKEET_REF=(\S+)/)?.[1]).toBe("v0.5.0");
    expect(dockerfile).toContain("ARG PARAKEET_COMMIT=1bfbebfaaf493866f49597cd3b7901959d395c60");
    expect(compose.match(/image:\s+sparklingkit\/parakeet:parakeet\.cpp-(\S+)/)?.[1]).toBe("v0.5.0");
  });
});

describe("web search service", () => {
  it("pins SearXNG by digest, keeps it local and serves the JSON results the app reads", async () => {
    const [compose, settings, script] = await Promise.all([
      fs.readFile(new URL("../../compose.search.yaml", import.meta.url), "utf8"),
      fs.readFile(new URL("../../services/searxng/settings.yml", import.meta.url), "utf8"),
      fs.readFile(new URL("../../scripts/start-dgx-spark.sh", import.meta.url), "utf8"),
    ]);
    expect(compose).toMatch(/image:\s+searxng\/searxng:[\w.-]+@sha256:[0-9a-f]{64}\n/);
    expect(compose).toContain('"127.0.0.1:8338:8080"');
    expect(compose).toContain("WEB_SEARCH_BASE_URL: ${SPARKFIRE_SEARCH_BASE_URL-http://searxng:8080}");
    expect(settings).toMatch(/formats:\s*\n\s*- html\s*\n\s*- json/);
    expect(settings).toContain("limiter: false");
    // Off unless asked for, like video generation.
    expect(script).toContain('SEARCH_BACKEND="${SPARKFIRE_SEARCH_BACKEND:-none}"');
    expect(script).toContain("--file compose.search.yaml");
  });
});
