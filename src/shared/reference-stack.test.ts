import { describe, expect, it } from "vitest";
import { defaultSettings } from "../server/config.js";
import { OPTIONAL_REFERENCE_ENDPOINT_KINDS, REFERENCE_ENDPOINT_KINDS, normalizeReferenceHost, referenceHost, referenceSettingsForHost, stackDeployment } from "./reference-stack.js";

describe("reference stack settings", () => {
  it("accepts a hostname or a simple URL and rejects embedded connection details", () => {
    expect(normalizeReferenceHost("dgx-spark.local")).toBe("dgx-spark.local");
    expect(normalizeReferenceHost("http://192.0.2.10/")).toBe("192.0.2.10");
    expect(() => normalizeReferenceHost("http://dgx-spark.local:8331")).toThrow(/without credentials, a port, or a path/);
    expect(() => normalizeReferenceHost("dgx-spark.local/models")).toThrow(/without credentials, a port, or a path/);
  });

  it("points every service of the stack at its fixed model on the Spark", () => {
    const settings = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split");
    expect(settings.setup).toMatchObject({ completed: true, mode: "split", onboardingVersion: 1 });
    expect(settings.setup.completedAt).toBeTruthy();
    expect(settings.systemStatus.baseUrl).toBe("http://192.0.2.10:8330");
    expect(Object.fromEntries(Object.entries(settings.endpoints).map(([kind, endpoint]) => [kind, `${endpoint.model} ${endpoint.baseUrl} ${endpoint.enabled}`]))).toEqual({
      llm: "saluki-27b http://192.0.2.10:8331/v1 true",
      ocr: "PaddleOCR-VL-1.6 http://192.0.2.10:8332/v1 true",
      stt: "Parakeet-TDT-0.6B-v3 http://192.0.2.10:8333/v1 true",
      translation: "Hy-MT2-1.8B-FP8 http://192.0.2.10:8334/v1 true",
      grounding: "  false",
      "image-generation": "Qwen-Image-2.1-Turbo http://192.0.2.10:8336/v1 true",
      "video-generation": "FastH3 http://192.0.2.10:8337/v1 true",
      "music-generation": "YuE2-3B http://192.0.2.10:8339/v1 true",
    });
    expect(settings.endpoints.llm.capabilities).toEqual(["text", "image", "tools"]);
    expect(REFERENCE_ENDPOINT_KINDS).toEqual(["llm", "ocr", "stt", "translation", "image-generation", "music-generation"]);
  });

  it("keeps the video endpoint but leaves it off when the stack runs without video", () => {
    const settings = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split", { video: false });
    expect(settings.endpoints["video-generation"]).toMatchObject({ baseUrl: "http://192.0.2.10:8337/v1", enabled: false });
    expect(OPTIONAL_REFERENCE_ENDPOINT_KINDS).toEqual(["video-generation"]);
  });

  it("keeps nothing a user set up: their model, URL or key never reaches the stack", () => {
    const own = { baseUrl: "https://llm.example/v1", model: "my-model", apiKey: "sk-cloud", enabled: true, capabilities: ["text" as const] };
    const configured = { ...structuredClone(defaultSettings), endpoints: { ...defaultSettings.endpoints, llm: own, ocr: { ...own, model: "Unlimited-OCR" }, grounding: own } };
    const settings = referenceSettingsForHost(configured, "192.0.2.10", "all-in-one");
    expect(settings.endpoints.llm).toEqual({ baseUrl: "http://192.0.2.10:8331/v1", model: "saluki-27b", apiKey: "", enabled: true, capabilities: ["text", "image", "tools"] });
    expect(settings.endpoints.ocr).toEqual({ baseUrl: "http://192.0.2.10:8332/v1", model: "PaddleOCR-VL-1.6", apiKey: "", enabled: true });
    expect(settings.endpoints.grounding).toEqual({ baseUrl: "", model: "", apiKey: "", enabled: false });
  });

  it("turns web search on where the app runs beside SearXNG, and off on another machine", () => {
    expect(referenceSettingsForHost(structuredClone(defaultSettings), "host.docker.internal", "all-in-one").webSearch).toEqual({ enabled: true, provider: "searxng", baseUrl: "http://searxng:8080" });
    expect(referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split").webSearch).toEqual({ enabled: false, provider: "searxng", baseUrl: "" });
  });

  it("brackets an IPv6 host once", () => {
    expect(referenceSettingsForHost(structuredClone(defaultSettings), "[fd00::10]", "split").endpoints.ocr.baseUrl).toBe("http://[fd00::10]:8332/v1");
  });

  it("reads the Spark of a stack deployment from its OCR endpoint", () => {
    const applied = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split");
    expect(referenceHost(applied)).toBe("192.0.2.10");
    expect(referenceHost(referenceSettingsForHost(structuredClone(defaultSettings), "host.docker.internal", "all-in-one"))).toBe("host.docker.internal");
    expect(referenceHost({ ...applied, setup: { ...applied.setup, mode: "custom" } })).toBeUndefined();
  });

  it("finds where the stack runs in the environment first, then in what setup saved", () => {
    const saved = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split", { video: false });
    const environment = referenceSettingsForHost(structuredClone(defaultSettings), "host.docker.internal", "all-in-one");
    expect(stackDeployment(saved, environment)).toEqual({ host: "host.docker.internal", mode: "all-in-one", video: true, systemStatusUrl: "http://host.docker.internal:8330", webSearchUrl: "http://searxng:8080" });
    expect(stackDeployment(saved, defaultSettings)).toEqual({ host: "192.0.2.10", mode: "split", video: false });
    expect(stackDeployment(defaultSettings, defaultSettings)).toBeUndefined();
  });

  it("lets the environment say where the monitor and SearXNG answer, as the README's demo copy does", () => {
    const environment = {
      ...referenceSettingsForHost(structuredClone(defaultSettings), "127.0.0.1", "all-in-one"),
      systemStatus: { baseUrl: "http://127.0.0.1:8399" },
      webSearch: { enabled: true, provider: "searxng" as const, baseUrl: "http://127.0.0.1:8398" },
    };
    const deployment = stackDeployment(defaultSettings, environment);
    expect(deployment).toEqual({ host: "127.0.0.1", mode: "all-in-one", video: true, systemStatusUrl: "http://127.0.0.1:8399", webSearchUrl: "http://127.0.0.1:8398" });
    const applied = referenceSettingsForHost(structuredClone(defaultSettings), deployment!.host, deployment!.mode, deployment);
    expect(applied.systemStatus.baseUrl).toBe("http://127.0.0.1:8399");
    expect(applied.webSearch).toEqual({ enabled: true, provider: "searxng", baseUrl: "http://127.0.0.1:8398" });
    expect(applied.endpoints.llm.baseUrl).toBe("http://127.0.0.1:8331/v1");
    // Without the app beside SearXNG, web search stays off whatever the environment names.
    expect(referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split", { webSearchUrl: "http://127.0.0.1:8398" }).webSearch).toEqual({ enabled: false, provider: "searxng", baseUrl: "" });
  });
});
