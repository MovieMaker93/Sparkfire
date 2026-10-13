import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelToolCall } from "./ai.js";
import { defaultSettings } from "./config.js";
import { checkWebSearch, searxngProvider, webSearchAvailable, webSearchNote, WebToolSession, type SearchProvider } from "./web-search.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((work) => work())); });

async function searxng(handler: (url: URL) => { status?: number; body?: unknown }) {
  const server = createServer((request, response) => {
    const { status = 200, body } = handler(new URL(request.url!, "http://localhost"));
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const call = (name: string, args: unknown, id = "call"): ModelToolCall => ({
  id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

describe("SearXNG provider", () => {
  it("asks for JSON and keeps the first five web results", async () => {
    const seen: URL[] = [];
    const base = await searxng((url) => {
      seen.push(url);
      return { body: { results: [
        { title: "Not a page", url: "ftp://files.example" },
        ...Array.from({ length: 7 }, (_, index) => ({ title: ` Result ${index} `, url: `https://example.com/${index}`, content: "A  short\nsnippet", publishedDate: index === 0 ? "2026-10-01" : null })),
      ] } };
    });
    const hits = await searxngProvider(`${base}/`).search("spark memory");
    expect(seen[0].pathname).toBe("/search");
    expect(Object.fromEntries(seen[0].searchParams)).toEqual({ q: "spark memory", format: "json" });
    expect(hits).toHaveLength(5);
    expect(hits[0]).toEqual({ title: "Result 0", url: "https://example.com/0", snippet: "A short snippet", publishedDate: "2026-10-01" });
  });

  it("explains a refused JSON format and reports health", async () => {
    const base = await searxng(() => ({ status: 403 }));
    await expect(searxngProvider(base).search("x")).rejects.toThrow("enable the json format");
    expect(await checkWebSearch({ enabled: true, provider: "searxng", baseUrl: base })).toMatchObject({ ok: false, error: expect.stringContaining("json format") });
    expect(await checkWebSearch({ enabled: false, provider: "searxng", baseUrl: "" })).toMatchObject({ ok: false, error: "Not configured" });
  });
});

describe("web search availability", () => {
  it("needs a configured service and a model that declares tool calling", () => {
    const settings = structuredClone(defaultSettings);
    // A model that has not declared tool calling (Saluki, the default, has).
    settings.endpoints.llm.capabilities = ["text"];
    expect(webSearchAvailable(settings)).toBe(false);
    settings.webSearch = { enabled: true, provider: "searxng", baseUrl: "http://127.0.0.1:8338" };
    expect(webSearchAvailable(settings)).toBe(false);
    settings.endpoints.llm.capabilities = ["text", "tools"];
    expect(webSearchAvailable(settings)).toBe(true);
    settings.webSearch.enabled = false;
    expect(webSearchAvailable(settings)).toBe(false);
  });
});

describe("WebToolSession", () => {
  const provider: SearchProvider = {
    search: async (query) => [
      { title: "First", url: "https://a.example/1", snippet: `about ${query}` },
      { title: "Second", url: "https://b.example/2", snippet: "" },
    ],
  };

  it("numbers sources across searches and pages, reusing the number of a URL seen before", async () => {
    const read = vi.fn(async (url: string) => ({ url, title: "Second page", text: "Body text", truncated: true }));
    const session = new WebToolSession(provider, read);
    const signal = new AbortController().signal;

    const search = await session.execute(call("web_search", { query: "spark" }), signal);
    expect(search.sources).toEqual([{ n: 1, title: "First", url: "https://a.example/1" }, { n: 2, title: "Second", url: "https://b.example/2" }]);
    expect(search.content).toContain('[1] First\nURL: https://a.example/1\nabout spark');

    const page = await session.execute(call("fetch_page", { url: "https://b.example/2" }), signal);
    expect(page.sources).toEqual([{ n: 2, title: "Second page", url: "https://b.example/2" }]);
    expect(page.content).toContain("[2] Second page");
    expect(page.content).toContain("this is its beginning");

    const other = await session.execute(call("fetch_page", { url: "https://c.example" }), signal);
    expect(other.sources?.[0].n).toBe(3);
  });

  it("turns bad arguments and failures into errors the model can read", async () => {
    const session = new WebToolSession(provider, async () => { throw new Error("10.0.0.1 is not a public address"); });
    const signal = new AbortController().signal;
    expect(await session.execute(call("web_search", "{not json"), signal)).toEqual({ content: "Error: The tool arguments were not valid JSON", error: "The tool arguments were not valid JSON" });
    expect((await session.execute(call("web_search", { query: " " }), signal)).error).toBe("The search query was empty");
    expect((await session.execute(call("fetch_page", { url: "http://10.0.0.1" }), signal)).content).toBe("Error: 10.0.0.1 is not a public address");
    expect(session.describe(call("run_shell", {}))).toBeUndefined();
    expect(session.describe(call("fetch_page", { url: " https://x.example " }))).toEqual({ tool: "fetch_page", input: "https://x.example" });
  });

  it("says when a search finds nothing", async () => {
    const session = new WebToolSession({ search: async () => [] });
    expect(await session.execute(call("web_search", { query: "zzz" }), new AbortController().signal)).toEqual({ content: 'No results for "zzz".' });
  });
});

describe("webSearchNote", () => {
  it("gives the date in the user's time zone and asks for numbered citations", () => {
    const note = webSearchNote(new Date("2026-10-11T23:30:00Z"), "Europe/Zurich");
    expect(note).toContain("Today is Monday, 12 October 2026.");
    expect(note).toContain("[1](https://example.com)");
    expect(webSearchNote(new Date("2026-10-11T12:00:00Z"), "Not/AZone")).toContain("Today is 2026-10-11.");
  });
});
