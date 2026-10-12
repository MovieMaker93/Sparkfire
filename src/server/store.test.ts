import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userFacingOutputFiles } from "./store.js";

describe("user-facing job outputs", () => {
  it("keeps final deliverables and hides processing artifacts", () => {
    expect(userFacingOutputFiles([
      "document.md",
      "pages/001.md",
      "pages/002.md",
      "chunks/0001.json",
      "summary.executive-summary.md",
    ])).toEqual(["document.md", "summary.executive-summary.md"]);
  });
});

describe("the stack's settings", () => {
  let root = "";
  const cloud = { baseUrl: "https://llm.example/v1", model: "my-model", apiKey: "", enabled: true, capabilities: ["text"] };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sparkfire-settings-"));
    vi.stubEnv("DATA_DIR", root);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(root, { recursive: true, force: true });
  });

  /** Starts the app (again) on the settings in the data folder. */
  async function start() {
    vi.resetModules();
    const store = await import("./store.js");
    await store.initializeData();
    return store;
  }

  /** Writes settings saved by an earlier version, with the LLM's key in secrets.json. */
  async function savedBefore(settings: Record<string, unknown>, llmKey = "") {
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    await fs.writeFile(path.join(root, "config", "settings.json"), JSON.stringify({ schemaVersion: 2, ...settings }));
    await fs.writeFile(path.join(root, "config", "secrets.json"), JSON.stringify({ llm: llmKey }));
  }

  /** What compose.dgx.yaml gives the app on the Spark. */
  function onTheSpark() {
    vi.stubEnv("SPARKFIRE_DEPLOYMENT_MODE", "all-in-one");
    vi.stubEnv("SPARKFIRE_SETUP_COMPLETE", "true");
    for (const [name, port] of [["LLM", 8331], ["OCR", 8332], ["STT", 8333], ["TRANSLATION", 8334], ["IMAGE_GENERATION", 8336], ["VIDEO_GENERATION", 8337], ["MUSIC_GENERATION", 8339]] as const) {
      vi.stubEnv(`${name}_BASE_URL`, `http://host.docker.internal:${port}/v1`);
    }
    vi.stubEnv("WEB_SEARCH_BASE_URL", "http://searxng:8080");
  }

  it("applies the stack's models on every start, whatever was saved, and drops saved keys", async () => {
    onTheSpark();
    await savedBefore({
      setup: { completed: true, mode: "all-in-one", onboardingVersion: 1 },
      endpoints: { llm: cloud, ocr: { ...cloud, model: "Unlimited-OCR" }, "image-generation": { ...cloud, model: "Z-Image-Turbo" } },
    }, "sk-cloud");
    const store = await start();
    const settings = await store.readSettings();
    expect(settings.endpoints.llm).toEqual({ baseUrl: "http://host.docker.internal:8331/v1", model: "saluki-27b", apiKey: "", enabled: true, capabilities: ["text", "image", "tools"] });
    expect(settings.endpoints.ocr.model).toBe("PaddleOCR-VL-1.6");
    expect(settings.endpoints["image-generation"].model).toBe("Qwen-Image-2.1-Turbo");
    expect(settings.endpoints["music-generation"].enabled).toBe(true);
    expect(settings.webSearch).toEqual({ enabled: true, provider: "searxng", baseUrl: "http://searxng:8080" });
    expect(JSON.parse(await fs.readFile(path.join(root, "config", "secrets.json"), "utf8")).llm).toBe("");
  });

  it("keeps where setup pointed the stack when the environment does not say", async () => {
    await savedBefore({
      setup: { completed: true, mode: "split", onboardingVersion: 1 },
      endpoints: { ocr: { baseUrl: "http://192.0.2.10:8332/v1", model: "Unlimited-OCR", apiKey: "", enabled: true }, "video-generation": { baseUrl: "http://192.0.2.10:8337/v1", model: "FastH3", apiKey: "", enabled: false }, llm: cloud },
    });
    const store = await start();
    const settings = await store.readSettings();
    expect(settings.endpoints.llm).toMatchObject({ baseUrl: "http://192.0.2.10:8331/v1", model: "saluki-27b" });
    expect(settings.endpoints["video-generation"].enabled).toBe(false);
    expect(settings.webSearch.enabled).toBe(false);
  });

  it("sends an install set up by hand back through setup", async () => {
    await savedBefore({ setup: { completed: true, mode: "custom", onboardingVersion: 1 }, endpoints: { llm: cloud } });
    const store = await start();
    expect((await store.readSettings()).setup.completed).toBe(false);
  });

  it("never lets a save from Settings change the stack", async () => {
    onTheSpark();
    const store = await start();
    const settings = await store.readSettings();
    const saved = await store.saveUserSettings({
      ...settings,
      ui: { ...settings.ui, theme: "light" },
      webSearch: { enabled: false, provider: "searxng", baseUrl: "" },
      systemStatus: { baseUrl: "" },
      endpoints: { ...settings.endpoints, llm: { ...cloud, capabilities: ["text"] } },
    });
    expect(saved.ui.theme).toBe("light");
    expect(saved.endpoints).toEqual(settings.endpoints);
    expect(saved.webSearch).toEqual(settings.webSearch);
    expect(saved.systemStatus).toEqual(settings.systemStatus);
    expect((await store.readSettings()).endpoints.llm.model).toBe("saluki-27b");
  });

  it("starts new conversations with web search on", async () => {
    const store = await start();
    expect((await store.createChat()).webSearch).toBe(true);
  });
});
