import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { rasterizePdf, runCommand } from "./media.js";
import { MAX_CHAT_ATTACHMENTS } from "../shared/contracts.js";
import type { ChatAttachment } from "./models.js";
import { assertSafeName } from "./store.js";

export const MAX_ATTACHMENTS_PER_MESSAGE = MAX_CHAT_ATTACHMENTS;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
// Keeps a long document inside the model's context (64k tokens on the Spark) with room for the conversation.
export const MAX_DOCUMENT_CHARS = 60_000;
// Images sent per request, newest first; older ones are named in text instead.
export const MAX_MODEL_IMAGES = 4;
const MAX_SCANNED_PAGES = 4;

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".html", ".htm", ".yaml", ".yml", ".toml", ".ini", ".log",
  ".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".rb", ".php",
  ".swift", ".sh", ".ps1", ".sql", ".css", ".scss",
]);

type UploadedFile = { path: string; originalname: string; mimetype: string; size: number };

function attachmentsDir(chatId: string) {
  assertSafeName(chatId);
  return path.join(DATA_DIR, "chats", chatId, "attachments");
}

function attachmentFile(chatId: string, id: string, suffix: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Unknown attachment");
  return path.join(attachmentsDir(chatId), `${id}${suffix}`);
}

/** What the model receives for a file: an image it looks at, or a document whose text it reads. */
export function classifyAttachment(name: string, mimeType: string): { kind: ChatAttachment["kind"]; mimeType: string } | undefined {
  const extension = path.extname(name).toLowerCase();
  const declared = mimeType.toLowerCase().split(";")[0];
  const imageType = IMAGE_TYPES[extension] || (Object.values(IMAGE_TYPES).includes(declared) ? declared : undefined);
  if (imageType) return { kind: "image", mimeType: imageType };
  if (extension === ".pdf" || declared === "application/pdf") return { kind: "document", mimeType: "application/pdf" };
  if (TEXT_EXTENSIONS.has(extension) || declared.startsWith("text/")) return { kind: "document", mimeType: declared.startsWith("text/") ? declared : "text/plain" };
  return undefined;
}

/** Stores an uploaded file in the chat folder and prepares what the model will read from it. */
export async function saveChatAttachment(chatId: string, file: UploadedFile, acceptsImages: boolean): Promise<ChatAttachment> {
  const type = classifyAttachment(file.originalname, file.mimetype);
  if (!type) throw new Error(`${file.originalname}: attach images, PDFs, or text and code files`);
  if (type.kind === "image" && !acceptsImages) throw new Error("The configured LLM does not accept image input");
  if (file.size > (type.kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES)) throw new Error(`${file.originalname} is too large to attach`);

  const id = randomUUID();
  const folder = attachmentsDir(chatId);
  await fs.mkdir(folder, { recursive: true });
  const original = attachmentFile(chatId, id, path.extname(file.originalname).toLowerCase() || ".bin");
  await fs.rename(file.path, original).catch(async () => {
    await fs.copyFile(file.path, original);
    await fs.unlink(file.path);
  });
  const attachment: ChatAttachment = { id, name: path.basename(file.originalname), mimeType: type.mimeType, size: file.size, kind: type.kind };
  try {
    if (type.kind === "document") Object.assign(attachment, await extractDocument(chatId, id, original, type.mimeType, acceptsImages));
  } catch (error) {
    await fs.rm(original, { force: true });
    throw error;
  }
  await fs.writeFile(attachmentFile(chatId, id, ".json"), `${JSON.stringify({ ...attachment, storedName: path.basename(original) })}\n`, "utf8");
  return attachment;
}

async function extractDocument(chatId: string, id: string, file: string, mimeType: string, acceptsImages: boolean) {
  let text = "";
  if (mimeType === "application/pdf") {
    const textFile = attachmentFile(chatId, id, ".txt");
    await runCommand("pdftotext", ["-layout", "-enc", "UTF-8", file, textFile], 5 * 60_000);
    text = await fs.readFile(textFile, "utf8").catch(() => "");
    if (!text.trim()) {
      // A scan has no text layer: send its first pages as images instead.
      if (!acceptsImages) throw new Error("This PDF has no text layer. Run it through OCR first, or enable image input for the LLM");
      const pages = await rasterizePdf(file, path.join(attachmentsDir(chatId), `${id}-pages`), 110);
      await Promise.all(pages.slice(MAX_SCANNED_PAGES).map((page) => fs.rm(page, { force: true })));
      return { pageImages: Math.min(pages.length, MAX_SCANNED_PAGES) };
    }
  } else {
    text = await fs.readFile(file, "utf8");
    await fs.writeFile(attachmentFile(chatId, id, ".txt"), text, "utf8");
  }
  return { textChars: text.length };
}

/** Reads the metadata the upload stored, so a message can only reference files of its own chat. */
export async function readChatAttachment(chatId: string, id: string): Promise<ChatAttachment> {
  const stored = JSON.parse(await fs.readFile(attachmentFile(chatId, id, ".json"), "utf8")) as ChatAttachment & { storedName?: string };
  const { storedName: _storedName, ...attachment } = stored;
  return attachment;
}

export async function chatAttachmentPath(chatId: string, id: string) {
  const stored = JSON.parse(await fs.readFile(attachmentFile(chatId, id, ".json"), "utf8")) as { storedName: string; mimeType: string; name: string };
  return { file: path.join(attachmentsDir(chatId), path.basename(stored.storedName)), mimeType: stored.mimeType, name: stored.name };
}

export type AttachmentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** The text each attached document contributes to its message, trimmed to fit the context. */
export async function documentText(chatId: string, attachment: ChatAttachment) {
  if (attachment.kind !== "document" || attachment.pageImages) return "";
  const text = await fs.readFile(attachmentFile(chatId, attachment.id, ".txt"), "utf8").catch(() => "");
  const trimmed = text.length > MAX_DOCUMENT_CHARS
    ? `${text.slice(0, MAX_DOCUMENT_CHARS)}\n\n[… ${text.length - MAX_DOCUMENT_CHARS} more characters not included]`
    : text;
  return `Attached file "${attachment.name}":\n\n${trimmed.trim()}`;
}

/** Image files for one attachment: the image itself, or the page images of a scanned PDF. */
export async function attachmentImages(chatId: string, attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    const { file, mimeType } = await chatAttachmentPath(chatId, attachment.id);
    return [{ file, mimeType }];
  }
  if (!attachment.pageImages) return [];
  const folder = path.join(attachmentsDir(chatId), `${attachment.id}-pages`);
  const pages = (await fs.readdir(folder).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return pages.map((name) => ({ file: path.join(folder, name), mimeType: "image/png" }));
}
