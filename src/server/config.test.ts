import { describe, expect, it } from "vitest";
import { BUNDLED_SERVICE_CATALOG, brandEnv, defaultSettings } from "./config.js";

describe("bundled service catalog", () => {
  it("keeps the status monitor and model services on their assigned ports", () => {
    expect(Object.fromEntries(Object.entries(BUNDLED_SERVICE_CATALOG).map(([key, service]) => [key, service.port]))).toEqual({
      systemStatus: 8330,
      ocr: 8332,
      stt: 8333,
      translation: 8334,
      imageGeneration: 8336,
      videoGeneration: 8337,
    });
  });

  it("leaves a fresh installation unconfigured for first-run onboarding", () => {
    expect(defaultSettings.setup).toEqual({ completed: false, mode: "custom", onboardingVersion: 1 });
    expect(defaultSettings.systemStatus).toEqual({ baseUrl: "" });
    expect(defaultSettings.webSearch).toEqual({ enabled: false, provider: "searxng", baseUrl: "" });
    expect(Object.values(defaultSettings.endpoints).every((endpoint) => !endpoint.baseUrl && !endpoint.enabled)).toBe(true);
  });
});

describe("brandEnv", () => {
  it("prefers SPARKFIRE_* and falls back to the SparklingKit names of older installs", () => {
    expect(brandEnv("DEPLOYMENT_MODE", { SPARKFIRE_DEPLOYMENT_MODE: "split", SPARKLINGKIT_DEPLOYMENT_MODE: "custom" })).toBe("split");
    expect(brandEnv("DEPLOYMENT_MODE", { SPARKLINGKIT_DEPLOYMENT_MODE: "all-in-one" })).toBe("all-in-one");
    expect(brandEnv("DEPLOYMENT_MODE", {})).toBeUndefined();
  });
});
