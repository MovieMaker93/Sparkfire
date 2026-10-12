import { promises as fs } from "node:fs";
import { generateMusic } from "../../ai.js";
import { publishJob } from "../../events.js";
import type { Artifact, JobManifest, WorkflowRun } from "../../models.js";
import { readSettings, safeArtifactPath, safeOutputPath, updateJob, updateWorkflowRun } from "../../store.js";
import type { WorkflowExecutionResult } from "../executors.js";

const TEXT_KINDS = ["document", "transcript", "translation", "redacted-document", "text"];
// What a song holds at most; the service enforces its own limits as well.
const MAX_LYRICS_CHARS = 20_000;

async function report(jobId: string, patch: Parameters<typeof updateJob>[1]) {
  const job = await updateJob(jobId, patch);
  publishJob(jobId, job);
}

function elapsed(startedAt: number) {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The run that made an artifact, whose style a new song reuses when it was given none. */
function originRun(job: JobManifest, artifact?: Artifact) {
  return artifact?.createdByRunId ? job.runs.find((candidate) => candidate.id === artifact.createdByRunId) : undefined;
}

/**
 * What a run sings: its own lyrics, else the text it was handed; a score it was handed is sung as written,
 * with the lyrics and style of the song that wrote it unless the run gives others.
 */
async function resolveSong(job: JobManifest, run: WorkflowRun, inputs: Artifact[]) {
  const scoreArtifact = inputs.find((artifact) => artifact.kind === "score");
  const textArtifact = inputs.find((artifact) => TEXT_KINDS.includes(artifact.kind));
  const origin = originRun(job, scoreArtifact || textArtifact);
  const read = async (artifact: Artifact) => (await fs.readFile(safeArtifactPath(job.id, artifact.path), "utf8")).trim();
  const lyrics = text(run.params.lyrics)
    || (textArtifact ? (await read(textArtifact)).slice(0, MAX_LYRICS_CHARS) : undefined)
    || (scoreArtifact ? text(origin?.params.lyrics) : undefined);
  const style = text(run.params.style) || text(origin?.params.style);
  const score = scoreArtifact ? await read(scoreArtifact) : undefined;
  return { lyrics, style, score, scoreArtifact };
}

export async function processTextToMusic(job: JobManifest, run: WorkflowRun, signal?: AbortSignal): Promise<WorkflowExecutionResult> {
  const settings = await readSettings();
  const endpoint = settings.endpoints["music-generation"];
  if (!endpoint.enabled || !endpoint.baseUrl || !endpoint.model) throw new Error("Configure and enable the Music generation service in Settings first");
  const inputs = run.inputArtifactIds.map((id) => job.artifacts.find((artifact) => artifact.id === id)).filter((artifact): artifact is Artifact => Boolean(artifact));
  const { lyrics, style, score, scoreArtifact } = await resolveSong(job, run, inputs);
  if (!lyrics) throw new Error("This song has no lyrics");
  if (!style) throw new Error("This song has no style; describe the genre, the voice and the instruments");
  const seed = typeof run.params.seed === "number" && Number.isInteger(run.params.seed) ? run.params.seed : undefined;
  const summary = score ? "Singing the score as written" : "Writing the score, then singing it";

  await report(job.id, { status: "preparing", progress: 8, stage: "Preparing song", startedAt: run.startedAt || new Date().toISOString() });
  const startedAt = Date.now();
  await report(job.id, { status: "processing", progress: 18, stage: "Generating song", detail: summary });
  // The service answers only when the song is done, which takes about as long as the song; the elapsed time
  // shows it is alive.
  let heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(() => report(job.id, { detail: `${summary} · ${elapsed(startedAt)}` })).catch(() => undefined);
  }, 5000);

  const suffix = run.id.replace(/^run-/, "").slice(0, 8);
  const audioName = job.outputFiles.includes("song.flac") ? `song-${suffix}.flac` : "song.flac";
  const scoreName = job.outputFiles.includes("score.abc") ? `score-${suffix}.abc` : "score.abc";
  let generated;
  try {
    generated = await generateMusic(endpoint, { style, lyrics, score, seed }, safeOutputPath(job.id, audioName), signal);
  } finally {
    clearInterval(timer);
    await heartbeat;
  }
  if (signal?.aborted) throw new DOMException("Music generation cancelled", "AbortError");
  await report(job.id, { status: "merging", progress: 94, stage: "Saving song", detail: undefined });
  const outputFiles = [audioName];
  if (generated.score.trim()) {
    await fs.writeFile(safeOutputPath(job.id, scoreName), generated.score.endsWith("\n") ? generated.score : `${generated.score}\n`, "utf8");
    outputFiles.push(scoreName);
  }
  // Record what produced the song, so it can be sung again with the same seed or another style.
  await updateWorkflowRun(job.id, run.id, {
    params: {
      ...run.params,
      style,
      lyrics,
      model: generated.model || endpoint.model,
      ...(generated.seed !== undefined ? { seed: generated.seed } : {}),
      ...(generated.durationSeconds !== undefined ? { durationSeconds: generated.durationSeconds } : {}),
      ...(generated.elapsedSeconds !== undefined ? { elapsedSeconds: generated.elapsedSeconds } : {}),
      ...(generated.license ? { license: generated.license } : {}),
      ...(scoreArtifact ? { scoreArtifactId: scoreArtifact.id } : {}),
    },
  });
  const warnings = generated.truncated.length
    ? [`The song ran out of room in the ${generated.truncated.join(" and ")} stage and ends early; try shorter lyrics`]
    : [];
  return { outputFiles: [...new Set([...job.outputFiles, ...outputFiles])], warnings };
}
