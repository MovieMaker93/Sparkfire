import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isPrivateAddress, PAGE_FETCH_LIMITS, readableText, readPage } from "./page-fetch.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((work) => work())); });

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// The test pages are on loopback, which the real guard refuses; these tests allow it unless they test the guard.
const allowAll = { isBlocked: () => false };

const article = `<!doctype html><html><head><title>Spark news</title><script>alert(1)</script></head><body>
  <nav>Home | About | Contact</nav>
  <article><h1>The Spark ships</h1>${"<p>The DGX Spark has 128 GB of unified memory shared by CPU and GPU, which is enough for several models at once.</p>".repeat(6)}</article>
  <footer>Copyright</footer></body></html>`;

describe("isPrivateAddress", () => {
  it("refuses loopback, private, link-local, CGNAT and IPv6 local ranges, including IPv4-mapped forms", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(address), address).toBe(false);
  });
});

describe("readPage", () => {
  it("returns the article text without navigation, scripts or markup", async () => {
    const base = await serve((_request, response) => { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(article); });
    const page = await readPage(`${base}/news`, allowAll);
    expect(page.title).toBe("Spark news");
    expect(page.text).toContain("128 GB of unified memory");
    expect(page.text).not.toContain("alert(1)");
    expect(page.text).not.toContain("<p>");
    expect(page.truncated).toBe(false);
  });

  it("follows a redirect and reports the final URL", async () => {
    const base = await serve((request, response) => {
      if (request.url === "/old") { response.writeHead(301, { Location: "/new" }); return response.end(); }
      response.setHeader("Content-Type", "text/plain");
      response.end("moved here");
    });
    expect(await readPage(`${base}/old`, allowAll)).toMatchObject({ url: `${base}/new`, text: "moved here" });
  });

  it("refuses loopback by address and by name, so the guard applies to the connection itself", async () => {
    const base = await serve((_request, response) => response.end("secret"));
    const port = new URL(base).port;
    await expect(readPage(base)).rejects.toThrow("not a public address");
    await expect(readPage(`http://localhost:${port}/`)).rejects.toThrow("localhost is not a public address");
  });

  it("refuses a redirect to a private address", async () => {
    const base = await serve((_request, response) => { response.writeHead(302, { Location: "http://10.0.0.5/admin" }); response.end(); });
    await expect(readPage(base, { isBlocked: (address) => address.startsWith("10.") })).rejects.toThrow("10.0.0.5 is not a public address");
  });

  it("stops after three redirects", async () => {
    const base = await serve((request, response) => { response.writeHead(302, { Location: `/r${Number(request.url!.slice(2) || 0) + 1}` }); response.end(); });
    await expect(readPage(`${base}/r0`, allowAll)).rejects.toThrow("redirected too many times");
  });

  it("refuses other schemes and content that is not a page", async () => {
    await expect(readPage("file:///etc/passwd", allowAll)).rejects.toThrow("Only http and https");
    const base = await serve((_request, response) => { response.setHeader("Content-Type", "application/pdf"); response.end("%PDF"); });
    await expect(readPage(base, allowAll)).rejects.toThrow("not application/pdf");
  });

  it("reads at most the download cap and marks the page as cut", async () => {
    const base = await serve((_request, response) => {
      response.setHeader("Content-Type", "text/plain");
      response.end("word ".repeat(PAGE_FETCH_LIMITS.maxBytes / 2));
    });
    const page = await readPage(base, allowAll);
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(PAGE_FETCH_LIMITS.maxChars);
  });

  it("reports an error status from the site", async () => {
    const base = await serve((_request, response) => { response.statusCode = 404; response.end("nope"); });
    await expect(readPage(base, allowAll)).rejects.toThrow("404");
  });
});

describe("readableText", () => {
  it("falls back to the body text when there is no article", () => {
    expect(readableText("<html><head><title>T</title><style>p{}</style></head><body><p>Short   note</p></body></html>", "https://x.test"))
      .toEqual({ title: "T", text: "Short note" });
  });
});
