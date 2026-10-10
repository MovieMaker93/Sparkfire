import type { EndpointKind, Settings } from "./contracts.js";

export const REFERENCE_SERVICE_CATALOG = {
  systemStatus: { port: 8330, label: "System status" },
  ocr: { port: 8332, model: "Unlimited-OCR" },
  stt: { port: 8333, model: "Parakeet-TDT-0.6B-v3" },
  translation: { port: 8334, model: "Hy-MT2-1.8B-FP8" },
  imageGeneration: { port: 8336, model: "Z-Image-Turbo" },
} as const;

// The endpoint kinds the reference deployment provides. The LLM is not bundled:
// chat, mind maps and summaries use any OpenAI-compatible endpoint configured in Settings,
// and neither is grounding (the module stays available through Settings).
export const REFERENCE_ENDPOINT_KINDS = ["ocr", "stt", "translation", "image-generation"] as const;

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

export function referenceSettingsForHost(settings: Settings, hostInput: string, mode: Settings["setup"]["mode"]): Settings {
  const host = normalizeReferenceHost(hostInput);
  const origin = host.includes(":") ? `[${host}]` : host;
  const endpoint = (kind: EndpointKind, port: number, model: string) => ({
    ...settings.endpoints[kind],
    baseUrl: `http://${origin}:${port}/v1`,
    model,
    enabled: true,
  });
  return {
    ...settings,
    setup: { completed: true, mode, onboardingVersion: 1, completedAt: new Date().toISOString() },
    systemStatus: { baseUrl: `http://${origin}:${REFERENCE_SERVICE_CATALOG.systemStatus.port}` },
    endpoints: {
      ...settings.endpoints,
      ocr: endpoint("ocr", REFERENCE_SERVICE_CATALOG.ocr.port, REFERENCE_SERVICE_CATALOG.ocr.model),
      stt: endpoint("stt", REFERENCE_SERVICE_CATALOG.stt.port, REFERENCE_SERVICE_CATALOG.stt.model),
      translation: endpoint("translation", REFERENCE_SERVICE_CATALOG.translation.port, REFERENCE_SERVICE_CATALOG.translation.model),
      "image-generation": endpoint("image-generation", REFERENCE_SERVICE_CATALOG.imageGeneration.port, REFERENCE_SERVICE_CATALOG.imageGeneration.model),
    },
  };
}
