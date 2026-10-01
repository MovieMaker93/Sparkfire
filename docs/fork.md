# Fork notes

Changes in this fork on top of upstream SparklingKit 0.1.5. Kept in this file, not the README, so upstream
releases rebase cleanly.

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

## Model backends

The DGX stack keeps upstream's six services and defaults. Two of them can be switched at deploy time:

| Service | Default | Alternative | Option |
|---|---|---|---|
| OCR (:8332) | Unlimited-OCR | PaddleOCR-VL-1.6 (layout adapter + vLLM VLM on :8342) | `--ocr-backend paddleocr-vl` |
| Image (:8336) | Z-Image-Turbo | Qwen-Image 2.1 (float8 weights, 2K sizes, 40 steps; Qwen Research License) | `--image-backend qwen-image-2.1` |

```bash
./scripts/start-dgx-spark.sh --ocr-backend paddleocr-vl --image-backend qwen-image-2.1 --accept-model-licenses
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

- Unit tests cover:
  - the image and PaddleOCR adapters, without a GPU
  - OCR profiles, thumbnails, the gallery and the viewer helpers
- Still to validate on the DGX Spark:
  - PaddleOCR-VL's layout stage on aarch64
  - Qwen-Image 2.1 with torchao float8 on sm_121
  - peak memory of the full stack with the alternatives enabled
