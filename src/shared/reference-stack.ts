import type { EndpointKind, ModelInputCapability, Settings } from "./contracts.js";

export const REFERENCE_SERVICE_CATALOG = {
  systemStatus: { port: 8330, label: "System status" },
  // Saluki 27B in llama-server (README, "Connect an LLM"). The stack does not start it, but the app expects it here.
  llm: { port: 8331, model: "saluki-27b" },
  ocr: { port: 8332, model: "Unlimited-OCR" },
  stt: { port: 8333, model: "Parakeet-TDT-0.6B-v3" },
  translation: { port: 8334, model: "Hy-MT2-1.8B-FP8" },
  imageGeneration: { port: 8336, model: "Z-Image-Turbo" },
  videoGeneration: { port: 8337, model: "FastH3" },
  musicGeneration: { port: 8339, model: "YuE2-3B" },
} as const;

/** Saluki reads images through its --mmproj and answers tool calls with llama-server's --jinja. */
export const REFERENCE_LLM_CAPABILITIES: readonly ModelInputCapability[] = ["text", "image", "tools"];

// The endpoint kinds the reference deployment provides. Grounding is not bundled (the module stays
// available through Settings).
export const REFERENCE_ENDPOINT_KINDS = ["ocr", "stt", "translation", "image-generation"] as const;
// Video generation is part of the reference stack too, but a deployment may leave it out
// (start-dgx-spark.sh --video-backend none, where its model license does not apply), so setup
// does not fail without it. Music generation is opt-in (--music-backend yue2, for its non-commercial weights),
// so it is turned on only when asked for. The LLM, Saluki, is started by hand, so setup does not fail
// without it either.
export const OPTIONAL_REFERENCE_ENDPOINT_KINDS = ["video-generation", "music-generation", "llm"] as const;

export function normalizeReferenceHost(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter the DGX Spark hostname or IP address");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.username || parsed.password || parsed.port || (parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("Use a hostname or IP address without credentials, a port, or a path");
  }
  return parsed.hostname;
}

/** The Spark a reference deployment points at, read from its OCR endpoint; undefined for a custom deployment. */
export function referenceHost(settings: Partial<Pick<Settings, "setup" | "endpoints">>) {
  if (settings.setup?.mode !== "all-in-one" && settings.setup?.mode !== "split") return undefined;
  try {
    return new URL(settings.endpoints?.ocr?.baseUrl ?? "").hostname || undefined;
  } catch {
    return undefined;
  }
}

export function referenceSettingsForHost(settings: Settings, hostInput: string, mode: Settings["setup"]["mode"], options: { video?: boolean; music?: boolean; llm?: boolean } = {}): Settings {
  const host = normalizeReferenceHost(hostInput);
  const origin = host.includes(":") ? `[${host}]` : host;
  const endpoint = (kind: EndpointKind, port: number, model: string) => ({
    ...settings.endpoints[kind],
    baseUrl: `http://${origin}:${port}/v1`,
    model,
    enabled: true,
  });
  // Without the key of the LLM it replaces, which may belong to a cloud service rather than the Spark.
  const saluki = { ...endpoint("llm", REFERENCE_SERVICE_CATALOG.llm.port, REFERENCE_SERVICE_CATALOG.llm.model), apiKey: "", capabilities: [...REFERENCE_LLM_CAPABILITIES] };
  return {
    ...settings,
    setup: { completed: true, mode, onboardingVersion: 1, completedAt: new Date().toISOString() },
    systemStatus: { baseUrl: `http://${origin}:${REFERENCE_SERVICE_CATALOG.systemStatus.port}` },
    endpoints: {
      ...settings.endpoints,
      // Saluki replaces whatever LLM was set up, switched off until it answers.
      llm: { ...saluki, enabled: options.llm !== false },
      ocr: endpoint("ocr", REFERENCE_SERVICE_CATALOG.ocr.port, REFERENCE_SERVICE_CATALOG.ocr.model),
      stt: endpoint("stt", REFERENCE_SERVICE_CATALOG.stt.port, REFERENCE_SERVICE_CATALOG.stt.model),
      translation: endpoint("translation", REFERENCE_SERVICE_CATALOG.translation.port, REFERENCE_SERVICE_CATALOG.translation.model),
      "image-generation": endpoint("image-generation", REFERENCE_SERVICE_CATALOG.imageGeneration.port, REFERENCE_SERVICE_CATALOG.imageGeneration.model),
      "video-generation": { ...endpoint("video-generation", REFERENCE_SERVICE_CATALOG.videoGeneration.port, REFERENCE_SERVICE_CATALOG.videoGeneration.model), enabled: options.video !== false },
      "music-generation": { ...endpoint("music-generation", REFERENCE_SERVICE_CATALOG.musicGeneration.port, REFERENCE_SERVICE_CATALOG.musicGeneration.model), enabled: options.music === true },
    },
  };
}
