import { describe, expect, it, vi } from "vitest";
import { BUNDLED_SERVICE_CATALOG, brandEnv, defaultSettings } from "./config.js";

describe("bundled service catalog", () => {
  it("keeps the status monitor and model services on their assigned ports", () => {
    expect(Object.fromEntries(Object.entries(BUNDLED_SERVICE_CATALOG).map(([key, service]) => [key, service.port]))).toEqual({
      systemStatus: 8330,
      llm: 8331,
      ocr: 8332,
      stt: 8333,
      translation: 8334,
      imageGeneration: 8336,
      videoGeneration: 8337,
      musicGeneration: 8339,
    });
  });

  it("leaves a fresh installation unconfigured for first-run onboarding", () => {
    expect(defaultSettings.setup).toEqual({ completed: false, mode: "custom", onboardingVersion: 1 });
    expect(defaultSettings.systemStatus).toEqual({ baseUrl: "" });
    expect(defaultSettings.webSearch).toEqual({ enabled: false, provider: "searxng", baseUrl: "" });
    expect(Object.values(defaultSettings.endpoints).every((endpoint) => !endpoint.baseUrl && !endpoint.enabled)).toBe(true);
  });

  it("names Saluki as the language model, with its image input and tool calling", () => {
    expect(defaultSettings.endpoints.llm).toMatchObject({ baseUrl: "", model: "saluki-27b", enabled: false, capabilities: ["text", "image", "tools"] });
  });

  it("takes only addresses from the environment, never models or keys", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://host.docker.internal:8331/v1");
    vi.stubEnv("LLM_MODEL", "my-model");
    vi.stubEnv("LLM_API_KEY", "sk-cloud");
    vi.stubEnv("OCR_MODEL", "Unlimited-OCR");
    vi.resetModules();
    try {
      const seeded = (await import("./config.js")).defaultSettings;
      expect(seeded.endpoints.llm).toEqual({ baseUrl: "http://host.docker.internal:8331/v1", model: "saluki-27b", apiKey: "", enabled: true, capabilities: ["text", "image", "tools"] });
      expect(seeded.endpoints.ocr.model).toBe("PaddleOCR-VL-1.6");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("brandEnv", () => {
  it("prefers SPARKFIRE_* and falls back to the SparklingKit names of older installs", () => {
    expect(brandEnv("DEPLOYMENT_MODE", { SPARKFIRE_DEPLOYMENT_MODE: "split", SPARKLINGKIT_DEPLOYMENT_MODE: "custom" })).toBe("split");
    expect(brandEnv("DEPLOYMENT_MODE", { SPARKLINGKIT_DEPLOYMENT_MODE: "all-in-one" })).toBe("all-in-one");
    expect(brandEnv("DEPLOYMENT_MODE", {})).toBeUndefined();
  });
});
