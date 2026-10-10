import { promises as fs } from "node:fs";
import path from "node:path";
import { chatCompletion, ocrPage, transcribeAudio, type OcrBlock, type TimedWord, type TranscriptSegment } from "./ai.js";
import { jobEvents, publishJob } from "./events.js";
import { extractAudio, normalizeAudio, rasterizePdf, splitAudio, srtTimestamp, vttTimestamp } from "./media.js";
import { executeWorkflow } from "./modules/executors.js";
import { joinChunkWords, toCues, toParagraphs, toSentences } from "./transcript-timing.js";
import {
  jobDir,
  readJob,
  readPrimaryOutput,
  readPrompt,
  readSettings,
  safeArtifactPath,
  safeOutputPath,
  updateJob,
} from "./store.js";
import type { JobManifest, PromptPreset, Settings, WorkflowRun } from "./models.js";

interface AudioChunk { file: string; start: number; end: number }
// `words` is set only by ASR models that report word times; checkpoints written before they did lack it.
interface TranscriptResult { text: string; segments: TranscriptSegment[]; words?: TimedWord[] }

// An endpoint that reports word times returns words wherever it heard speech. Text without any words means it
// ignored the request for them, and the sentence output would drop that text, so such a result does not count.
function hasWordTimes(result: TranscriptResult): result is TranscriptResult & { words: TimedWord[] } {
  return Array.isArray(result.words) && (result.words.length > 0 || !result.text.trim());
}

async function progress(id: string, patch: Partial<JobManifest>) {
  const next = await updateJob(id, patch);
  publishJob(id, next);
  return next;
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted || (error && typeof error === "object" && "name" in error && error.name === "AbortError"));
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledError();
}

async function assertNotCancelled(id: string, signal?: AbortSignal) {
  throwIfCancelled(signal);
  const current = await readJob(id);
  if (current.cancelRequested) {
    throw new CancelledError();
  }
}

class CancelledError extends Error {}

async function withRetries<T>(attempts: number, work: () => Promise<T>, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfCancelled(signal);
    try {
      return await work();
    } catch (error) {
      if (isAbort(error, signal)) throw new CancelledError();
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

class PathologicalTranscriptError extends Error {}

export function isPathologicalTranscript(text: string, durationSec: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (normalized.length > Math.max(1000, durationSec * 20)) return true;
  const blockSize = 16;
  const blocks: string[] = [];
  for (let index = 0; index + blockSize <= normalized.length; index += 4) {
    blocks.push(normalized.slice(index, index + blockSize).toLocaleLowerCase());
  }
  if (blocks.length < 20) return false;
  return new Set(blocks).size / blocks.length < 0.35;
}

async function transcribeChunk(
  settings: Settings,
  chunk: AudioChunk,
  adaptiveFolder: string,
  lineage: string,
  signal?: AbortSignal,
  onAdaptiveSplit?: () => Promise<unknown>,
): Promise<TranscriptResult> {
  const duration = Math.max(0.1, chunk.end - chunk.start);
  const request = async () => {
    const result = await transcribeAudio(settings.endpoints.stt, chunk.file, chunk.start, {
      maxCompletionTokens: settings.audio.maxCompletionTokens,
      timeoutMs: settings.audio.requestTimeoutSec * 1000,
    }, signal);
    if (isPathologicalTranscript(result.text, duration)) {
      throw new PathologicalTranscriptError("The ASR output became unusually long or repetitive");
    }
    if (!result.segments.length && result.text) result.segments.push({ start: chunk.start, end: chunk.end, text: result.text });
    return result;
  };

  try {
    if (!settings.audio.adaptiveSplit) return await withRetries(settings.queue.maxRetriesPerChunk + 1, request, signal);
    return await request();
  } catch (error) {
    if (isAbort(error, signal)) throw new CancelledError();
    const half = duration / 2;
    if (settings.audio.adaptiveSplit && half >= settings.audio.minAdaptiveChunkSec) {
      await onAdaptiveSplit?.();
      const overlap = Math.min(settings.audio.chunkOverlapSec, half / 4);
      const rightOffset = Math.max(0, half - overlap);
      const leftLength = Math.min(duration, half + overlap);
      const leftFile = path.join(adaptiveFolder, `${lineage}-left.wav`);
      const rightFile = path.join(adaptiveFolder, `${lineage}-right.wav`);
      await extractAudio(chunk.file, leftFile, 0, leftLength, signal);
      await extractAudio(chunk.file, rightFile, rightOffset, duration - rightOffset, signal);
      const midpoint = chunk.start + half;
      const leftChunk = { file: leftFile, start: chunk.start, end: chunk.start + leftLength };
      const rightChunk = { file: rightFile, start: chunk.start + rightOffset, end: chunk.end };
      const left = await transcribeChunk(settings, leftChunk, adaptiveFolder, `${lineage}-left`, signal, onAdaptiveSplit);
      const right = await transcribeChunk(settings, rightChunk, adaptiveFolder, `${lineage}-right`, signal, onAdaptiveSplit);
      return {
        text: mergeOverlappingText([left.text, right.text].filter(Boolean)),
        segments: [...left.segments, ...right.segments],
        // The halves overlap like any two chunks, so their words are joined the same way.
        words: hasWordTimes(left) && hasWordTimes(right)
          ? joinChunkWords([{ ...leftChunk, words: left.words }, { ...rightChunk, words: right.words }])
          : undefined,
      };
    }
    if (settings.audio.adaptiveSplit && settings.queue.maxRetriesPerChunk > 0) {
      return withRetries(settings.queue.maxRetriesPerChunk, request, signal);
    }
    throw error;
  }
}

function durationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export async function processAudio(job: JobManifest, signal?: AbortSignal, run?: WorkflowRun) {
  const settings = await readSettings();
  const root = jobDir(job.id);
  const derivedRun = run && job.runs.findIndex((candidate) => candidate.id === run.id) > 0;
  const runWork = derivedRun ? path.join(root, "work", "transcription", run.id) : path.join(root, "work");
  await fs.mkdir(runWork, { recursive: true });
  const planFile = path.join(runWork, "audio-plan.json");
  const configuredPlan = {
    version: 1,
    chunkTargetSec: settings.audio.chunkTargetSec,
    chunkOverlapSec: settings.audio.chunkOverlapSec,
    sampleRate: settings.audio.sampleRate,
  };
  let plan = configuredPlan;
  try {
    const saved = JSON.parse(await fs.readFile(planFile, "utf8")) as typeof configuredPlan;
    if (saved.version === 1) plan = saved;
  } catch {
    await fs.writeFile(planFile, `${JSON.stringify(configuredPlan, null, 2)}\n`);
  }
  const chunks: AudioChunk[] = [];
  let timelineOffset = 0;
  const selectedArtifacts = (run?.inputArtifactIds || [])
    .map((id) => job.artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact && ["source-audio", "source-video"].includes(artifact.kind)));
  const audioInputs = selectedArtifacts.length
    ? selectedArtifacts.map((artifact) => ({ name: artifact.name, file: safeArtifactPath(job.id, artifact.path) }))
    : job.inputs.map((input) => ({ name: input.name, file: path.join(root, "input", input.storedName) }));
  if (!audioInputs.length) throw new Error("Choose at least one recording to transcribe");
  await progress(job.id, { status: "preparing", progress: 4, stage: "Normalizing audio", startedAt: new Date().toISOString() });
  for (const [index, input] of audioInputs.entries()) {
    await assertNotCancelled(job.id, signal);
    const normalized = path.join(runWork, `normalized-${String(index + 1).padStart(3, "0")}.wav`);
    await normalizeAudio(input.file, normalized, plan.sampleRate, signal);
    const fileChunks = await splitAudio(normalized, path.join(runWork, `chunks-${index + 1}`), plan.chunkTargetSec, plan.chunkOverlapSec, signal);
    chunks.push(...fileChunks.map((chunk) => ({ ...chunk, start: chunk.start + timelineOffset, end: chunk.end + timelineOffset })));
    timelineOffset += (fileChunks.at(-1)?.end || 0) + 1;
  }
  // Each result keeps its chunk's time span, which joining word times across the overlaps needs.
  const transcripts: Array<{ start: number; end: number; result: TranscriptResult }> = [];
  const warnings: string[] = [];
  const totalDuration = chunks.at(-1)?.end || 0;
  for (const [index, chunk] of chunks.entries()) {
    await assertNotCancelled(job.id, signal);
    const detail = `${durationLabel(chunk.start)} of ${durationLabel(totalDuration)} processed`;
    await progress(job.id, {
      status: "processing",
      progress: 10 + Math.round((index / chunks.length) * 78),
      stage: "Transcribing audio",
      detail,
    });
    try {
      const checkpoint = path.join(runWork, `transcript-${String(index + 1).padStart(4, "0")}.json`);
      let result: TranscriptResult;
      try {
        result = JSON.parse(await fs.readFile(checkpoint, "utf8")) as TranscriptResult;
      } catch {
        result = await transcribeChunk(
          settings,
          chunk,
          path.join(runWork, `adaptive-${String(index + 1).padStart(4, "0")}`),
          "root",
          signal,
          () => progress(job.id, { stage: "Retrying a difficult section", detail }),
        );
        await fs.writeFile(checkpoint, JSON.stringify(result, null, 2));
      }
      if (!result.segments.length && result.text) result.segments.push({ start: chunk.start, end: chunk.end, text: result.text });
      transcripts.push({ start: chunk.start, end: chunk.end, result });
    } catch (error) {
      if (isAbort(error, signal)) throw new CancelledError();
      warnings.push(`Some audio could not be transcribed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await assertNotCancelled(job.id, signal);
  await progress(job.id, { status: "merging", progress: 92, stage: "Building transcript and subtitles", warnings });
  // Word times let the transcript follow the speech: sentences for the lines, short cues for the subtitles. One
  // transcribed chunk without them (an older checkpoint, a model that does not report them, text that came back
  // with no words) keeps the output of one segment per chunk, since mixing the two would put chunk-wide and
  // word-level lines in one file.
  const timedChunks = transcripts.flatMap(({ start, end, result }) => (hasWordTimes(result) ? [{ start, end, words: result.words }] : []));
  let words: TimedWord[] | undefined;
  let segments: TranscriptSegment[];
  let cues: TranscriptSegment[];
  let text: string;
  if (transcripts.length > 0 && timedChunks.length === transcripts.length) {
    words = joinChunkWords(timedChunks);
    segments = toSentences(words);
    cues = toCues(words);
    text = toParagraphs(segments);
  } else {
    segments = transcripts.flatMap(({ result }) => result.segments);
    cues = segments;
    text = mergeOverlappingText(transcripts.map(({ result }) => result.text.trim()).filter(Boolean));
  }
  if (!text && warnings.length) throw new Error(warnings.join("; "));
  const md = `# ${job.title}\n\n${text || "_No speech detected._"}\n`;
  const srt = cues.map((segment, index) => `${index + 1}\n${srtTimestamp(segment.start)} --> ${srtTimestamp(segment.end)}\n${segment.text}\n`).join("\n");
  const vtt = `WEBVTT\n\n${cues.map((segment) => `${vttTimestamp(segment.start)} --> ${vttTimestamp(segment.end)}\n${segment.text}\n`).join("\n")}`;
  const suffix = (run?.id || "derived").replace(/^run-/, "").slice(0, 8);
  const stem = job.outputFiles.includes("transcript.md") ? `transcript-${suffix}` : "transcript";
  const names = [`${stem}.md`, `${stem}.json`, `${stem}.srt`, `${stem}.vtt`];
  await Promise.all([
    fs.writeFile(safeOutputPath(job.id, names[0]), md),
    fs.writeFile(safeOutputPath(job.id, names[1]), `${JSON.stringify({ text, segments, words }, null, 2)}\n`),
    fs.writeFile(safeOutputPath(job.id, names[2]), srt),
    fs.writeFile(safeOutputPath(job.id, names[3]), vtt),
  ]);
  return { outputFiles: [...new Set([...job.outputFiles, ...names])], warnings };
}

function mergeOverlappingText(parts: string[]) {
  if (!parts.length) return "";
  let merged = parts[0];
  for (const part of parts.slice(1)) {
    const previousWords = merged.split(/\s+/);
    const nextWords = part.split(/\s+/);
    let overlap = 0;
    const max = Math.min(40, previousWords.length, nextWords.length);
    for (let size = max; size >= 3; size -= 1) {
      const left = previousWords.slice(-size).join(" ").toLocaleLowerCase();
      const right = nextWords.slice(0, size).join(" ").toLocaleLowerCase();
      if (left === right) { overlap = size; break; }
    }
    merged += `\n\n${nextWords.slice(overlap).join(" ")}`;
  }
  return merged.trim();
}

interface PageLayout { page: number; source: string; width?: number; height?: number; blocks: OcrBlock[] }

/**
 * OCRs one page image behind a Markdown checkpoint. Layout blocks, when the model returns them, are
 * checkpointed beside it first, so an existing Markdown checkpoint always has its layout available.
 */
async function ocrWithCheckpoint(settings: Settings, file: string, checkpoint: string, label: string, signal?: AbortSignal) {
  const layoutCheckpoint = checkpoint.replace(/\.md$/, ".layout.json");
  const saved = await fs.readFile(checkpoint, "utf8").catch(() => undefined);
  if (saved !== undefined) {
    const layout = await fs.readFile(layoutCheckpoint, "utf8").then((value) => JSON.parse(value) as Omit<PageLayout, "page" | "source">).catch(() => undefined);
    return { markdown: saved.trim(), layout };
  }
  const page = await withRetries(settings.queue.maxRetriesPerChunk + 1, () => ocrPage(settings.endpoints.ocr, file, label, signal), signal);
  const layout = page.blocks.length ? { width: page.width, height: page.height, blocks: page.blocks } : undefined;
  if (layout) await fs.writeFile(layoutCheckpoint, JSON.stringify(layout));
  await fs.writeFile(checkpoint, `${page.markdown}\n`);
  return { markdown: page.markdown, layout };
}

/** Writes <document>.layout.json next to the Markdown when any page carried layout blocks. */
async function writeLayout(jobId: string, documentName: string, layouts: PageLayout[]) {
  if (!layouts.length) return [];
  const name = documentName.replace(/\.md$/, ".layout.json");
  await fs.writeFile(safeOutputPath(jobId, name), `${JSON.stringify({ version: 1, pages: layouts }, null, 2)}\n`);
  return [name];
}

export async function processImages(job: JobManifest, signal?: AbortSignal, run?: WorkflowRun) {
  const settings = await readSettings();
  const root = jobDir(job.id);
  const selectedArtifacts = (run?.inputArtifactIds || [])
    .map((id) => job.artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact && ["source-image", "generated-image", "grounded-image"].includes(artifact.kind)));
  const images = selectedArtifacts.length
    ? selectedArtifacts.map((artifact) => ({ name: artifact.name, file: safeArtifactPath(job.id, artifact.path) }))
    : job.inputs.map((input) => ({ name: input.name, file: path.join(root, "input", input.storedName) }));
  if (!images.length) throw new Error("Choose at least one image to read");
  const checkpointsDir = path.join(root, "work", "ocr-images", run?.id || "initial");
  await fs.mkdir(checkpointsDir, { recursive: true });
  await progress(job.id, { status: "processing", progress: 5, stage: "Preparing images", startedAt: new Date().toISOString() });
  const pages: string[] = [];
  const layouts: PageLayout[] = [];
  const warnings: string[] = [];
  for (const [index, input] of images.entries()) {
    await assertNotCancelled(job.id, signal);
    await progress(job.id, {
      status: "processing",
      progress: 8 + Math.round((index / images.length) * 82),
      stage: `Reading image ${index + 1} of ${images.length}`,
      detail: input.name,
    });
    try {
      const checkpoint = path.join(checkpointsDir, `${String(index + 1).padStart(4, "0")}.md`);
      const { markdown, layout } = await ocrWithCheckpoint(settings, input.file, checkpoint, `image ${index + 1}`, signal);
      if (layout) layouts.push({ page: index + 1, source: input.name, ...layout });
      pages.push(markdown);
    } catch (error) {
      if (isAbort(error, signal)) throw new CancelledError();
      const message = `Image ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(message);
      pages.push(`> ${message}`);
    }
  }
  await assertNotCancelled(job.id, signal);
  if (!pages.some((page) => !page.startsWith("> Image"))) throw new Error(warnings.join("; "));
  await progress(job.id, { status: "merging", progress: 94, stage: "Assembling document", warnings });
  const document = pages.join("\n\n---\n\n");
  const baseName = "document.md";
  const outputName = job.outputFiles.includes(baseName) ? `document.ocr-${(run?.id || "derived").replace(/^run-/, "").slice(0, 8)}.md` : baseName;
  await fs.writeFile(safeOutputPath(job.id, outputName), `# ${job.title}\n\n${document}\n`);
  const layoutFiles = await writeLayout(job.id, outputName, layouts);
  return { outputFiles: [...new Set([...job.outputFiles, outputName, ...layoutFiles])], warnings };
}

export async function processPdfs(job: JobManifest, signal?: AbortSignal, run?: WorkflowRun) {
  const settings = await readSettings();
  const root = jobDir(job.id);
  const allPages: string[] = [];
  const layouts: PageLayout[] = [];
  let globalPage = 0;
  const warnings: string[] = [];
  const derivedRun = run && job.runs.findIndex((candidate) => candidate.id === run.id) > 0;
  const checkpointsDir = derivedRun ? path.join(root, "work", "ocr-pages", run.id) : path.join(root, "work", "ocr-pages");
  await fs.mkdir(checkpointsDir, { recursive: true });
  const selectedArtifacts = (run?.inputArtifactIds || [])
    .map((id) => job.artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact && artifact.kind === "source-pdf"));
  const pdfInputs = selectedArtifacts.length
    ? selectedArtifacts.map((artifact) => ({ name: artifact.name, file: safeArtifactPath(job.id, artifact.path) }))
    : job.inputs.filter((input) => input.mimeType === "application/pdf" || input.name.toLowerCase().endsWith(".pdf")).map((input) => ({ name: input.name, file: path.join(root, "input", input.storedName) }));
  if (!pdfInputs.length) throw new Error("Choose at least one PDF to read");
  await progress(job.id, { status: "preparing", progress: 3, stage: "Preparing PDFs for OCR", startedAt: new Date().toISOString() });
  for (const [fileIndex, input] of pdfInputs.entries()) {
    await assertNotCancelled(job.id, signal);
    const inputFile = input.file;
    await progress(job.id, { status: "preparing", progress: 8, stage: "Preparing documents", detail: input.name });
    const pageFiles = await rasterizePdf(inputFile, path.join(root, "work", `pdf-${fileIndex + 1}`), settings.pdf.dpi, signal);
    for (const [pageIndex, pageFile] of pageFiles.entries()) {
      await assertNotCancelled(job.id, signal);
      const overall = (fileIndex + pageIndex / Math.max(pageFiles.length, 1)) / pdfInputs.length;
      await progress(job.id, {
        status: "processing",
        progress: 12 + Math.round(overall * 76),
        stage: "Reading documents",
        detail: input.name,
      });
      globalPage += 1;
      const checkpoint = path.join(checkpointsDir, `${String(globalPage).padStart(4, "0")}.md`);
      try {
        const { markdown, layout } = await ocrWithCheckpoint(settings, pageFile, checkpoint, `page ${pageIndex + 1} of ${input.name}`, signal);
        if (layout) layouts.push({ page: globalPage, source: input.name, ...layout });
        allPages.push(markdown);
      } catch (error) {
        if (isAbort(error, signal)) throw new CancelledError();
        const message = `Page ${pageIndex + 1} of ${input.name} failed: ${error instanceof Error ? error.message : String(error)}`;
        warnings.push(message);
        allPages.push(`> ${message}`);
      }
    }
  }
  await assertNotCancelled(job.id, signal);
  if (!allPages.length) throw new Error("No text or pages could be extracted");
  await progress(job.id, { status: "merging", progress: 94, stage: "Assembling document", warnings });
  const baseName = "document.md";
  const outputName = job.outputFiles.includes(baseName) ? `document.ocr-${(run?.id || "derived").replace(/^run-/, "").slice(0, 8)}.md` : baseName;
  await fs.writeFile(safeOutputPath(job.id, outputName), `# ${job.title}\n\n${allPages.join("\n\n---\n\n")}\n`);
  const layoutFiles = await writeLayout(job.id, outputName, layouts);
  return { outputFiles: [...new Set([...job.outputFiles, outputName, ...layoutFiles])], warnings };
}

export async function processJob(id: string, signal?: AbortSignal) {
  const job = await readJob(id);
  const run = job.runs.find((candidate) => candidate.workflowId === job.workflowId) || job.runs[0];
  return processRun(id, run?.id, signal);
}

function splitText(text: string, maxTokens: number) {
  const maxChars = Math.max(4000, maxTokens * 3);
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length) {
    let end = Math.min(maxChars, rest.length);
    if (end < rest.length) {
      const paragraph = rest.lastIndexOf("\n\n", end);
      if (paragraph > maxChars * 0.6) end = paragraph;
    }
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  return chunks;
}

async function applyPreset(preset: PromptPreset, source: string, signal?: AbortSignal) {
  const settings = await readSettings();
  const chunks = splitText(source, preset.chunking.maxInputTokens);
  const results: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    throwIfCancelled(signal);
    const prompt = preset.userTemplate.replace("{{text}}", chunk);
    results.push(
      await chatCompletion(
        settings.endpoints.llm,
        [
          { role: "system", content: preset.system },
          { role: "user", content: chunks.length > 1 ? `Part ${index + 1} of ${chunks.length}.\n\n${prompt}` : prompt },
        ],
        preset.params,
        signal,
      ),
    );
  }
  if (results.length === 1 || preset.chunking.strategy === "single") return results.join("\n\n");
  return chatCompletion(
    settings.endpoints.llm,
    [
      { role: "system", content: preset.system },
      {
        role: "user",
        content: `Combine the following partial results into one coherent final result. Remove duplication and return only the final Markdown.\n\n${results.map((result, i) => `## Part ${i + 1}\n${result}`).join("\n\n")}`,
      },
    ],
    preset.params,
    signal,
  );
}

export async function processPreset(jobId: string, slug: string, signal?: AbortSignal) {
  const job = await readJob(jobId);
  if (job.cancelRequested || job.status === "cancelled") {
    if (job.status !== "cancelled") await progress(jobId, { status: "cancelled", stage: "Stopped", completedAt: new Date().toISOString() });
    return;
  }
  const preset = await readPrompt(slug);
  try {
    await progress(jobId, { status: "processing", progress: 15, stage: `Running ${preset.name}` });
    const source = await readPrimaryOutput(job);
    const result = await applyPreset(preset, source, signal);
    await assertNotCancelled(jobId, signal);
    const outputName = `summary.${preset.slug}.md`;
    await fs.writeFile(safeOutputPath(jobId, outputName), `${result}\n`);
    const current = await readJob(jobId);
    await progress(jobId, {
      status: "done",
      progress: 100,
      stage: `${preset.name} complete`,
      outputFiles: [...new Set([...current.outputFiles, outputName])],
      completedAt: new Date().toISOString(),
      error: undefined,
      cancelRequested: false,
    });
  } catch (error) {
    if (error instanceof CancelledError || isAbort(error, signal)) {
      await progress(jobId, {
        status: "cancelled",
        stage: "Stopped",
        detail: undefined,
        error: undefined,
        completedAt: new Date().toISOString(),
      });
      return;
    }
    await progress(jobId, {
      status: "done_with_warnings",
      stage: `${preset.name} failed`,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function processRun(jobId: string, runId: string | undefined, signal?: AbortSignal) {
  const job = await readJob(jobId);
  const run = runId ? job.runs.find((candidate) => candidate.id === runId) : job.runs.at(-1);
  if (!run) throw new Error(`Workflow run ${runId || "current"} was not found`);
  if (job.cancelRequested || run.cancelRequested || job.status === "cancelled") {
    if (job.status !== "cancelled") await progress(jobId, { status: "cancelled", stage: "Stopped", completedAt: new Date().toISOString() });
    return;
  }
  try {
    const result = await executeWorkflow(run.workflowId, job, run, signal);
    if (!result) return;
    await assertNotCancelled(jobId, signal);
    await progress(jobId, {
      status: result.warnings.length ? "done_with_warnings" : "done",
      progress: 100,
      stage: result.warnings.length ? "Complete with warnings" : "Complete",
      detail: undefined,
      outputFiles: result.outputFiles,
      warnings: result.warnings,
      error: undefined,
      cancelRequested: false,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    // The preset adapter still owns its warning state until its historical
    // output behavior is fully migrated to WorkflowExecutionResult.
    if (run.workflowId === "text-transform.preset") throw error;
    if (error instanceof CancelledError || isAbort(error, signal)) {
      await progress(jobId, { status: "cancelled", stage: "Stopped", detail: undefined, error: undefined, completedAt: new Date().toISOString() });
      return;
    }
    await progress(jobId, { status: "failed", stage: "Failed", error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
    throw error;
  }
}

void jobEvents;
