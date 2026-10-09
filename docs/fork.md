# Fork notes

Changes in this fork on top of upstream SparklingKit 0.1.5. The README summarises them; this file has the
details. Measured results are in [`validation.md`](validation.md).

## Interface

- **Themes.** All colours are tokens (`--sk-n0` to `--sk-n17` plus tinted families in `src/client/styles.css`).
  Settings → General → Appearance switches between Dark, Light and System.
- **Accent.** Primary actions, focus rings, the active navigation item and progress bars use one mint
  accent (`--sk-accent`).
- **Sidebar.** One "AI services" chip with a popover replaces the six status rows. The Spark monitor
  expands on click.
- **Workbench.** A "Running now" strip, readable titles for UUID-named uploads, filter pills on one row,
  and thumbnails in Recent.
- **Gallery** (`/gallery`). Every image across jobs, with source and model filters, a lightbox, and a
  pick-two side-by-side compare.
- **Job viewers.**
  - Transcripts as timed lines that seek the player.
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

The DGX stack keeps upstream's six services and defaults. Two of them can be switched at deploy time:

| Service | Default | Alternative | Option |
|---|---|---|---|
| OCR (:8332) | Unlimited-OCR | PaddleOCR-VL-1.6 (layout adapter + vLLM VLM on :8342) | `--ocr-backend paddleocr-vl` |
| Image (:8336) | Z-Image-Turbo | Qwen-Image 2.1 (float8 weights, 2K sizes, 40 steps; Qwen Research License) | `--image-backend qwen-image-2.1` |
| | | Qwen-Image-2.1-Turbo (the same model distilled to 8 fixed steps) | `--image-backend qwen-image-2.1-turbo` |

```bash
./scripts/start-dgx-spark.sh --ocr-backend paddleocr-vl --image-backend qwen-image-2.1-turbo --accept-model-licenses
```

SparklingKit chooses the OCR request format from the model id. After switching the OCR backend on an
existing install, set the OCR model to `PaddleOCR-VL-1.6` in Settings → Services. The adapter also
accepts chat-style OCR requests, so a stale setting keeps working, but layout blocks
(`document.layout.json`) need the new model id.

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
  - the image and PaddleOCR adapters, without a GPU
  - OCR profiles, thumbnails, the gallery and the viewer helpers
  - chat thinking options, stream parsing, and attachments
- **Validated on a DGX Spark:** PaddleOCR-VL-1.6, Qwen-Image 2.1 and its Turbo version, and the memory of
  the full stack. Results and known issues are in [`validation.md`](validation.md).

## Roadmap

1. **LLM backend switch:** `--llm-backend qwen36|saluki`, with a llama.cpp service built for sm_121.
   Saluki 27B takes half the memory and has no loading peak (see `validation.md`).
2. **Safer LLM restarts:** start the LLM before the other services on every restart, and replace
   `restart: unless-stopped` with a bounded restart, so a crash cannot turn into an out-of-memory loop.
3. **Parakeet as the ASR backend,** with word timestamps for word-accurate subtitles. It is as accurate
   as Qwen3-ASR, much faster, and frees about 11 GiB.
4. **Image defaults:** make Qwen-Image-2.1-Turbo the default Qwen backend, and its 2K sizes the default for
   prompts with text.
5. **Security:**
   - Remove the open `cors()`.
   - Redact API keys in `GET /api/settings`.
   - Add a host allowlist and an optional access token.
6. **Correctness and speed:**
   - Add a per-job lock in `updateJob`.
   - Send OCR pages and ASR chunks with bounded concurrency.
7. **Long documents:**
   - Give chat and mind maps a token budget, then retrieval.
   - Add full-text search.
8. **Image editing** with Qwen-Image 2.1: reference images, masks, and grounding → edit.
