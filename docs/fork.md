# Fork notes

Changes in this fork on top of upstream SparklingKit 0.1.5. The README summarises them; this file has the
details. Measured results are in [`validation.md`](validation.md).

## Interface

- **Themes.** All colours are tokens (`--sk-n0` to `--sk-n17` plus tinted families in `src/client/styles.css`).
  Settings → General → Appearance switches between Dark, Light and System.
- **Accent.** Primary actions, focus rings, the active navigation item and progress bars use one mint
  accent (`--sk-accent`).
- **Sidebar.** One "AI services" chip with a popover replaces the per-service status rows. The Spark monitor
  expands on click.
- **Workbench.** A "Running now" strip, readable titles for UUID-named uploads, filter pills on one row,
  and thumbnails in Recent.
- **Gallery** (`/gallery`). Every image across jobs, with source and model filters, a lightbox, and a
  pick-two side-by-side compare.
- **Job viewers.**
  - Transcripts as timed lines, one per sentence with Parakeet, that seek the player.
  - Images with zoom, pan and a before/after slider for grounding results.
  - A heading outline for long documents.
  - A run history in the file sidebar.

API additions:

- `GET /api/jobs/:id/thumbnails/:artifactId?w=160|320|640` returns cached WebP previews of images, video
  frames and PDF first pages.
- `GET /api/gallery?source=&model=&offset=&limit=` lists images across jobs.
- `GET /api/modules/text-to-image/capabilities` returns the sizes and step limits of the active image model.

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

API additions:

- `POST /api/chats/:id/attachments` (multipart `files`) stores files in `data/chats/<id>/attachments/`.
- `GET /api/chats/:id/attachments/:attachmentId` serves one back. Anything but images and PDFs is served as
  plain text.
- `POST /api/chats/:id/messages` also accepts `effort` and `attachmentIds`, and streams `reasoning` events
  next to `delta`.

## Model backends

The DGX stack drops upstream's bundled Qwen3.6 LLM: chat, mind maps and summaries use any
OpenAI-compatible endpoint configured in Settings (this fork runs Saluki 27B in `llama-server`; an
`--llm-backend` service is planned), and so is the grounding service (LocateAnything-3B was removed
from the stack with its 10.9 GiB and 7.3 GB; the grounding module itself stays and works once a
grounding endpoint is configured in Settings). Of the four bundled services, OCR and images keep
upstream's defaults and speech is Parakeet only; two can be switched at deploy time:

| Service | Default | Alternative | Option |
|---|---|---|---|
| OCR (:8332) | Unlimited-OCR | PaddleOCR-VL-1.6 (layout adapter + vLLM VLM on :8342) | `--ocr-backend paddleocr-vl` |
| Speech (:8333) | Parakeet-TDT-0.6B-v3 (parakeet.cpp; CC BY 4.0; 25 European languages) | | |
| Image (:8336) | Z-Image-Turbo | Qwen-Image 2.1 (float8 weights, 2K sizes, 40 steps; Qwen Research License) | `--image-backend qwen-image-2.1` |
| | | Qwen-Image-2.1-Turbo (the same model distilled to 8 fixed steps) | `--image-backend qwen-image-2.1-turbo` |

```bash
./scripts/start-dgx-spark.sh --ocr-backend paddleocr-vl --image-backend qwen-image-2.1-turbo --accept-model-licenses
```

SparklingKit chooses the OCR request format from the model id. After switching the OCR backend on an
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
- **Sentences.** SparklingKit picks the speech request from the model id. For Parakeet it asks for word
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
- **Split mode.** `scripts/start-sparklingkit.sh` with a model host seeds the Parakeet id, as do the
  other bundled model ids.
- **System monitor.** `services/dgx-status` reads `ASR_MODEL_NAME` (default `Parakeet-TDT-0.6B-v3`) to
  label the engine's GPU process.

## Sharing the Spark with another LLM

`scripts/spark-switch.sh` swaps between an always-on LLM container and SparklingKit's stack. It checks
that the LLM is idle, asks for confirmation, waits for memory to free up, and waits for health:

```bash
./scripts/spark-switch.sh status
./scripts/spark-switch.sh sparklingkit --image-backend qwen-image-2.1
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
  - the image, PaddleOCR and Parakeet adapters, without a GPU
  - OCR and speech profiles, sentence and cue building, thumbnails, the gallery and the viewer helpers
  - chat thinking options, stream parsing, and attachments
- **Validated on a DGX Spark:** PaddleOCR-VL-1.6, Parakeet TDT 0.6B v3, Qwen-Image 2.1 and its Turbo
  version, and the memory of the full stack. Results and known issues are in [`validation.md`](validation.md).

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
