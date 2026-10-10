import { afterEach, describe, expect, it, vi } from "vitest";
import { modelLabel, readChatEffort, saveChatEffort } from "./chat-effort";

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    },
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("chat effort", () => {
  it("defaults to the model's own effort and remembers a choice", () => {
    const values = stubStorage();
    expect(readChatEffort()).toBe("high");
    saveChatEffort("off");
    expect(values.get("sparklingkit:chat-effort")).toBe("off");
    expect(readChatEffort()).toBe("off");
  });

  it("ignores unknown stored values and unavailable storage", () => {
    stubStorage({ "sparklingkit:chat-effort": "xhigh" });
    expect(readChatEffort()).toBe("high");
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(readChatEffort()).toBe("high");
    expect(() => saveChatEffort("low")).not.toThrow();
  });
});

describe("modelLabel", () => {
  it("names the fork's models and passes others through", () => {
    expect(modelLabel("saluki-27b")).toBe("Saluki 27B");
    expect(modelLabel("my-model")).toBe("my-model");
    expect(modelLabel(undefined)).toBe("");
  });
});
