import type { ModelToolCall } from "./ai.js";
import type { ChatTools } from "./chat-generation.js";
import type { Settings } from "./models.js";
import { readPage, type ReadPage } from "./page-fetch.js";
import type { ChatSource, ChatTool } from "../shared/contracts.js";

export const MAX_SEARCH_RESULTS = 5;
/** Rounds of tool calls in one answer; after them the model must answer from what it found. */
export const MAX_TOOL_ROUNDS = 6;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface SearchProvider {
  search(query: string, signal?: AbortSignal): Promise<SearchHit[]>;
}

/** SearXNG's JSON API, which its settings.yml must allow (`search.formats` includes `json`). */
export function searxngProvider(baseUrl: string): SearchProvider {
  return {
    async search(query, signal) {
      const url = new URL(`${baseUrl.replace(/\/$/, "")}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      const timeout = AbortSignal.timeout(10_000);
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (response.status === 403) throw new Error("The search service refused JSON results; enable the json format in its settings");
      if (!response.ok) throw new Error(`The search service answered ${response.status} ${response.statusText}`.trim());
      const body = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: string | null }> };
      return (body.results || [])
        .filter((result) => result.url && /^https?:\/\//i.test(result.url))
        .slice(0, MAX_SEARCH_RESULTS)
        .map((result) => ({
          title: result.title?.trim() || result.url!,
          url: result.url!,
          snippet: (result.content || "").replace(/\s+/g, " ").trim(),
          ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
        }));
    },
  };
}

export function searchProvider(settings: Settings["webSearch"]): SearchProvider {
  return searxngProvider(settings.baseUrl);
}

export function webSearchConfigured(settings: Settings) {
  return Boolean(settings.webSearch.enabled && settings.webSearch.baseUrl);
}

/** Whether a chat may use the web: configured, the model declares tool calling, and the user turned it on. */
export function webSearchAvailable(settings: Settings) {
  return webSearchConfigured(settings) && Boolean(settings.endpoints.llm.capabilities?.includes("tools"));
}

export async function checkWebSearch(settings: Settings["webSearch"]) {
  if (!settings.baseUrl) return { ok: false, latencyMs: 0, results: 0, error: "Not configured" };
  const started = performance.now();
  try {
    const hits = await searchProvider(settings).search("Sparkfire");
    return { ok: true, latencyMs: Math.round(performance.now() - started), results: hits.length };
  } catch (error) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), results: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export const WEB_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web. Returns numbered results with title, URL and a short snippet. Use for anything current or that you are unsure of.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for, as you would type it into a search engine" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description: "Read the main text of a web page, for example a search result whose snippet is not enough.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The http or https URL of the page" } },
        required: ["url"],
      },
    },
  },
] as const;

/**
 * Tells the model the date, which it cannot know, and how to cite. Sent with each request while web search is
 * on and never saved, so the conversation on disk stays what the user and model wrote.
 */
export function webSearchNote(now: Date, timeZone: string) {
  let today: string;
  try {
    today = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone }).format(now);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return [
    `Today is ${today}.`,
    "You can search the web with web_search and read a page with fetch_page. Search whenever the question needs current or specific facts you are not sure of, and prefer reading a page over guessing from a snippet.",
    "Cite the sources you use with their numbers as Markdown links, like [1](https://example.com). Never invent a source or a URL.",
  ].join(" ");
}

function argumentsOf(call: ModelToolCall) {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** The web tools for one answer. Sources are numbered across all its searches and pages, so [n] stays stable. */
export class WebToolSession implements ChatTools {
  readonly maxRounds = MAX_TOOL_ROUNDS;
  private readonly numbers = new Map<string, number>();

  constructor(
    private readonly provider: SearchProvider,
    private readonly read: (url: string, signal: AbortSignal) => Promise<ReadPage> = (url, signal) => readPage(url, { signal }),
  ) {}

  describe(call: ModelToolCall): { tool: ChatTool; input: string } | undefined {
    const args = argumentsOf(call);
    if (call.function.name === "web_search") return { tool: "web_search", input: String(args?.query ?? "").trim() };
    if (call.function.name === "fetch_page") return { tool: "fetch_page", input: String(args?.url ?? "").trim() };
    return undefined;
  }

  async execute(call: ModelToolCall, signal: AbortSignal) {
    const described = this.describe(call);
    if (!described) return { content: `Error: there is no tool named "${call.function.name}".`, error: "Unknown tool" };
    if (!argumentsOf(call)) return this.failed("The tool arguments were not valid JSON");
    if (!described.input) return this.failed(described.tool === "web_search" ? "The search query was empty" : "The URL was empty");
    try {
      return described.tool === "web_search" ? await this.search(described.input, signal) : await this.fetchPage(described.input, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return this.failed(error instanceof Error ? error.message : String(error));
    }
  }

  private failed(error: string) {
    return { content: `Error: ${error}`, error };
  }

  private source(url: string, title: string): ChatSource {
    let n = this.numbers.get(url);
    if (!n) {
      n = this.numbers.size + 1;
      this.numbers.set(url, n);
    }
    return { n, title, url };
  }

  private async search(query: string, signal: AbortSignal) {
    const hits = await this.provider.search(query, signal);
    if (!hits.length) return { content: `No results for "${query}".` };
    const sources = hits.map((hit) => this.source(hit.url, hit.title));
    const content = [`Search results for "${query}":`, ...hits.map((hit, index) => [
      `[${sources[index].n}] ${hit.title}`,
      `URL: ${hit.url}`,
      ...(hit.publishedDate ? [`Published: ${hit.publishedDate}`] : []),
      ...(hit.snippet ? [hit.snippet] : []),
    ].join("\n"))].join("\n\n");
    return { content, sources };
  }

  private async fetchPage(url: string, signal: AbortSignal) {
    const page = await this.read(url, signal);
    const source = this.source(page.url, page.title);
    const content = [
      `[${source.n}] ${page.title}`,
      `URL: ${page.url}`,
      "",
      page.text || "(The page has no readable text.)",
      ...(page.truncated ? ["", "(The page was longer; this is its beginning.)"] : []),
    ].join("\n");
    return { content, sources: [source] };
  }
}
