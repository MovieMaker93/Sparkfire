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

describe("settings upgrades", () => {
  let root = "";
  const cloud = { baseUrl: "https://llm.example/v1", model: "my-model", apiKey: "", enabled: true, capabilities: ["text"] };
  const saluki = { model: "saluki-27b", apiKey: "", enabled: true, capabilities: ["text", "image", "tools"] };

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

  it("switches whatever LLM an install had to Saluki once, without its key, and keeps a later choice", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://host.docker.internal:8331/v1");
    await savedBefore({ endpoints: { llm: cloud } }, "sk-cloud");
    let store = await start();
    expect((await store.readSettings()).endpoints.llm).toEqual({ ...saluki, baseUrl: "http://host.docker.internal:8331/v1" });
    expect(JSON.parse(await fs.readFile(path.join(root, "config", "secrets.json"), "utf8")).llm).toBe("");
    expect(JSON.parse(await fs.readFile(path.join(root, "config", "upgrades.json"), "utf8"))).toEqual({ applied: ["llm-saluki-27b"] });

    const settings = await store.readSettings();
    await store.writeSettings({ ...settings, endpoints: { ...settings.endpoints, llm: { ...cloud, capabilities: ["text"] } } });
    store = await start();
    expect((await store.readSettings()).endpoints.llm).toEqual(cloud);
  });

  it("finds Saluki on the Spark the reference preset points at when the environment names no URL", async () => {
    await savedBefore({
      setup: { completed: true, mode: "split", onboardingVersion: 1 },
      endpoints: { ocr: { baseUrl: "http://192.0.2.10:8332/v1", model: "Unlimited-OCR", apiKey: "", enabled: true }, llm: { ...cloud, baseUrl: "http://192.0.2.10:8331/v1", model: "qwen36-35b-a3b-nvfp4" } },
    });
    const store = await start();
    expect((await store.readSettings()).endpoints.llm).toEqual({ ...saluki, baseUrl: "http://192.0.2.10:8331/v1" });
  });

  it("keeps an LLM that already is Saluki", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://host.docker.internal:8331/v1");
    const mine = { ...saluki, baseUrl: "http://127.0.0.1:8331/v1", capabilities: ["text", "image"] };
    await savedBefore({ endpoints: { llm: mine } });
    const store = await start();
    expect((await store.readSettings()).endpoints.llm).toEqual(mine);
  });

  it("keeps the LLM of a custom deployment that has no Saluki to switch to", async () => {
    await savedBefore({ setup: { completed: true, mode: "custom", onboardingVersion: 1 }, endpoints: { llm: cloud } }, "sk-cloud");
    const store = await start();
    expect((await store.readSettings()).endpoints.llm).toEqual({ ...cloud, apiKey: "sk-cloud" });
    await expect(fs.access(path.join(root, "config", "upgrades.json"))).rejects.toThrow();
  });

  it("never switches a new install back after a choice in Settings", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://host.docker.internal:8331/v1");
    let store = await start();
    const settings = await store.readSettings();
    expect(settings.endpoints.llm).toEqual({ ...saluki, baseUrl: "http://host.docker.internal:8331/v1" });
    await store.writeSettings({ ...settings, endpoints: { ...settings.endpoints, llm: { ...cloud, capabilities: ["text"] } } });
    store = await start();
    expect((await store.readSettings()).endpoints.llm).toEqual(cloud);
  });
});
