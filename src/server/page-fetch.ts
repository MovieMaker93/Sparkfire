import { lookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { Agent, fetch } from "undici";

export const PAGE_FETCH_LIMITS = {
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  maxChars: 24_000,
};

const USER_AGENT = "Mozilla/5.0 (compatible; Sparkfire; +https://github.com/MovieMaker93/Sparkfire)";
const READABLE_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

// The model chooses the URLs, and a page it read could steer it toward the user's own network, so only public
// addresses are reachable: loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved are not.
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

/** True for any address a page fetch must not reach. IPv4-mapped IPv6 addresses are judged by their IPv4 part. */
export function isPrivateAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

export interface ReadPageOptions {
  signal?: AbortSignal;
  /** Replaced in tests, which serve pages from loopback. */
  isBlocked?: (address: string) => boolean;
}

export interface ReadPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

/**
 * A DNS lookup for the connection itself that refuses names resolving to a blocked address. Checking the
 * addresses actually dialled means a name that resolves differently a second time (DNS rebinding) cannot slip through.
 */
export function publicLookup(isBlocked: (address: string) => boolean = isPrivateAddress) {
  return (
    hostname: string,
    options: { family?: number; all?: boolean },
    callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    lookup(hostname, { all: true, family: options.family || 0 }, (error, addresses) => {
      if (error) return callback(error, []);
      if (!addresses.length || addresses.some((entry) => isBlocked(entry.address))) {
        return callback(new Error(`${hostname} is not a public address`), []);
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function guardedAgent(isBlocked: (address: string) => boolean) {
  return new Agent({
    connect: { lookup: publicLookup(isBlocked) as never },
    headersTimeout: PAGE_FETCH_LIMITS.timeoutMs,
    bodyTimeout: PAGE_FETCH_LIMITS.timeoutMs,
  });
}

function checkedUrl(value: string, isBlocked: (address: string) => boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages can be read");
  if (url.username || url.password) throw new Error("URLs with credentials are not read");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal IP address is dialled without a lookup, so it is checked here.
  if (isIP(host) && isBlocked(host)) throw new Error(`${host} is not a public address`);
  return url;
}

async function readCapped(body: AsyncIterable<Uint8Array> | null) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!body) return { bytes: new Uint8Array(), cut: false };
  for await (const chunk of body) {
    const room = PAGE_FETCH_LIMITS.maxBytes - size;
    chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    size += Math.min(chunk.length, room);
    if (size >= PAGE_FETCH_LIMITS.maxBytes) return { bytes: Buffer.concat(chunks), cut: true };
  }
  return { bytes: Buffer.concat(chunks), cut: false };
}

function decode(bytes: Uint8Array, contentType: string) {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function tidy(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The readable text of an HTML page: Readability's article when it finds one, otherwise the whole body. */
export function readableText(html: string, url: string) {
  const { document } = parseHTML(html);
  const fallbackTitle = document.querySelector("title")?.textContent?.trim() || "";
  try {
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.textContent?.trim()) return { title: article.title?.trim() || fallbackTitle || url, text: tidy(article.textContent) };
  } catch {
    // Readability gives up on some markup; the body text below is still useful.
  }
  for (const element of [...document.querySelectorAll("script, style, noscript, template, svg")]) element.remove();
  return { title: fallbackTitle || url, text: tidy(document.body?.textContent || document.documentElement?.textContent || "") };
}

/** Downloads one public web page and returns its readable text, within the limits in PAGE_FETCH_LIMITS. */
export async function readPage(address: string, options: ReadPageOptions = {}): Promise<ReadPage> {
  const isBlocked = options.isBlocked || isPrivateAddress;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(PAGE_FETCH_LIMITS.timeoutMs)])
    : AbortSignal.timeout(PAGE_FETCH_LIMITS.timeoutMs);
  const dispatcher = guardedAgent(isBlocked);
  try {
    let url = checkedUrl(address, isBlocked);
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(url, {
        dispatcher,
        redirect: "manual",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1" },
      }).catch((error: unknown) => {
        // fetch reports every network failure as "fetch failed"; the cause says what the model needs to know.
        const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
        throw cause && !signal.aborted ? new Error(cause.message) : error;
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        await response.body?.cancel().catch(() => undefined);
        if (redirects >= PAGE_FETCH_LIMITS.maxRedirects) throw new Error("The page redirected too many times");
        url = checkedUrl(new URL(response.headers.get("location")!, url).href, isBlocked);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`The site answered ${response.status} ${response.statusText}`.trim());
      }
      const contentType = response.headers.get("content-type") || "text/html";
      const mimeType = contentType.split(";")[0].trim().toLowerCase();
      if (!READABLE_TYPES.has(mimeType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Only web pages and plain text can be read, not ${mimeType}`);
      }
      const { bytes, cut } = await readCapped(response.body);
      const raw = decode(bytes, contentType);
      const page = mimeType === "text/plain" ? { title: url.href, text: tidy(raw) } : readableText(raw, url.href);
      const truncated = cut || page.text.length > PAGE_FETCH_LIMITS.maxChars;
      return { url: url.href, title: page.title, text: page.text.slice(0, PAGE_FETCH_LIMITS.maxChars), truncated };
    }
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}
