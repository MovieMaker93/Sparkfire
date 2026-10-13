import type { EndpointKind, ModelInputCapability, Settings } from "./contracts.js";

/**
 * Sparkfire's stack: one fixed model per service, chosen and measured to share a 128 GB DGX Spark
 * (docs/validation.md). Users do not pick models; every install runs these.
 */
export const REFERENCE_SERVICE_CATALOG = {
  systemStatus: { port: 8330, label: "System status" },
  // Saluki 27B in llama-server.
  llm: { port: 8331, model: "saluki-27b" },
  ocr: { port: 8332, model: "PaddleOCR-VL-1.6" },
  stt: { port: 8333, model: "Parakeet-TDT-0.6B-v3" },
  translation: { port: 8334, model: "Hy-MT2-1.8B-FP8" },
  imageGeneration: { port: 8336, model: "Qwen-Image-2.1-Turbo" },
  videoGeneration: { port: 8337, model: "FastH3" },
  musicGeneration: { port: 8339, model: "YuE2-3B" },
} as const;

/** Saluki reads images through its --mmproj and answers tool calls with llama-server's --jinja. */
export const REFERENCE_LLM_CAPABILITIES: readonly ModelInputCapability[] = ["text", "image", "tools"];

/** SearXNG as the app reaches it on the stack's compose network (compose.search.yaml). */
export const STACK_WEB_SEARCH_URL = "http://searxng:8080";

// The services every deployment of the stack runs, which setup checks before it applies. There is no grounding
// service, so that module stays out of the app.
export const REFERENCE_ENDPOINT_KINDS = ["llm", "ocr", "stt", "translation", "image-generation", "music-generation"] as const;
// Video generation can be left out (start-dgx-spark.sh --video-backend none) where FastH3's license does not
// apply, so setup does not fail without it.
export const OPTIONAL_REFERENCE_ENDPOINT_KINDS = ["video-generation"] as const;

export type StackMode = "all-in-one" | "split";

/** Where an install's stack runs: the Spark's address, whether the app runs on it, and whether video is part of it. */
export interface StackDeployment {
  host: string;
  mode: StackMode;
  video: boolean;
  /**
   * Where the system monitor and SearXNG answer, when the environment names them. The README's demo copy runs its own
   * on other ports, so recordings never show the Spark's host name; the start scripts name the stack's own.
   */
  systemStatusUrl?: string;
  webSearchUrl?: string;
}

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

/** The Spark a stack deployment points at, read from its OCR endpoint; undefined before setup has run. */
export function referenceHost(settings: Partial<Pick<Settings, "setup" | "endpoints">>) {
  if (settings.setup?.mode !== "all-in-one" && settings.setup?.mode !== "split") return undefined;
  try {
    return new URL(settings.endpoints?.ocr?.baseUrl ?? "").hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where the stack runs: what the start scripts put in the environment first, then what setup saved. Undefined for an
 * install that has not been set up with the stack.
 */
export function stackDeployment(saved: Partial<Pick<Settings, "setup" | "endpoints">>, environment: Partial<Pick<Settings, "setup" | "endpoints" | "systemStatus" | "webSearch">>): StackDeployment | undefined {
  const systemStatusUrl = environment.systemStatus?.baseUrl?.trim();
  const webSearchUrl = environment.webSearch?.baseUrl?.trim();
  for (const source of [environment, saved]) {
    const host = referenceHost(source);
    if (host && (source.setup?.mode === "all-in-one" || source.setup?.mode === "split")) {
      return {
        host,
        mode: source.setup.mode,
        video: Boolean(source.endpoints?.["video-generation"]?.enabled),
        ...(systemStatusUrl ? { systemStatusUrl } : {}),
        ...(webSearchUrl ? { webSearchUrl } : {}),
      };
    }
  }
  return undefined;
}

/**
 * The settings the stack decides: every service at its fixed model on the Spark, the system monitor and web search.
 * Nothing set before survives, so a model or key chosen by hand never reaches the stack.
 */
export function referenceSettingsForHost(settings: Settings, hostInput: string, mode: StackMode, options: Partial<Omit<StackDeployment, "host" | "mode">> = {}): Settings {
  const host = normalizeReferenceHost(hostInput);
  // An IPv6 hostname from the URL parser already has its brackets.
  const origin = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const endpoint = (port: number, model: string, enabled = true) => ({ baseUrl: `http://${origin}:${port}/v1`, model, apiKey: "", enabled });
  const catalog = REFERENCE_SERVICE_CATALOG;
  return {
    ...settings,
    setup: { completed: true, mode, onboardingVersion: 1, completedAt: (settings.setup?.completed && settings.setup.completedAt) || new Date().toISOString() },
    systemStatus: { baseUrl: options.systemStatusUrl || `http://${origin}:${catalog.systemStatus.port}` },
    // SearXNG listens only on the Spark itself, so a workspace on another machine has no web search.
    webSearch: { enabled: mode === "all-in-one", provider: "searxng", baseUrl: mode === "all-in-one" ? options.webSearchUrl || STACK_WEB_SEARCH_URL : "" },
    endpoints: {
      llm: { ...endpoint(catalog.llm.port, catalog.llm.model), capabilities: [...REFERENCE_LLM_CAPABILITIES] },
      ocr: endpoint(catalog.ocr.port, catalog.ocr.model),
      stt: endpoint(catalog.stt.port, catalog.stt.model),
      translation: endpoint(catalog.translation.port, catalog.translation.model),
      grounding: { baseUrl: "", model: "", apiKey: "", enabled: false },
      "image-generation": endpoint(catalog.imageGeneration.port, catalog.imageGeneration.model),
      "video-generation": endpoint(catalog.videoGeneration.port, catalog.videoGeneration.model, options.video !== false),
      "music-generation": endpoint(catalog.musicGeneration.port, catalog.musicGeneration.model),
    } satisfies Record<EndpointKind, Settings["endpoints"][EndpointKind]>,
  };
}
