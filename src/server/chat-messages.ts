import { promises as fs } from "node:fs";
import path from "node:path";
import { attachmentImages, documentText, MAX_MODEL_IMAGES } from "./chat-attachments.js";
import type { Artifact, ChatRecord, Settings } from "./models.js";
import { readJob, safeArtifactPath } from "./store.js";

export type ModelChatMessage = {
  role: string;
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
};

type ContentPart = Exclude<ModelChatMessage["content"], string>[number];

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024;
const rasterMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const imageArtifactKinds = new Set(["source-image", "generated-image", "grounded-image"]);

function rasterMimeType(artifact: Artifact) {
  const declared = artifact.mimeType.toLowerCase().split(";")[0];
  if (rasterMimeTypes.has(declared)) return declared;
  const extension = path.extname(artifact.name).toLowerCase();
  return extension === ".png" ? "image/png"
    : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp"
        : extension === ".gif" ? "image/gif"
          : undefined;
}

function orderedImageArtifacts(artifacts: Artifact[], linkedArtifactIds?: string[]) {
  const candidates = artifacts.filter((artifact) => imageArtifactKinds.has(artifact.kind) && rasterMimeType(artifact));
  if (linkedArtifactIds?.length) {
    const linkedOrder = new Map(linkedArtifactIds.map((id, index) => [id, index]));
    return candidates
      .filter((artifact) => linkedOrder.has(artifact.id))
      .sort((left, right) => linkedOrder.get(left.id)! - linkedOrder.get(right.id)!);
  }
  return candidates.sort((left, right) => {
    const roleRank = (artifact: Artifact) => artifact.role === "primary" ? 0 : artifact.role === "supplementary" ? 1 : 2;
    return roleRank(left) - roleRank(right) || right.createdAt.localeCompare(left.createdAt);
  });
}

/**
 * Converts persisted text-only chat history into a provider request. Image data
 * exists only for the duration of this request and is never duplicated into the
 * chat JSON on disk.
 */
export async function modelMessagesForChat(chat: ChatRecord, settings: Settings): Promise<ModelChatMessage[]> {
  const acceptsImages = Boolean(settings.endpoints.llm.capabilities?.includes("image"));
  const messages = await withAttachments(chat, acceptsImages);
  if (!acceptsImages || !chat.linkedJobId) return messages;

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return messages;

  const job = await readJob(chat.linkedJobId);
  const imageParts: Array<{ type: "image_url"; image_url: { url: string } }> = [];
  let totalBytes = 0;
  for (const artifact of orderedImageArtifacts(job.artifacts, chat.linkedArtifactIds)) {
    if (imageParts.length >= MAX_IMAGES) break;
    const mimeType = rasterMimeType(artifact);
    if (!mimeType) continue;
    const file = safeArtifactPath(job.id, artifact.path);
    const stat = await fs.stat(file).catch(() => undefined);
    if (!stat?.isFile() || stat.size > MAX_IMAGE_BYTES || totalBytes + stat.size > MAX_TOTAL_IMAGE_BYTES) continue;
    const bytes = await fs.readFile(file);
    totalBytes += bytes.length;
    imageParts.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}` } });
  }
  if (!imageParts.length) return messages;

  const current = messages[lastUserIndex].content;
  const parts = typeof current === "string" ? [{ type: "text" as const, text: current }] : current;
  messages[lastUserIndex] = { role: messages[lastUserIndex].role, content: [...parts, ...imageParts] };
  return messages;
}

/**
 * Turns attached files into model input: each document's text joins its own message on every turn, and images
 * go to the newest messages first, up to MAX_MODEL_IMAGES per request; older ones are named in text instead.
 */
async function withAttachments(chat: ChatRecord, acceptsImages: boolean): Promise<ModelChatMessage[]> {
  const imagesFor = new Map<string, Array<{ file: string; mimeType: string }>>();
  let budget = acceptsImages ? MAX_MODEL_IMAGES : 0;
  for (const message of [...chat.messages].reverse()) {
    for (const attachment of [...(message.attachments || [])].reverse()) {
      const images = budget > 0 ? await attachmentImages(chat.id, attachment).catch(() => []) : [];
      const kept = images.slice(0, budget);
      budget -= kept.length;
      imagesFor.set(attachment.id, kept);
    }
  }

  const messages: ModelChatMessage[] = [];
  for (const { role, content, attachments } of chat.messages) {
    if (!attachments?.length) {
      messages.push({ role, content });
      continue;
    }
    const parts: ContentPart[] = [{ type: "text", text: content }];
    for (const attachment of attachments) {
      const text = await documentText(chat.id, attachment);
      if (text) parts.push({ type: "text", text });
      const images = imagesFor.get(attachment.id) || [];
      for (const image of images) {
        const bytes = await fs.readFile(image.file).catch(() => undefined);
        if (bytes) parts.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${bytes.toString("base64")}` } });
      }
      if (!text && !images.length) parts.push({ type: "text", text: `[The file "${attachment.name}" was shared earlier in this conversation.]` });
    }
    messages.push({ role, content: parts });
  }
  return messages;
}
