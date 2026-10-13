# ADR 0003: Heavy jobs take turns in one GPU lane

Status: Accepted

## Context

Text to video loads 35 to 57 GiB while it renders and keeps its weights for ten idle minutes. A YuE2 song,
measured on the Spark before text to music joined the stack, adds about 20 GiB. Next to the rest of the
reference stack and its LLM, two such jobs do not fit on one Spark (`docs/validation.md`). Before this
decision, nothing stopped two of them from starting together: the queue runs two jobs at a time, and
workflow nodes run modules too.

## Decision

- A module's contract can declare `gpuLane: "heavy"` (text to video and text to music). Every run of such a
  module, whether started from its page, through **Continue with** or by a workflow node, passes through
  one in-process lane. The lane runs them one at a time, in arrival order. A run that waits shows "Waiting
  for the GPU" with what holds the lane, and can be stopped while it waits.
- When the lane passes from one heavy module to another, it first asks the other configured heavy
  services to free their weights (`POST /v1/unload`) instead of waiting out their idle timeouts.
- Heavy module runs go to their own BullMQ queue (`sparkfire-heavy`), so a run waiting for the lane
  does not hold one of the general workers that OCR, transcription, translation and images need. That
  queue has several workers (eight). With one worker, the second video sat in Redis as "Waiting for a
  worker" and never reached the lane that orders it and explains the wait.

## Considered options

- **One general worker**: serialises heavy jobs, but OCR, transcription and images would then wait
  behind every video, which can render for up to 9.5 minutes.
- **A lock per service, or the services' own memory checks**: they keep two jobs of the same module
  apart, but a video and a song from different modules could still load together, and nothing frees the
  previous module's weights.
- **Relying on the idle unload**: a video's weights stay loaded for ten minutes after a job, so the next
  heavy module would load on top of them.

## Consequences

- The lane lives in the API process. It works because the worker runs in that process
  ([ADR 0001](0001-modular-monolith.md)); a separate worker process would need a shared lock instead.
- The lane orders Sparkfire's own heavy jobs only. Memory held by something else on the Spark, another
  process or a job outside the lane, is not its to see.
- Workflow runs stay on the general queue. A workflow's video or song node waits for the lane while it holds
  a general worker, so with the default two workers, two such workflows can hold back other jobs.

## Later notes

- 2026-10-13: text to music joined the lane, so switching between a video and a song now frees the other
  service's weights first.
- 2026-10-13: for the memory the lane cannot see, the video and music services check free memory before a
  job against what it was measured to need, and answer 503 with `Retry-After` when it is short. The run
  shows "Waiting for memory" and asks again, keeping its turn in the lane, for up to 30 minutes
  (`retryWhileShortOfMemory` in `src/server/gpu-lane.ts`).
