# AGENTS.md

Instructions for AI coding agents (and new contributors) working in this repository. Read this first; it is
the single source of truth for how the project is built, tested and changed. `CLAUDE.md` imports this file.

If git-ignored notes exist next to this file (`CLAUDE.local.md`, `AGENTS.local.md`, or `*.local.md`), read
them too: they hold one person's machine-specific setup. Never copy their contents into tracked files.

## What this project is

Sparkfire is a local-first, file-oriented AI workspace: OCR, transcription, translation, visual
grounding, image generation, video generation, mind maps, chat and node-based workflows, behind one web UI.
It began as a fork of [stevibe/SparklingKit](https://github.com/stevibe/SparklingKit) (Apache 2.0) and is now
its own project; `docs/fork.md` lists what it changes and what keeps the old `sparklingkit` names on purpose.
Keep upstream's `NOTICE` and the README credit line, and use the SparklingKit name only to say where the code
comes from.

- **The app** is one Node.js process: an Express 5 API, a React 19 single-page client, and a BullMQ worker
  backed by Redis.
- **Storage is plain files** under `data/`: every job, chat, workflow and setting is a folder or JSON file
  that a person can read, back up or move. There is no database besides Redis for the queue.
- **Models are never bundled.** Each capability calls an OpenAI-compatible HTTP endpoint the user
  configures. The reference deployment runs all of them on one NVIDIA DGX Spark (128 GB unified memory);
  their containers and adapters are in this repo.

## Repository map

| Path | What it holds |
| --- | --- |
| `src/server/index.ts` | API routes, request validation (zod), chat streaming |
| `src/server/store.ts` | Jobs, artifacts, chats and settings on disk; safe path helpers |
| `src/server/processor.ts` | OCR and transcription pipelines (chunking, checkpoints, outputs) |
| `src/server/transcript-timing.ts` | Word timestamps to transcript lines (one per sentence) and subtitle cues |
| `src/server/ai.ts` | Every call to a model service: OCR profiles, ASR, image, chat, health checks |
| `src/server/modules/` | Executors for translation, grounding, text-to-image, text-to-video, text-to-music, mind map and LLM prompts |
| `src/server/workflows/` | The node-based workflow engine |
| `src/server/chat-messages.ts`, `chat-attachments.ts` | Turning stored chats and attached files into model input |
| `src/server/chat-generation.ts` | One answer per chat, run by the server, with its tool-call loop |
| `src/server/web-search.ts`, `page-fetch.ts` | Chat web search: the SearXNG provider, the tools, and SSRF-safe page reading |
| `src/server/thumbnails.ts` | Cached WebP previews and the gallery listing |
| `src/server/queue.ts` | BullMQ queue and worker |
| `src/shared/` | Types and rules shared by client and server: `contracts.ts`, `module-router.ts`, `workflows.ts` |
| `src/client/` | React pages, components, API client, and `styles.css` (all colours are `--sk-*` tokens) |
| `services/dgx-models/` | Model service containers and adapters (Python/FastAPI): image generation, video generation (ComfyUI), music generation (YuE2), PaddleOCR-VL, Parakeet ASR, translation, downloader |
| `services/dgx-status/` | The DGX system monitor service |
| `compose.yaml` | App and Redis |
| `compose.spark.yaml` | Adds the system monitor on a DGX Spark |
| `compose.dgx.yaml` | The model services of the reference stack |
| `compose.search.yaml`, `services/searxng/` | Optional SearXNG for chat web search |
| `scripts/start-dgx-spark.sh` | Builds, downloads (pinned revisions) and starts the whole stack in a memory-safe order |
| `scripts/spark-switch.sh` | Swaps the Spark between Sparkfire and another always-on LLM container |
| `scripts/seed-dev-data.mjs` | Sample jobs, media and a chat for UI work |
| `docs/` | Architecture, deployment, DGX operations, workflows, changes from SparklingKit, validation results |

## Setup and commands

Requirements: Node.js 22 or newer (the Docker image uses Node 24), npm, Docker, and Redis for running the
app. `ffmpeg` and `poppler-utils` (`pdftotext`, `pdftoppm`) are needed for media, PDF and thumbnail paths;
the app image includes them.

```bash
npm install
docker run -d --name sk-redis -p 6379:6379 redis:8-alpine   # once
node scripts/seed-dev-data.mjs                              # optional sample data in ./data
npm run dev                                                 # API on :54321, Vite client with hot reload
```

Set `WORKER_ENABLED=false` to keep seeded queued and running jobs as they are while working on the UI.

| Task | Command |
| --- | --- |
| Type check (client and server) | `npm run typecheck` |
| Unit tests | `npm test` (or `npx vitest run path/to/file.test.ts`) |
| Production build | `npm run build` |
| Python adapter tests (no GPU) | `docker run --rm -v "$PWD/services/dgx-models/image-generation:/app" -w /app python:3.12-slim sh -c "pip install -q fastapi uvicorn python-multipart httpx && python -m unittest"` (same for `paddleocr-vl`, `parakeet`, `video`, `music`, `services/dgx-status`) |
| Whole stack on a DGX Spark | `./scripts/start-dgx-spark.sh --accept-model-licenses [--ocr-backend …] [--image-backend …] [--video-backend fasth3\|none]` |
| Stack status / stop | `./scripts/start-dgx-spark.sh status`, `./scripts/start-dgx-spark.sh stop` |

## How the system works

- **Jobs.** An upload or request creates `data/jobs/<id>/` with `job.json` (the manifest), `input/`,
  `output/` and `work/` (checkpoints, caches). Outputs are typed **artifacts** with lineage, so a result can
  feed the next module ("Continue with"). Each processing pass is a **run** recorded in the manifest.
- **Modules** are `ocr`, `transcription`, `translation`, `grounding`, `text-to-image`, `text-to-video`,
  `text-to-music`, `mindmap` and `chat`.
  Which artifact kinds each accepts is decided in one place, `src/shared/module-router.ts`; do not
  duplicate those rules in UI code.
- **Queue and progress.** Jobs run on a BullMQ worker inside the API process. Progress reaches the browser
  through server-sent events at `/api/jobs/:id/events`. Modules marked `gpuLane: "heavy"` (video, music) take
  turns through `src/server/gpu-lane.ts` on their own queue, and free each other's weights when
  the work switches module.
- **Optional modules.** A module whose service the reference stack does not ship sets
  `hiddenUntilConfigured` in its contract (grounding, and opt-in music). The API then marks it `hidden` while its
  endpoint is off, and every UI list of tools and actions leaves it out; Settings still shows the endpoint.
- **Settings.** `data/config/settings.json`. Environment variables only seed a new file; saved settings win
  on later starts, so upgrades never overwrite a user's endpoints. The one exception is a one-time upgrade,
  recorded in `data/config/upgrades.json` so it runs once: Saluki replaced every install's LLM.
- **Model calls** live in `src/server/ai.ts`. Every request carries its own `AbortSignal` timeout. A global
  undici dispatcher (`src/server/http-dispatcher.ts`) disables Node's 300-second fetch timeouts, which
  would otherwise cut off long generations.
- **OCR** picks its request format from the model id (`ocrProfile`): Unlimited-OCR uses chat completions,
  PaddleOCR-VL uses the adapter's `/v1/ocr` and also returns layout blocks (`document.layout.json`).
- **Speech** picks its request from the model id (`asrProfile`): with a Parakeet id the app asks for word
  timestamps and `src/server/transcript-timing.ts` builds one transcript line per sentence and subtitle cues
  (at most 7 s and 84 characters) from them, and the chunk target is capped at 30 s. Any other id keeps
  Qwen3-ASR's plain request and one line per chunk. The Parakeet adapter takes WAV only.
- **Image generation** asks the service for `/v1/capabilities` (sizes, default and maximum steps) and
  validates requests against it.
- **Music generation** reads `/v1/capabilities` (lyrics and style limits, the license line) and gets a
  multipart answer: the FLAC, the ABC score and the metadata. Text is the lyrics; a `score` artifact is sung as
  written with the lyrics and style of the song that wrote it.
- **Video generation** also reads `/v1/capabilities` (sizes, lengths, variants, the license's disclosure
  line) and gets the MP4 back as the response body, which the executor streams to disk. Text is the prompt
  and an image the first frame; an image without a prompt reuses the prompt of the run that made it.
- **Chat** is stored in `data/chats/<id>/chat.json`, with attached files in `attachments/`. The thinking
  effort (`off|low|medium|high`) becomes `chat_template_kwargs`; reasoning streams as separate events and
  is saved on the answer. Documents become text parts, images become `image_url` parts (newest four per
  request), and only if the LLM endpoint declares image input. An answer runs in the server
  (`src/server/chat-generation.ts`), not in the browser request: a page that leaves stops listening, not the
  model, and reattaches through `/api/chats/:id/stream`. One answer per chat at a time.
- **Web search** in chat is a tool-call loop in `chat-generation.ts`: `web_search` (SearXNG) and
  `fetch_page` (`page-fetch.ts`, which refuses private addresses on the connection itself), at most 6
  rounds. It runs only when the chat turned it on, `settings.webSearch` is configured and the LLM declares
  the `tools` capability. The searches and sources are saved as the answer's `activity` and never sent back
  to the model.

## Model services (DGX Spark reference stack)

| Port | Service | Default model | Alternatives |
| --- | --- | --- | --- |
| 54321 | Sparkfire app | | |
| 8330 | System monitor | | |
| 8331 | Language model (started by hand) | Saluki 27B (`saluki-27b`, llama-server) | any OpenAI-compatible endpoint in Settings |
| 8332 | OCR | Unlimited-OCR | PaddleOCR-VL-1.6 adapter (+ its vLLM on 8342): `--ocr-backend paddleocr-vl` |
| 8333 | Speech recognition | Parakeet-TDT-0.6B-v3 | |
| 8334 | Translation | Hy-MT2-1.8B-FP8 | |
| 8336 | Image generation | Z-Image-Turbo | Qwen-Image 2.1, Qwen-Image-2.1-Turbo: `--image-backend qwen-image-2.1` / `qwen-image-2.1-turbo` |
| 8337 | Video generation | FastH3 (Fast and Sharp variants, through ComfyUI) | none: `--video-backend none` |
| 8338 | Web search (127.0.0.1 only) | none (off by default) | SearXNG: `--search-backend searxng` |
| 8339 | Music generation | none (off by default) | YuE2-3B: `--music-backend yue2` |

Rules for this layer:

- **Memory is the constraint.** The Spark has about 121 GiB of unified memory shared by CPU and GPU. The
  stack does not start the LLM (the app defaults to Saluki 27B in `llama-server` on 8331, ~13 GiB, run by
  hand; any endpoint can replace it in Settings) and ships no grounding (LocateAnything was removed; the
  module stays, endpoint in Settings). It idles around 29 GiB. Video generation loads nothing until a job and frees its weights after
  ten idle minutes; a job adds 35 to 48 GiB with Fast and up to 57 GiB with Sharp while it runs. Music,
  when on, does the same with about 20 GiB a song. Do not start extra models, large builds or big downloads while
  services are loading, and check free memory (`free -g`) before running an LLM next to the stack: one
  that needs most of the Spark does not fit beside it.
- **Pin everything.** Model downloads use exact Hugging Face revisions in `scripts/start-dgx-spark.sh`;
  container images use exact tags or digests; Python requirements are pinned.
- **Adding a model backend:** add it to the adapter's registry (for images, the `BACKENDS` dict in
  `services/dgx-models/image-generation/server.py`), add the option and its pinned download to
  `scripts/start-dgx-spark.sh`, note it in `compose.dgx.yaml`, write adapter unit tests, and document it in
  `docs/fork.md` and the README. Sparkfire's defaults are the ones in the table above.
- **Licenses.** Model weights carry their own licenses and are downloaded only after the user passes
  `--accept-model-licenses`. Qwen-Image 2.1 / Turbo (Qwen Research License) is non-commercial. Parakeet-TDT-0.6B-v3 is CC BY 4.0: keep NVIDIA's credit in the README. FastH3 is under the
  MiniMax H3 Community License, which excludes the EU, the UK, South Korea and the US and asks that shared
  outputs say they are machine-generated: keep the disclosure tag and `--video-backend none`. YuE2's weights
  are CC BY-NC 4.0 with a creator permission, so music stays opt-in (`--music-backend yue2`) and each song
  shows the license line. Never commit weights.
- Validation results and known issues are in `docs/validation.md`.

## Coding conventions

- **TypeScript, strict.** Server imports use the `.js` suffix (Node ESM); client imports do not. Shared
  types and constants go in `src/shared/contracts.ts`.
- **Validate at the edge.** Parse every request body and query with zod in `index.ts`.
- **Files stay the storage model.** Write JSON atomically through the store helpers, build paths only with
  `assertSafeName`, `safeArtifactPath` and friends, keep artifact lineage intact, and keep schema changes
  additive: never silently rewrite a user's folders.
- **Change a job only through `updateJob` and the store helpers.** They hold a per-job lock, because the
  worker and the API change the same `job.json`. When a patch depends on the manifest (appending to a list,
  keeping the runs), pass `updateJob` a function of the current manifest instead of a value read earlier.
- **Match the surrounding code.** Same naming, same density of comments. Comments say why, not what.
- **Styles.** Use the `--sk-*` colour tokens, the `--sk-radius-*` corner tokens and existing component classes
  (for example `.theme-choice` for segmented controls); never hard-code colours or one-off radii. Every UI
  change must work in the dark and light themes and at 1440 and 375 px wide, with no horizontal scroll.
- **Brand.** The mark is one path, `brandMarkPath` in `src/client/brand.ts`; draw it with `BrandMark` in the
  app. `src/client/public/` holds the favicon (the same path) and the PNG icons rendered from it: change
  them together.
- **Tests sit next to the code** (`*.test.ts`, vitest). Behaviour changes need tests. Python adapters use
  `unittest` and must run without a GPU or model weights.
- **Line endings are LF.**
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org/):** `type(scope): description`
  in the imperative and lower case, with a body that explains why. One logical change per commit.
  - Types: `feat`, `fix`, `perf`, `security`, `deps`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`,
    `revert`.
  - Scopes are optional, for example `chat`, `ocr`, `image`, `dgx`, `ui`.
  - A breaking change adds `!` after the type, plus a `BREAKING CHANGE:` footer.
  - Pull requests are squash-merged, so the **PR title** becomes the commit on `main` and must follow the
    same format; a check enforces it.

## CI, security checks and releases

All of it lives in `.github/`:

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `ci.yml` | pushes to `main`, pull requests | Type check, unit tests, production build; Python adapter tests; ShellCheck; Docker builds of the app and the small service images |
| `security.yml` | pushes, pull requests, weekly | CodeQL (TypeScript, Python, workflows); `npm audit` on production dependencies; dependency review on PRs; gitleaks secret scan; Trivy on lockfiles, requirements and Dockerfiles; hadolint |
| `pr-title.yml` | pull requests | Checks the title is a Conventional Commit |
| `fork-release.yml` | pushes to `main` | release-please keeps a release PR with the next version and `CHANGELOG.md`; merging it tags the release, publishes `ghcr.io/<owner>/sparkfire` (amd64 and arm64, with SBOM and provenance) and attaches the DGX stack bundle |

Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm, pip, Dockerfiles, Compose images and
GitHub Actions. Updates to model services change GPU code paths: merge them only after the stack has run
on a DGX Spark.

When a check fails, fix the cause rather than loosening the check. Third-party actions are pinned to commit
SHAs (with the version in a comment); keep it that way when you add or update one. Never commit the version
bump or `CHANGELOG.md` by hand: release-please owns both.

## Security and privacy

- The app has no authentication and assumes a trusted network. Do not add features that expose it
  publicly without access control.
- User files are untrusted input. Serve them back as plain text unless they are images or PDFs, with
  `X-Content-Type-Options: nosniff` and a sandboxing CSP, as the chat attachment route does.
- Never commit `data/`, `.env` files, credentials, model weights, or personal details such as email
  addresses, host names, home directory paths or network names. Put machine-specific notes in a
  `*.local.md` file, which git ignores.

## Working on a shared GPU machine

The DGX Spark is often shared with other workloads. Before starting or stopping anything there:

- Check what is running (`docker ps`, `free -g`, `nvidia-smi`) and leave other people's containers alone.
- Ask before stopping a service you did not start. `scripts/spark-switch.sh` checks that the other LLM is
  idle and asks before swapping.
- Watch for restart loops: a crashed model service restarts automatically and may fail to fit in memory
  while the others run. Stop it and start it again with room rather than letting it loop.

## Definition of done

1. `npm run typecheck` and `npm test` pass, adapter
   tests pass if you touched `services/`, and the CI and Security workflows are green.
2. New behaviour has tests; UI changes were checked in both themes at both widths.
3. Docs are updated: `docs/fork.md` for what Sparkfire changes, the README for anything a user installs or sees,
   `docs/validation.md` for measured results.
4. No personal or machine-specific details in tracked files.
5. Commits and the PR title follow Conventional Commits and explain why.
