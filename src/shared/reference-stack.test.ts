import { describe, expect, it } from "vitest";
import { defaultSettings } from "../server/config.js";
import { OPTIONAL_REFERENCE_ENDPOINT_KINDS, REFERENCE_ENDPOINT_KINDS, normalizeReferenceHost, referenceSettingsForHost } from "./reference-stack.js";

describe("reference stack settings", () => {
  it("accepts a hostname or a simple URL and rejects embedded connection details", () => {
    expect(normalizeReferenceHost("dgx-spark.local")).toBe("dgx-spark.local");
    expect(normalizeReferenceHost("http://192.0.2.10/")).toBe("192.0.2.10");
    expect(() => normalizeReferenceHost("http://dgx-spark.local:8331")).toThrow(/without credentials, a port, or a path/);
    expect(() => normalizeReferenceHost("dgx-spark.local/models")).toThrow(/without credentials, a port, or a path/);
  });

  it("maps one DGX host to all reference service ports", () => {
    const settings = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split");
    expect(settings.setup).toMatchObject({ completed: true, mode: "split", onboardingVersion: 1 });
    expect(settings.setup.completedAt).toBeTruthy();
    expect(settings.systemStatus.baseUrl).toBe("http://192.0.2.10:8330");
    // The LLM endpoint is user-configured; the reference preset must not touch it.
    expect(settings.endpoints.llm.baseUrl).toBe("");
    expect(settings.endpoints.ocr.baseUrl).toBe("http://192.0.2.10:8332/v1");
    expect(settings.endpoints.stt.baseUrl).toBe("http://192.0.2.10:8333/v1");
    expect(settings.endpoints.translation.baseUrl).toBe("http://192.0.2.10:8334/v1");
    expect(settings.endpoints["image-generation"].baseUrl).toBe("http://192.0.2.10:8336/v1");
    expect(settings.endpoints["video-generation"]).toMatchObject({ baseUrl: "http://192.0.2.10:8337/v1", model: "FastH3", enabled: true });
    expect(REFERENCE_ENDPOINT_KINDS.every((kind) => settings.endpoints[kind].enabled)).toBe(true);
  });

  it("keeps the video endpoint but leaves it off when the stack runs without video", () => {
    const settings = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "split", { video: false });
    expect(settings.endpoints["video-generation"]).toMatchObject({ baseUrl: "http://192.0.2.10:8337/v1", enabled: false });
    expect(OPTIONAL_REFERENCE_ENDPOINT_KINDS).toEqual(["video-generation", "music-generation"]);
  });

  it("keeps music off unless it was asked for, since its weights are non-commercial", () => {
    const host = "192.0.2.10";
    expect(referenceSettingsForHost(structuredClone(defaultSettings), host, "split").endpoints["music-generation"]).toMatchObject({ baseUrl: "http://192.0.2.10:8339/v1", model: "YuE2-3B", enabled: false });
    expect(referenceSettingsForHost(structuredClone(defaultSettings), host, "split", { music: true }).endpoints["music-generation"].enabled).toBe(true);
  });

  it("points speech recognition at the Parakeet service", () => {
    const settings = referenceSettingsForHost(structuredClone(defaultSettings), "192.0.2.10", "all-in-one");
    expect(settings.endpoints.stt.model).toBe("Parakeet-TDT-0.6B-v3");
  });
});
