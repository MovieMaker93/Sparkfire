# What Sparkfire changes

Sparkfire began as a fork of [SparklingKit](https://github.com/stevibe/SparklingKit) 0.1.5 by Steven Lei
(Apache 2.0) and is now its own project: a hard fork that credits upstream and picks up upstream fixes by
hand when they are useful. This file lists what it changes on top of SparklingKit; the README summarises
it. Measured results are in [`validation.md`](validation.md).

## Name and compatibility

- **Name.** The product is Sparkfire; Apache 2.0 section 6 does not grant use of the SparklingKit name, which
  appears only where it says where the code comes from. Upstream's [NOTICE](../NOTICE) is kept below
  Sparkfire's.
- **Kept on purpose.** The compose project, container and local image names, the BullMQ queue, browser
  storage keys and model-download markers keep their `sparklingkit` prefix. Renaming them would orphan the
  Redis volume, drop saved preferences or download every model again on existing installs.
- **Environment.** `SPARKFIRE_*` variables are read first, then the `SPARKLINGKIT_*` names of older installs.
- **Installers.** Upstream's hosted installer (`distribution/`, run.sparklingkit.com) is removed, because it
  installs upstream. Sparkfire installs from a clone; releases publish `ghcr.io/<owner>/sparkfire` and a
  DGX stack bundle.

## Interface

- **Themes.** All colours are tokens (`--sk-n0` to `--sk-n17` plus tinted families in `src/client/styles.css`).
  Settings → General → Appearance switches between Dark, Light and System.
- **Accent.** Primary actions, focus rings, the active navigation item and progress bars use one mint
  accent (`--sk-accent`).
- **Sidebar.** One "AI services" chip with a popover replaces the per-service status rows. The Spark monitor
  expands on click.
- **Optional tools.** Grounding, whose service the stack does not ship, stays out of the sidebar, the Tools
  page, search, Continue with actions, the Workbench filters and tiles, the workflow palette and the services chip
  until a grounding endpoint is enabled. Settings → Services always lists it.
- **Workbench.** A "Running now" strip, readable titles for UUID-named uploads, filter pills on one row,
  thumbnails in Recent, and a "Create a video" tile in place of "Find something in an image" (which
  returns once grounding is configured).
- **Links.** The footer, the "Update available" check (this repository's GitHub releases, not upstream's
  manifest) and the onboarding install command point at Sparkfire.
- **Gallery** (`/gallery`). Every image and generated video across jobs, with source and model filters, a
  lightbox that plays videos, and a pick-two side-by-side compare.
- **Job viewers.**
  - Transcripts as timed lines, one per sentence with Parakeet, that seek the player.
  - Images with zoom, pan and a before/after slider for grounding results.
  - A heading outline for long documents.
  - A run history in the file sidebar.

API additions:

- `GET /api/jobs/:id/thumbnails/:artifactId?w=160|320|640` returns cached WebP previews of images, video
  frames and PDF first pages.
- `GET /api/gallery?source=&model=&offset=&limit=` lists images and generated videos across jobs.
- `GET /api/modules/text-to-image/capabilities` returns the sizes and step limits of the active image model.
- `GET /api/modules/text-to-video/capabilities` and `POST /api/modules/text-to-video/jobs` (multipart, with an
  optional `firstFrame` image): see [Video generation](#video-generation-fasth3).

## Chat

- **Thinking control.** Off, Low, Medium and High under the composer, remembered per browser. It is sent
  as `chat_template_kwargs`: `enable_thinking`, plus `reasoning_effort` (low, medium) for Qwen3.8-based
  models; High keeps the model's own default. Models without a thinking mode ignore it.
- **Reasoning.** It streams into a foldable block while the model thinks and is saved with the answer. It
  is not sent back to the model on later turns.
- **Attachments.** A + button, paste, or drag and drop add up to 8 files per message.
  - **Images** go to the model as image input (the newest four per request), when the LLM endpoint
    declares image input in Settings → Services.
  - **PDFs** send their text layer. Scans without one send their first pages as images.
  - **Text and code files** send their text, trimmed to 60,000 characters each.
- **Model name.** The header shows the configured LLM with a friendly name. Requests always use the
  configured model, so chats created before a model switch keep working.
- **Answers outlive the page.** The server generates each answer on its own, not inside the browser's
  request. Leaving the chat, switching pages or reloading no longer cuts the model off: the answer is saved
  when it finishes, and opening the chat again picks the stream back up where it is. Stop asks the server to
  end the answer and keeps what was written so far. A chat takes one answer at a time; a second message
  while one is running is refused.

API additions:

- `POST /api/chats/:id/attachments` (multipart `files`) stores files in `data/chats/<id>/attachments/`.
- `GET /api/chats/:id/attachments/:attachmentId` serves one back. Anything but images and PDFs is served as
  plain text.
- `POST /api/chats/:id/messages` also accepts `effort` and `attachmentIds`, and streams `reasoning` events
  next to `delta`. It answers 409 while the chat is still generating an answer.
- `GET /api/chats/:id/stream` follows the answer being generated: a `snapshot` of the text so far, then the
  same events as the message stream. It answers 204 when nothing is running.
- `POST /api/chats/:id/stop` stops the answer being generated; the partial answer is saved.

## Model backends

The DGX stack drops upstream's bundled Qwen3.6 LLM: chat, mind maps and summaries use any
OpenAI-compatible endpoint configured in Settings (the reference is Saluki 27B in `llama-server`; an
`--llm-backend` service is planned), and so is the grounding service (LocateAnything-3B was removed
from the stack with its 10.9 GiB and 7.3 GB; the grounding module itself stays and works once a
grounding endpoint is configured in Settings). Of the bundled services, OCR and images keep upstream's
defaults, speech is Parakeet only, and video generation is Sparkfire's own; three can be switched at
deploy time:

| Service | Default | Alternative | Option |
|---|---|---|---|
| OCR (:8332) | Unlimited-OCR | PaddleOCR-VL-1.6 (layout adapter + vLLM VLM on :8342) | `--ocr-backend paddleocr-vl` |
| Speech (:8333) | Parakeet-TDT-0.6B-v3 (parakeet.cpp; CC BY 4.0; 25 European languages) | | |
| Image (:8336) | Z-Image-Turbo | Qwen-Image 2.1 (float8 weights, 2K sizes, 40 steps; Qwen Research License) | `--image-backend qwen-image-2.1` |
| | | Qwen-Image-2.1-Turbo (the same model distilled to 8 fixed steps) | `--image-backend qwen-image-2.1-turbo` |
| Video (:8337) | FastH3 (MiniMax H3 Community License; not licensed in the EU, UK, South Korea or US) | none | `--video-backend none` |

```bash
./scripts/start-dgx-spark.sh --ocr-backend paddleocr-vl --image-backend qwen-image-2.1-turbo --accept-model-licenses
```

Sparkfire chooses the OCR request format from the model id. After switching the OCR backend on an
existing install, set the OCR model to `PaddleOCR-VL-1.6` in Settings → Services. The adapter also
accepts chat-style OCR requests, so a stale setting keeps working, but layout blocks
(`document.layout.json`) need the new model id.

## Speech recognition: Parakeet

Parakeet TDT 0.6B v3 is the default speech model, run by [parakeet.cpp](https://github.com/mudler/parakeet.cpp)
(MIT) from the f16 GGUF in `mudler/parakeet-cpp-gguf`. The weights are NVIDIA's, under CC BY 4.0, which allows
commercial use with credit. It replaced this stack's earlier Qwen3-ASR backend: 1.7 GiB instead of
16.5 GiB, 10 to 16 times faster through the app on long files, and as accurate on short clips (3.6%
against 3.7% word error rate in English, 3.9% against 4.4% in Italian). Its limit is language: 25
European languages against Qwen3-ASR's 52; Qwen3-ASR was removed from the stack, but the app still
speaks its API for a user-configured endpoint.

- **Service.**
  - `sparklingkit-parakeet` (image `sparklingkit/parakeet:parakeet.cpp-v0.5.0`) builds the engine from
    pinned source for sm_121 and puts a small FastAPI adapter on :8333, so the app's endpoint is unchanged.
    The adapter starts the engine on 127.0.0.1:8343 and exits if it dies, so Docker restarts the container.
  - The engine serves one request at a time, and the adapter queues them. It accepts WAV only, which is
    what the app sends (16 kHz chunks); anything else gets a 400.
  - Both speech backends use :8333, so the start script stops the one you did not choose. It downloads only
    the chosen model, and only the one GGUF file of its repository, at a pinned revision.
- **Sentences.** Sparkfire picks the speech request from the model id. For Parakeet it asks for word
  timestamps and builds the output from them (`src/server/transcript-timing.ts`):
  - One transcript line per sentence, saved as `segments` in `transcript.json` next to the `words`. A
    pause of 1.5 s also ends a line, and the Markdown text starts a new paragraph at a pause of 2 s.
  - SRT and WebVTT cues end at a sentence end or before a pause of 0.8 s, and last at most 7 s and 84
    characters. Words are never split.
  - A dot before a lowercase word, after an abbreviation such as Mr. or Dr., or after a single initial does
    not end a sentence.
  - Other speech models keep the plain transcript: one line per chunk.
- **Chunks.** For Parakeet the app caps the processing window at 30 s (a chunk is about 30–38 s with its
  3 s overlap), because parakeet.cpp skipped whole utterances inside some 60 s chunks. The overlap between
  chunks is cut by word times, so no word appears twice.
- **Known issue.** parakeet.cpp occasionally drops a stretch of speech for a given audio window. See
  [`validation.md`](validation.md#known-issues).
- **Updating an existing install.** Saved settings are never rewritten. After the start script switches the
  service, choose `Parakeet-TDT-0.6B-v3` under Settings → Services → Speech to text. Until then,
  transcription still works, with minute-long lines.
- **Split mode.** `scripts/start-sparkfire.sh` with a model host seeds the Parakeet id, as do the
  other bundled model ids.
- **System monitor.** `services/dgx-status` reads `ASR_MODEL_NAME` (default `Parakeet-TDT-0.6B-v3`) to
  label the engine's GPU process.

## Video generation: FastH3

The Text to video module makes a short video with its own sound track from a prompt, and can start from an
image: upload one in the form, or hand over an image result with **Continue with → Create video**, which also
prefills the prompt that made the image. Videos are `generated-video` artifacts with lineage, play on the job
page and in the Gallery, and can be a workflow node.

- **Model.** FastH3, FastVideo's 8-step distill of MiniMax H3, in two variants that share the Qwen3-VL-32B
  NVFP4 text encoder and the video and audio decoders (about 53 GB in all):
  - **Fast:** FastH3 Trim, NVFP4 (`FastVideo/FastVideo-FastH3-Trim-Comfy`).
  - **Sharp:** FastH3 V2 pruned, int8 (`FastVideo/FastVideo-FastH3-Comfy`): about twice as slow, sharper.
  - Sizes 864 × 480, 1280 × 736 and 1344 × 768; 5, 8 or 10 seconds at 24 fps; H.264 video with AAC sound.
  - Optional sound and music fields go into the model's own prompt sections (`overall_soundscape`,
    `non_diegetic_music`).
- **Service.** `sparklingkit-video-generation` on :8337 runs ComfyUI at a pinned commit on 127.0.0.1:8347,
  behind a FastAPI adapter, because no diffusers release loads FastH3 yet ([ADR 0002](adr/0002-video-service-comfyui.md)).
  - The adapter writes FastVideo's official FastH3 graphs with the requested values and returns the MP4 as
    the response body; the app streams it to disk.
  - Nothing loads until the first job. The weights are freed after `VIDEO_IDLE_UNLOAD_SECONDS` (default
    600) without a job, and before a job that needs the other variant, so only one diffusion model is ever
    resident. `POST /v1/unload` frees them at once.
  - Identical requests (prompt, seed and settings) return ComfyUI's cached result at once.
- **Disclosure.** The MiniMax H3 license asks that shared outputs be disclosed as machine-generated. Every
  MP4 carries the comment "AI-generated with MiniMax H3 (FastH3)", and the job page and the form show it.
  Commercial products built on it must also display "MiniMax H3".
- **Territory.** The license grants use only "worldwide, excluding" the European Union, the United Kingdom,
  South Korea and the United States. Deploy with `--video-backend none` there; onboarding then verifies the
  stack without video. LTX-2.5 (Lightricks, LTX-2.x Community License, worldwide) also makes video with sound
  and has official ComfyUI support, so it is the candidate for a second backend in the adapter's registry.
- **Updating an existing install.** The start script builds the service and
  downloads both checkpoint sets at pinned revisions. Saved settings gain the video endpoint automatically when it was empty.

## Sharing the Spark with another LLM

`scripts/spark-switch.sh` swaps between an always-on LLM container and Sparkfire's stack. It checks
that the LLM is idle, asks for confirmation, waits for memory to free up, and waits for health:

```bash
./scripts/spark-switch.sh status
./scripts/spark-switch.sh sparkfire --image-backend qwen-image-2.1
./scripts/spark-switch.sh llm
```

Configure it with `scripts/spark-switch.env` (see `spark-switch.env.example`).

## Development

```bash
docker run -d --name sk-redis -p 6379:6379 redis:8-alpine
node scripts/seed-dev-data.mjs          # sample jobs, media and a chat in ./data (needs ffmpeg)
npm run dev
```

## Status

- **Unit tests** cover:
  - the image, PaddleOCR, Parakeet and video adapters, without a GPU
  - OCR and speech profiles, sentence and cue building, thumbnails, the gallery and the viewer helpers
  - chat thinking options, stream parsing, attachments, and answers that continue without the page
- **Validated on a DGX Spark:** PaddleOCR-VL-1.6, Parakeet TDT 0.6B v3, Qwen-Image 2.1 and its Turbo
  version, FastH3 video through the service, and the memory of the full stack. Results and known issues are in [`validation.md`](validation.md).

## Roadmap

1. **LLM backend service:** package Saluki as a llama.cpp service built for sm_121 (the stack itself ships no LLM).
   Saluki 27B takes half the memory and has no loading peak (see `validation.md`).
2. **Safer LLM restarts:** start the LLM before the other services on every restart, and replace
   `restart: unless-stopped` with a bounded restart, so a crash cannot turn into an out-of-memory loop.
3. **Image defaults:** make Qwen-Image-2.1-Turbo the default Qwen backend, and its 2K sizes the default for
   prompts with text.
4. **Security:**
   - Remove the open `cors()`.
   - Redact API keys in `GET /api/settings`.
   - Add a host allowlist and an optional access token.
   - Run the app and service containers as a non-root user (Trivy DS-0002); existing `data/` folders need
     their ownership migrated.
5. **Correctness and speed:**
   - Add a per-job lock in `updateJob`.
   - Send OCR pages and ASR chunks with bounded concurrency.
6. **Long documents:**
   - Give chat and mind maps a token budget, then retrieval.
   - Add full-text search.
7. **Image editing** with Qwen-Image 2.1: reference images, masks, and grounding → edit.
