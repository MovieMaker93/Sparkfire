import { promises as fs } from "node:fs";
import { generateVideo } from "../../ai.js";
import { publishJob } from "../../events.js";
import type { Artifact, JobManifest, WorkflowRun } from "../../models.js";
import { readSettings, safeArtifactPath, safeOutputPath, updateJob, updateWorkflowRun } from "../../store.js";
import type { WorkflowExecutionResult } from "../executors.js";

const TEXT_KINDS = ["document", "transcript", "translation", "redacted-document", "text"];
const IMAGE_KINDS = ["source-image", "generated-image", "grounded-image"];
const FIRST_FRAME_TYPES = ["image/png", "image/jpeg", "image/webp"];

async function report(jobId: string, patch: Parameters<typeof updateJob>[1]) {
  const job = await updateJob(jobId, patch);
  publishJob(jobId, job);
}

function elapsed(startedAt: number) {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The prompt for a run: its own, else the text it was handed, else the prompt of the run that made its
 * image (an image handed over with "Continue with" usually came from text-to-image).
 */
async function resolvePrompt(job: JobManifest, run: WorkflowRun, inputs: Artifact[]) {
  const own = typeof run.params.prompt === "string" ? run.params.prompt.trim() : "";
  if (own) return own;
  const text = inputs.find((artifact) => TEXT_KINDS.includes(artifact.kind));
  if (text) return (await fs.readFile(safeArtifactPath(job.id, text.path), "utf8")).trim().slice(0, 12_000);
  const image = inputs.find((artifact) => IMAGE_KINDS.includes(artifact.kind));
  const origin = image?.createdByRunId ? job.runs.find((candidate) => candidate.id === image.createdByRunId) : undefined;
  return typeof origin?.params.prompt === "string" ? origin.params.prompt.trim() : "";
}

export async function processTextToVideo(job: JobManifest, run: WorkflowRun, signal?: AbortSignal): Promise<WorkflowExecutionResult> {
  const settings = await readSettings();
  const endpoint = settings.endpoints["video-generation"];
  if (!endpoint.enabled || !endpoint.baseUrl || !endpoint.model) throw new Error("Configure and enable the Video generation service in Settings first");
  const inputs = run.inputArtifactIds.map((id) => job.artifacts.find((artifact) => artifact.id === id)).filter((artifact): artifact is Artifact => Boolean(artifact));
  const prompt = await resolvePrompt(job, run, inputs);
  if (!prompt) throw new Error("This video run has no prompt");
  const image = inputs.find((artifact) => IMAGE_KINDS.includes(artifact.kind));
  if (image && !FIRST_FRAME_TYPES.includes(image.mimeType)) throw new Error("The first frame must be a PNG, JPEG or WebP image");
  const firstFrame = image ? { bytes: await fs.readFile(safeArtifactPath(job.id, image.path)), mimeType: image.mimeType } : undefined;

  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const integer = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : undefined);
  const size = text(run.params.size) || "864x480";
  const duration = integer(run.params.duration) || 5;
  const variant = text(run.params.variant);
  const summary = [size.replace("x", " × "), `${duration} s`, ...(variant ? [variant] : []), ...(firstFrame ? ["from an image"] : [])].join(" · ");

  await report(job.id, { status: "preparing", progress: 8, stage: "Preparing video request", startedAt: run.startedAt || new Date().toISOString() });
  const startedAt = Date.now();
  await report(job.id, { status: "processing", progress: 18, stage: "Generating video", detail: summary });
  // The service answers only when the video is done, which takes minutes; the elapsed time shows it is alive.
  let heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(() => report(job.id, { detail: `${summary} · ${elapsed(startedAt)}` })).catch(() => undefined);
  }, 5000);

  const baseName = "generated-video.mp4";
  const outputName = job.outputFiles.includes(baseName) ? `generated-video-${run.id.replace(/^run-/, "").slice(0, 8)}.mp4` : baseName;
  let generated;
  try {
    generated = await generateVideo(endpoint, {
      prompt,
      size,
      duration,
      variant,
      sound: text(run.params.sound),
      music: text(run.params.music),
      seed: integer(run.params.seed),
      firstFrame,
    }, safeOutputPath(job.id, outputName), signal);
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
  if (signal?.aborted) throw new DOMException("Video generation cancelled", "AbortError");
  await report(job.id, { status: "merging", progress: 94, stage: "Saving generated video", detail: undefined });
  // Record what produced the video so the gallery can show and compare it.
  await updateWorkflowRun(job.id, run.id, {
    params: {
      ...run.params,
      prompt,
      size,
      duration,
      model: generated.model || endpoint.model,
      ...(generated.variant || variant ? { variant: generated.variant || variant } : {}),
      ...(generated.seed !== undefined ? { seed: generated.seed } : {}),
      ...(generated.frames !== undefined ? { frames: generated.frames } : {}),
      ...(generated.elapsedSeconds !== undefined ? { elapsedSeconds: generated.elapsedSeconds } : {}),
      ...(generated.disclosure ? { disclosure: generated.disclosure } : {}),
      ...(image ? { firstFrameArtifactId: image.id } : {}),
    },
  });
  return { outputFiles: [...new Set([...job.outputFiles, outputName])], warnings: [] };
}
