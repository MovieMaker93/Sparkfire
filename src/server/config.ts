import path from "node:path";
import type { PromptPreset, Settings } from "./models.js";
import { DEPLOYMENT_MODES } from "../shared/contracts.js";
import { REFERENCE_LLM_CAPABILITIES, REFERENCE_SERVICE_CATALOG } from "../shared/reference-stack.js";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));
export const CLIENT_DIR = path.resolve(ROOT_DIR, "dist-client");
export const PORT = Number(process.env.PORT || 54321);
export const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
// Sparkfire began as a fork of SparklingKit; installs that still set SPARKLINGKIT_* keep working.
export function brandEnv(name: string, env: NodeJS.ProcessEnv = process.env) {
  return env[`SPARKFIRE_${name}`] ?? env[`SPARKLINGKIT_${name}`];
}

export const APP_VERSION = brandEnv("VERSION") || "development";

export const BUNDLED_SERVICE_CATALOG = REFERENCE_SERVICE_CATALOG;

// The environment says only where a service runs; its model is the stack's, whatever else is set.
function stackEndpoint(baseUrl: string | undefined, model: string, capabilities?: Settings["endpoints"]["llm"]["capabilities"]) {
  const normalizedBaseUrl = baseUrl?.trim() || "";
  return {
    baseUrl: normalizedBaseUrl,
    model,
    apiKey: "",
    enabled: Boolean(normalizedBaseUrl),
    ...(capabilities ? { capabilities } : {}),
  };
}

const environmentMode = brandEnv("DEPLOYMENT_MODE");
const configuredMode = DEPLOYMENT_MODES.includes(environmentMode as (typeof DEPLOYMENT_MODES)[number])
  ? environmentMode as Settings["setup"]["mode"]
  : "custom";
const explicitlyComplete = brandEnv("SETUP_COMPLETE");
const environmentHasServices = [process.env.LLM_BASE_URL, process.env.OCR_BASE_URL, process.env.STT_BASE_URL, process.env.TRANSLATION_BASE_URL, process.env.IMAGE_GENERATION_BASE_URL, process.env.VIDEO_GENERATION_BASE_URL, process.env.MUSIC_GENERATION_BASE_URL].some((value) => Boolean(value?.trim()));

export const defaultSettings: Settings = {
  schemaVersion: 2,
  setup: {
    completed: explicitlyComplete === "true" || (explicitlyComplete !== "false" && environmentHasServices),
    mode: configuredMode,
    onboardingVersion: 1,
    ...(explicitlyComplete === "true" || (explicitlyComplete !== "false" && environmentHasServices) ? { completedAt: new Date().toISOString() } : {}),
  },
  systemStatus: {
    baseUrl: process.env.SYSTEM_STATUS_BASE_URL?.trim() || "",
  },
  // The stack's SearXNG, where the start script sets it. Searching sends what a conversation is about to the engines behind it.
  webSearch: {
    enabled: Boolean(process.env.WEB_SEARCH_BASE_URL?.trim()),
    provider: "searxng",
    baseUrl: process.env.WEB_SEARCH_BASE_URL?.trim() || "",
  },
  endpoints: {
    llm: stackEndpoint(process.env.LLM_BASE_URL, BUNDLED_SERVICE_CATALOG.llm.model, [...REFERENCE_LLM_CAPABILITIES]),
    ocr: stackEndpoint(process.env.OCR_BASE_URL, BUNDLED_SERVICE_CATALOG.ocr.model),
    stt: stackEndpoint(process.env.STT_BASE_URL, BUNDLED_SERVICE_CATALOG.stt.model),
    translation: stackEndpoint(process.env.TRANSLATION_BASE_URL, BUNDLED_SERVICE_CATALOG.translation.model),
    // The stack has no grounding service.
    grounding: stackEndpoint(undefined, ""),
    "image-generation": stackEndpoint(process.env.IMAGE_GENERATION_BASE_URL, BUNDLED_SERVICE_CATALOG.imageGeneration.model),
    "video-generation": stackEndpoint(process.env.VIDEO_GENERATION_BASE_URL, BUNDLED_SERVICE_CATALOG.videoGeneration.model),
    "music-generation": stackEndpoint(process.env.MUSIC_GENERATION_BASE_URL, BUNDLED_SERVICE_CATALOG.musicGeneration.model),
  },
  audio: {
    chunkTargetSec: 60,
    chunkOverlapSec: 3,
    sampleRate: 16000,
    maxCompletionTokens: 2048,
    requestTimeoutSec: 180,
    adaptiveSplit: true,
    minAdaptiveChunkSec: 15,
  },
  pdf: { dpi: 175, pagesPerBatch: 20 },
  queue: { workers: 2, maxRetriesPerChunk: 2 },
  retention: { purgeWorkDirAfterDays: 7 },
  ui: { language: "en", theme: "auto", timezone: "UTC" },
};

export const defaultPrompts: PromptPreset[] = [
  {
    name: "Meeting minutes",
    slug: "meeting-minutes",
    description: "Decisions, discussion highlights, and accountable action items.",
    system: "You are a precise minute-taker. Preserve facts and names. Never invent missing details.",
    userTemplate:
      "Create concise meeting minutes from the source below. Include: overview, key points, decisions, and action items with owners when stated.\n\n{{text}}",
    params: { temperature: 0.2, maxTokens: 4096 },
    chunking: { maxInputTokens: 24000, strategy: "map-reduce" },
  },
  {
    name: "Clean document",
    slug: "clean-document",
    description: "Repair OCR errors and restore readable Markdown structure.",
    system: "You are an expert document editor. Preserve meaning and do not add facts.",
    userTemplate:
      "Clean the following extracted text. Fix obvious OCR errors, restore headings and lists, and return only Markdown.\n\n{{text}}",
    params: { temperature: 0.1, maxTokens: 8192 },
    chunking: { maxInputTokens: 24000, strategy: "map-reduce" },
  },
  {
    name: "Executive summary",
    slug: "executive-summary",
    description: "A short, decision-oriented summary of any source.",
    system: "You write accurate, economical executive briefings.",
    userTemplate:
      "Summarize this source for a busy decision-maker. Cover context, important findings, risks, and next steps.\n\n{{text}}",
    params: { temperature: 0.25, maxTokens: 3072 },
    chunking: { maxInputTokens: 24000, strategy: "map-reduce" },
  },
];
