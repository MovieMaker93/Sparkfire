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
    expect(compose).toContain("WEB_SEARCH_BASE_URL: http://searxng:8080");
    expect(settings).toMatch(/formats:\s*\n\s*- html\s*\n\s*- json/);
    expect(settings).toContain("limiter: false");
    // Part of the stack, so it always starts.
    expect(script).toContain('start_service searxng "Web search (SearXNG)"');
    expect(script).toContain("--file compose.search.yaml");
  });
});

describe("Saluki", () => {
  const read = (file: string) => fs.readFile(new URL(`../../${file}`, import.meta.url), "utf8");

  it("builds llama-server from the pinned llama.cpp commit its image tag names", async () => {
    const [dockerfile, compose] = await Promise.all([read("services/dgx-models/llama-server/Dockerfile"), read("compose.dgx.yaml")]);
    const ref = dockerfile.match(/ARG LLAMA_CPP_REF=(\S+)/)?.[1];
    expect(ref).toBe("b11576");
    expect(dockerfile).toContain("ARG LLAMA_CPP_COMMIT=358a420ec4ed59b6b0be08b1d1f71dd478b99a99");
    expect(dockerfile).toContain("-DCMAKE_CUDA_ARCHITECTURES=121");
    expect(compose.match(/image:\s+sparklingkit\/llama-server:(\S+)/)?.[1]).toBe(ref);
  });

  it("serves the files the start script downloads as saluki-27b on 8331, with tool calls and image input", async () => {
    const [compose, script] = await Promise.all([read("compose.dgx.yaml"), read("scripts/start-dgx-spark.sh")]);
    const service = compose.slice(compose.indexOf("  saluki:\n"), compose.indexOf("  parakeet:\n"));
    for (const file of ["Underdog-Saluki-27B-1.0-IQ2-mix.gguf", "mmproj-Underdog-Saluki-27B-1.0-F16.gguf"]) {
      expect(service).toContain(`/models/ConwayResearch/Underdog-Saluki-27B-1.0/${file}`);
      expect(script).toContain(`"${file}"`);
    }
    expect(service).toMatch(/- --alias\n\s+- saluki-27b\n/);
    expect(service).toContain("- --jinja");
    expect(service).toMatch(/- --port\n\s+- "8331"\n/);
    expect(script).toContain('start_service saluki "LLM (Saluki 27B)" "http://127.0.0.1:8331/health"');
  });
});

describe("the fixed stack", () => {
  it("starts music with the stack and keeps no other model choices", async () => {
    const [compose, script] = await Promise.all([
      fs.readFile(new URL("../../compose.dgx.yaml", import.meta.url), "utf8"),
      fs.readFile(new URL("../../scripts/start-dgx-spark.sh", import.meta.url), "utf8"),
    ]);
    expect(compose).not.toContain("profiles: [music]");
    expect(compose).not.toContain("unlimited-ocr:");
    expect(compose).toContain("IMAGE_BACKEND: qwen-image-2.1-turbo");
    expect(script).toContain('start_service music-generation "Music generation (YuE2)"');
    // Video stays optional where FastH3's license does not apply.
    expect(script).toContain("--video-backend NAME");
    expect(script).not.toMatch(/--(ocr|image|music|search)-backend NAME/);
  });
});
