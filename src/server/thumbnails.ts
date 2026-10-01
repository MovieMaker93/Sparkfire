import { promises as fs } from "node:fs";
import path from "node:path";
import { runCommand } from "./media.js";
import type { Artifact, JobManifest } from "./models.js";
import { jobDir, safeArtifactPath } from "./store.js";

export const THUMBNAIL_WIDTHS = [160, 320, 640] as const;

const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif"]);
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

export type ThumbnailSource = "image" | "video" | "pdf";

/** Snaps a requested width to the few cached sizes so the cache stays small. */
export function thumbnailWidth(requested: unknown) {
  const value = Number(requested);
  if (!Number.isFinite(value) || value <= 0) return 320;
  return THUMBNAIL_WIDTHS.find((width) => width >= value) ?? THUMBNAIL_WIDTHS.at(-1)!;
}

export function thumbnailSource(artifact: Pick<Artifact, "name" | "path" | "mimeType" | "kind">): ThumbnailSource | undefined {
  const extension = path.extname(artifact.path || artifact.name).toLowerCase();
  const mime = artifact.mimeType.toLowerCase();
  if (mime === "image/svg+xml" || extension === ".svg") return undefined;
  if (artifact.kind === "source-pdf" || mime === "application/pdf" || extension === ".pdf") return "pdf";
  if (artifact.kind === "source-video" || mime.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (mime.startsWith("image/") || rasterExtensions.has(extension)) return "image";
  return undefined;
}

export class UnsupportedThumbnailError extends Error {
  status = 415;
}

const pending = new Map<string, Promise<string>>();

/**
 * Returns a cached WebP preview of an artifact, generating it on first use. Previews live in the job's
 * disposable work/ folder, so the retention purge may remove them; they are rebuilt on demand.
 */
export async function ensureThumbnail(job: JobManifest, artifact: Artifact, width: number) {
  const kind = thumbnailSource(artifact);
  if (!kind) throw new UnsupportedThumbnailError(`No preview is available for ${artifact.name}`);
  const source = safeArtifactPath(job.id, artifact.path);
  const target = path.join(jobDir(job.id), "work", "thumbs", `${artifact.id}-${width}.webp`);
  const [sourceStat, targetStat] = await Promise.all([fs.stat(source), fs.stat(target).catch(() => undefined)]);
  if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs) return target;
  const key = `${job.id}:${target}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = renderThumbnail(kind, source, target, width).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

async function renderThumbnail(kind: ThumbnailSource, source: string, target: string, width: number) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp.webp`;
  const scale = ["-vf", `scale='min(${width},iw)':-2`, "-frames:v", "1", "-c:v", "libwebp", "-quality", "80"];
  try {
    if (kind === "pdf") {
      const prefix = `${temp}-page`;
      await runCommand("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-png", "-scale-to", String(width * 2), source, prefix], 60_000);
      await runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", `${prefix}.png`, ...scale, temp], 60_000).finally(() => fs.unlink(`${prefix}.png`).catch(() => undefined));
    } else if (kind === "video") {
      // A frame one second in avoids black intros; very short clips fall back to the first frame.
      await runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", source, ...scale, temp], 60_000)
        .then(() => fs.stat(temp))
        .catch(() => runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...scale, temp], 60_000));
    } else {
      await runCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...scale, temp], 60_000);
    }
    await fs.rename(temp, target);
    return target;
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    // A missing ffmpeg/pdftoppm surfaces as ENOENT, which the API would otherwise report as a missing file.
    if (error && typeof error === "object" && "syscall" in error && String(error.syscall).startsWith("spawn")) {
      throw Object.assign(new Error(`Previews need ${kind === "pdf" ? "pdftoppm (poppler-utils)" : "ffmpeg"} on the server`), { status: 503 });
    }
    throw error;
  }
}

export interface GalleryItem {
  jobId: string;
  jobTitle: string;
  jobType: JobManifest["type"];
  moduleId: JobManifest["moduleId"];
  workflowId: string;
  artifactId: string;
  name: string;
  /** Job-relative path, e.g. output/generated-image.png or input/001-scan.jpg. */
  path: string;
  kind: Artifact["kind"];
  role: Artifact["role"];
  createdAt: string;
  prompt?: string;
  model?: string;
  size?: string;
  seed?: number;
  steps?: number;
}

const galleryKinds = new Set<Artifact["kind"]>(["generated-image", "grounded-image", "source-image"]);

/** Image artifacts across all jobs, newest first. Generation details come from artifact metadata, then run parameters. */
export function galleryItems(jobs: JobManifest[], options: { source?: "all" | "generated" | "uploaded"; model?: string } = {}): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const job of jobs) {
    for (const artifact of job.artifacts) {
      if (!galleryKinds.has(artifact.kind) || thumbnailSource(artifact) !== "image") continue;
      const uploaded = artifact.role === "source";
      if (options.source === "generated" && uploaded) continue;
      if (options.source === "uploaded" && !uploaded) continue;
      const run = job.runs.find((candidate) => candidate.id === artifact.createdByRunId) || job.runs.find((candidate) => candidate.moduleId === job.moduleId);
      const meta = artifact.metadata as Record<string, unknown>;
      const params = { ...job.params, ...run?.params } as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
      const item: GalleryItem = {
        jobId: job.id,
        jobTitle: job.title,
        jobType: job.type,
        moduleId: job.moduleId,
        workflowId: job.workflowId,
        artifactId: artifact.id,
        name: artifact.name,
        path: artifact.path,
        kind: artifact.kind,
        role: artifact.role,
        createdAt: artifact.createdAt || job.createdAt,
        prompt: uploaded ? undefined : text(meta.prompt) ?? text(params.prompt),
        model: text(meta.model) ?? (uploaded ? undefined : text(params.model)),
        size: text(meta.size) ?? (uploaded ? undefined : text(params.size)),
        seed: number(meta.seed) ?? (uploaded ? undefined : number(params.seed)),
        steps: number(meta.steps) ?? (uploaded ? undefined : number(params.steps)),
      };
      if (options.model && item.model !== options.model) continue;
      items.push(item);
    }
  }
  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
