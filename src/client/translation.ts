import { api } from "./api";
import type { Job } from "./types";

export const translationLanguages = [
  ["Chinese", "zh"], ["English", "en"], ["French", "fr"], ["Portuguese", "pt"], ["Spanish", "es"], ["Japanese", "ja"], ["Turkish", "tr"], ["Russian", "ru"], ["Arabic", "ar"], ["Korean", "ko"], ["Thai", "th"], ["Italian", "it"], ["German", "de"], ["Vietnamese", "vi"], ["Malay", "ms"], ["Indonesian", "id"], ["Filipino", "tl"], ["Hindi", "hi"], ["Traditional Chinese", "zh-Hant"], ["Polish", "pl"], ["Czech", "cs"], ["Dutch", "nl"], ["Khmer", "km"], ["Burmese", "my"], ["Persian", "fa"], ["Gujarati", "gu"], ["Urdu", "ur"], ["Telugu", "te"], ["Marathi", "mr"], ["Hebrew", "he"], ["Bengali", "bn"], ["Tamil", "ta"], ["Ukrainian", "uk"], ["Tibetan", "bo"], ["Kazakh", "kk"], ["Mongolian", "mn"], ["Uyghur", "ug"], ["Cantonese", "yue"],
] as const;

const supportedTranslationLanguageNames: readonly string[] = translationLanguages.map(([name]) => name);
export const translationPreferenceKey = "sparkfire.translation.preferences";

export interface TranslationPreferences {
  source: string;
  target: string;
  recent: string[];
}

export function savedTranslationPreferences(): TranslationPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(translationPreferenceKey) || "{}") as Partial<TranslationPreferences>;
    return {
      source: parsed.source === "auto-detect" || supportedTranslationLanguageNames.includes(parsed.source || "") ? parsed.source! : "auto-detect",
      target: supportedTranslationLanguageNames.includes(parsed.target || "") ? parsed.target! : "Traditional Chinese",
      recent: parsed.recent?.filter((language) => supportedTranslationLanguageNames.includes(language)).slice(0, 4) || ["Traditional Chinese", "English"],
    };
  } catch {
    return { source: "auto-detect", target: "Traditional Chinese", recent: ["Traditional Chinese", "English"] };
  }
}

/** Polls a translation job until its text result is ready, or about ten minutes pass. */
export async function waitForTranslation(jobId: string): Promise<{ job: Job; text: string }> {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const job = await api.job(jobId);
    if (["done", "done_with_warnings"].includes(job.status)) {
      const output = job.outputFiles.find((file) => file.startsWith("translation."));
      if (!output) throw new Error("The translation completed without a text result");
      const response = await fetch(`/api/jobs/${job.id}/files/${output.split("/").map(encodeURIComponent).join("/")}`);
      if (!response.ok) throw new Error("Could not load the translated text");
      return { job, text: (await response.text()).trim() };
    }
    if (["failed", "cancelled"].includes(job.status)) throw new Error(job.error || `Translation ${job.status}`);
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("Translation is still running. Open its job to follow it.");
}
