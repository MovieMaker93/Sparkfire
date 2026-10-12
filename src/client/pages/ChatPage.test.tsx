import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { answerSources, ChatMarkdown, chatReferenceNames, formatMessageTime, formatMessageTimestamp, webSearchUsable } from "./ChatPage";
import { defaultSettings } from "../../server/config";
import type { Chat, Job } from "../types";

describe("ChatMarkdown", () => {
  it("renders rich Markdown and safe inline HTML", () => {
    const html = renderToStaticMarkup(<ChatMarkdown>{`# Heading

**Bold**, *italic*, and <u>underlined</u>.

---

| Name | Value |
| --- | --- |
| One | Two |

[OpenAI](https://openai.com)

<script>alert("unsafe")</script>`}</ChatMarkdown>);

    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<u>underlined</u>");
    expect(html).toContain("<hr/>");
    expect(html).toContain('class="markdown-table-wrap"');
    expect(html).toContain('<a href="https://openai.com" target="_blank" rel="noreferrer">');
    expect(html).not.toContain("<script");
  });
});

describe("formatMessageTimestamp", () => {
  it("uses the configured timezone for both the date and time", () => {
    const timestamp = formatMessageTimestamp("2026-09-01T00:30:00.000Z", "Asia/Macau");
    expect(timestamp).toContain("Sep 1, 2026");
    expect(timestamp).toMatch(/8:30\s*AM/);
    expect(timestamp).toMatch(/GMT\+8/);
    expect(formatMessageTime("2026-09-01T00:30:00.000Z", "Asia/Macau")).toMatch(/8:30\s*AM/);
  });
});

describe("chatReferenceNames", () => {
  it("combines source files and explicitly linked image artifacts without duplicates", () => {
    const chat = { linkedArtifactIds: ["image-1"] } as Pick<Chat, "linkedArtifactIds">;
    const job = {
      inputs: [{ name: "notes.md", storedName: "notes.md", mimeType: "text/markdown", size: 12 }],
      artifacts: [
        { id: "image-1", name: "reference.png", role: "primary" },
        { id: "other", name: "ignored.json", role: "supplementary" },
      ],
    } as Job;

    expect(chatReferenceNames(chat, job)).toEqual(["notes.md", "reference.png"]);
  });
});

describe("web search in chat", () => {
  it("offers the Web switch only with a configured service and a tool-calling model", () => {
    const settings = structuredClone(defaultSettings);
    // A model that has not declared tool calling (Saluki, the default, has).
    settings.endpoints.llm.capabilities = ["text"];
    settings.webSearch = { enabled: true, provider: "searxng", baseUrl: "http://127.0.0.1:8338" };
    expect(webSearchUsable(settings)).toBe(false);
    settings.endpoints.llm.capabilities = ["text", "tools"];
    expect(webSearchUsable(settings)).toBe(true);
  });

  it("lists each source once by number, preferring the title of a page the model read", () => {
    expect(answerSources([
      { id: "a", tool: "web_search", input: "spark", status: "done", sources: [{ n: 1, title: "Snippet title", url: "https://a.example" }, { n: 2, title: "B", url: "https://b.example" }] },
      { id: "b", tool: "fetch_page", input: "https://a.example", status: "done", sources: [{ n: 1, title: "Page title", url: "https://a.example" }] },
      { id: "c", tool: "web_search", input: "again", status: "done", sources: [{ n: 2, title: "B again", url: "https://b.example" }] },
    ])).toEqual([{ n: 1, title: "Page title", url: "https://a.example" }, { n: 2, title: "B", url: "https://b.example" }]);
  });
});
