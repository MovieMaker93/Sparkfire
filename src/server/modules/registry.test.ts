import { describe, expect, it } from "vitest";
import { defaultSettings } from "../config.js";
import type { Settings } from "../models.js";
import { listModules } from "./registry.js";

function settingsWith(patch: Partial<Settings["endpoints"]>): Settings {
  const settings = structuredClone(defaultSettings);
  settings.endpoints = { ...settings.endpoints, ...patch };
  return settings;
}

const off = { baseUrl: "", model: "", apiKey: "", enabled: false };
const on = { baseUrl: "http://192.0.2.10:8335/v1", model: "grounding-model", apiKey: "", enabled: true };

describe("module listing", () => {
  it("hides grounding and opt-in music while their endpoints are off, and nothing else", () => {
    const modules = listModules(settingsWith({ grounding: off, translation: off, "music-generation": off }));
    expect(modules.find((module) => module.id === "grounding")).toMatchObject({ configured: false, hidden: true });
    // Modules whose service the stack ships stay visible, with their setup note, even when unconfigured.
    expect(modules.find((module) => module.id === "translation")).toMatchObject({ configured: false, hidden: false });
    expect(modules.filter((module) => module.hidden).map((module) => module.id)).toEqual(["grounding", "text-to-music"]);
    expect(listModules(settingsWith({ "music-generation": on })).find((module) => module.id === "text-to-music")).toMatchObject({ configured: true, hidden: false });
  });

  it("shows grounding again once an endpoint is configured", () => {
    expect(listModules(settingsWith({ grounding: on })).find((module) => module.id === "grounding")).toMatchObject({ configured: true, hidden: false });
    expect(listModules(settingsWith({ grounding: { ...on, enabled: false } })).find((module) => module.id === "grounding")?.hidden).toBe(true);
  });

  it("hides nothing when settings are unknown", () => {
    expect(listModules().some((module) => module.hidden)).toBe(false);
  });
});
