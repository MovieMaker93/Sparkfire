import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("chat attachments", () => {
  let root = "";
  const previousDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sparklingkit-chat-attachments-"));
    process.env.DATA_DIR = root;
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
    vi.resetModules();
  });

  async function upload(name: string, mimetype: string, body: string | Buffer) {
    const file = path.join(root, `upload-${name}`);
    await fs.writeFile(file, body);
    return { path: file, originalname: name, mimetype, size: Buffer.byteLength(body) };
  }

  it("sorts files into images the model sees and documents it reads", async () => {
    const { classifyAttachment } = await import("./chat-attachments.js");
    expect(classifyAttachment("photo.JPG", "application/octet-stream")).toEqual({ kind: "image", mimeType: "image/jpeg" });
    expect(classifyAttachment("paper.pdf", "application/pdf")).toEqual({ kind: "document", mimeType: "application/pdf" });
    expect(classifyAttachment("notes.md", "text/markdown")).toEqual({ kind: "document", mimeType: "text/markdown" });
    expect(classifyAttachment("main.py", "application/octet-stream")).toEqual({ kind: "document", mimeType: "text/plain" });
    expect(classifyAttachment("logo.svg", "image/svg+xml")).toBeUndefined();
    expect(classifyAttachment("setup.exe", "application/x-msdownload")).toBeUndefined();
  });

  it("sends document text and images with their messages, newest images first", async () => {
    const store = await import("./store.js");
    await store.initializeData();
    const settings = await store.readSettings();
    settings.endpoints.llm.capabilities = ["text", "image"];
    const { saveChatAttachment, readChatAttachment, MAX_MODEL_IMAGES } = await import("./chat-attachments.js");
    const chat = await store.createChat();

    const notes = await saveChatAttachment(chat.id, await upload("notes.md", "text/markdown", "# Plan\nShip on Friday."), true);
    expect(notes).toMatchObject({ name: "notes.md", kind: "document", textChars: 22 });
    expect(await readChatAttachment(chat.id, notes.id)).toEqual(notes);
    const images = [];
    for (let index = 0; index <= MAX_MODEL_IMAGES; index += 1) {
      images.push(await saveChatAttachment(chat.id, await upload(`shot-${index}.png`, "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, index])), true));
    }
    const now = new Date().toISOString();
    chat.messages.push({ id: "m1", role: "user", content: "Summarize", createdAt: now, attachments: [notes, images[0]] });
    chat.messages.push({ id: "m2", role: "assistant", content: "Done", createdAt: now });
    chat.messages.push({ id: "m3", role: "user", content: "And these?", createdAt: now, attachments: images.slice(1) });

    const { modelMessagesForChat } = await import("./chat-messages.js");
    const [first, second, third] = await modelMessagesForChat(chat, settings);
    expect(first.content).toEqual([
      { type: "text", text: "Summarize" },
      { type: "text", text: "Attached file \"notes.md\":\n\n# Plan\nShip on Friday." },
      // The oldest image falls outside the per-request image budget, so it is named instead.
      { type: "text", text: "[The file \"shot-0.png\" was shared earlier in this conversation.]" },
    ]);
    expect(second.content).toBe("Done");
    expect(Array.isArray(third.content) && third.content.filter((part) => part.type === "image_url")).toHaveLength(MAX_MODEL_IMAGES);
  });

  it("refuses images when the model has no image input, and unsupported files", async () => {
    const store = await import("./store.js");
    await store.initializeData();
    const { saveChatAttachment } = await import("./chat-attachments.js");
    const chat = await store.createChat();
    await expect(saveChatAttachment(chat.id, await upload("a.png", "image/png", "x"), false)).rejects.toThrow("does not accept image input");
    await expect(saveChatAttachment(chat.id, await upload("a.zip", "application/zip", "x"), true)).rejects.toThrow("attach images, PDFs");
  });
});
