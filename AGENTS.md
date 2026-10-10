# AGENTS.md

Instructions for AI coding agents (and new contributors) working in this repository. Read this first; it is
the single source of truth for how the project is built, tested and changed. `CLAUDE.md` imports this file.

If git-ignored notes exist next to this file (`CLAUDE.local.md`, `AGENTS.local.md`, or `*.local.md`), read
them too: they hold one person's machine-specific setup. Never copy their contents into tracked files.

## What this project is

SparklingKit is a local-first, file-oriented AI workspace: OCR, transcription, translation, visual
grounding, image generation, mind maps, chat and node-based workflows, behind one web UI. This repository is
an unofficial fork of [stevibe/SparklingKit](https://github.com/stevibe/SparklingKit) that adds switchable
model backends, interface work and chat features; see `docs/fork.md`.

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
| `src/server/ai.ts` | Every call to a model service: OCR profiles, ASR, image, chat, health checks |
| `src/server/modules/` | Executors for translation, grounding, text-to-image, mind map and LLM prompts |
| `src/server/workflows/` | The node-based workflow engine |
| `src/server/chat-messages.ts`, `chat-attachments.ts` | Turning stored chats and attached files into model input |
| `src/server/thumbnails.ts` | Cached WebP previews and the gallery listing |
| `src/server/queue.ts` | BullMQ queue and worker |
| `src/shared/` | Types and rules shared by client and server: `contracts.ts`, `module-router.ts`, `workflows.ts` |
| `src/client/` | React pages, components, API client, and `styles.css` (all colours are `--sk-*` tokens) |
| `services/dgx-models/` | Model service containers and adapters (Python/FastAPI): image generation, PaddleOCR-VL, ASR, translation, grounding, downloader |
| `services/dgx-status/` | The DGX system monitor service |
| `compose.yaml` | App and Redis |
| `compose.spark.yaml` | Adds the system monitor on a DGX Spark |
| `compose.dgx.yaml` | The model services of the reference stack |
| `scripts/start-dgx-spark.sh` | Builds, downloads (pinned revisions) and starts the whole stack in a memory-safe order |
| `scripts/spark-switch.sh` | Swaps the Spark between SparklingKit and another always-on LLM container |
| `scripts/seed-dev-data.mjs` | Sample jobs, media and a chat for UI work |
| `distribution/` | Upstream's release installers (they install upstream SparklingKit, not this fork) |
| `docs/` | Architecture, deployment, DGX operations, workflows, fork notes, validation results |

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
| Python adapter tests (no GPU) | `docker run --rm -v "$PWD/services/dgx-models/image-generation:/app" -w /app python:3.12-slim sh -c "pip install -q fastapi uvicorn python-multipart && python -m unittest"` (same for `paddleocr-vl`, `services/dgx-status`) |
| Whole stack on a DGX Spark | `./scripts/start-dgx-spark.sh --accept-model-licenses [--ocr-backend …] [--image-backend …]` |
| Stack status / stop | `./scripts/start-dgx-spark.sh status`, `./scripts/start-dgx-spark.sh stop` |

On Windows, 8 tests in `src/server/dgx-update.test.ts` fail before any change because GNU tar reads `C:`
as a host name; they pass on Linux and in CI.

## How the system works

- **Jobs.** An upload or request creates `data/jobs/<id>/` with `job.json` (the manifest), `input/`,
  `output/` and `work/` (checkpoints, caches). Outputs are typed **artifacts** with lineage, so a result can
  feed the next module ("Continue with"). Each processing pass is a **run** recorded in the manifest.
- **Modules** are `ocr`, `transcription`, `translation`, `grounding`, `text-to-image`, `mindmap` and `chat`.
  Which artifact kinds each accepts is decided in one place, `src/shared/module-router.ts`; do not
  duplicate those rules in UI code.
- **Queue and progress.** Jobs run on a BullMQ worker inside the API process. Progress reaches the browser
  through server-sent events at `/api/jobs/:id/events`.
- **Settings.** `data/config/settings.json`. Environment variables only seed a new file; saved settings win
  on later starts, so upgrades never overwrite a user's endpoints.
- **Model calls** live in `src/server/ai.ts`. Every request carries its own `AbortSignal` timeout. A global
  undici dispatcher (`src/server/http-dispatcher.ts`) disables Node's 300-second fetch timeouts, which
  would otherwise cut off long generations.
- **OCR** picks its request format from the model id (`ocrProfile`): Unlimited-OCR uses chat completions,
  PaddleOCR-VL uses the adapter's `/v1/ocr` and also returns layout blocks (`document.layout.json`).
- **Image generation** asks the service for `/v1/capabilities` (sizes, default and maximum steps) and
  validates requests against it.
- **Chat** is stored in `data/chats/<id>/chat.json`, with attached files in `attachments/`. The thinking
  effort (`off|low|medium|high`) becomes `chat_template_kwargs`; reasoning streams as separate events and
  is saved on the answer. Documents become text parts, images become `image_url` parts (newest four per
  request), and only if the LLM endpoint declares image input.

## Model services (DGX Spark reference stack)

| Port | Service | Default model | Alternatives in this fork |
| --- | --- | --- | --- |
| 54321 | SparklingKit app | | |
| 8330 | System monitor | | |
| 8331 | LLM (vLLM) | Qwen3.6-35B-A3B NVFP4 | |
| 8332 | OCR | Unlimited-OCR | PaddleOCR-VL-1.6 adapter (+ its vLLM on 8342): `--ocr-backend paddleocr-vl` |
| 8333 | Speech recognition | Qwen3-ASR-1.7B | |
| 8334 | Translation | Hy-MT2-1.8B-FP8 | |
| 8335 | Grounding | LocateAnything-3B | |
| 8336 | Image generation | Z-Image-Turbo | Qwen-Image 2.1, Qwen-Image-2.1-Turbo: `--image-backend qwen-image-2.1` / `qwen-image-2.1-turbo` |

Rules for this layer:

- **Memory is the constraint.** The Spark has about 121 GiB of unified memory shared by CPU and GPU. The
  full stack idles around 85 GiB and peaked at 93.5 GiB under load. The start script loads the LLM first
  because its loading peak is the largest. Do not start extra models, large builds or big downloads while
  services are loading, and never run a second large LLM next to the stack.
- **Pin everything.** Model downloads use exact Hugging Face revisions in `scripts/start-dgx-spark.sh`;
  container images use exact tags or digests; Python requirements are pinned.
- **Adding a model backend:** add it to the adapter's registry (for images, the `BACKENDS` dict in
  `services/dgx-models/image-generation/server.py`), add the option and its pinned download to
  `scripts/start-dgx-spark.sh`, note it in `compose.dgx.yaml`, write adapter unit tests, and document it in
  `docs/fork.md` and the README. Upstream's defaults stay the defaults.
- **Licenses.** Model weights carry their own licenses and are downloaded only after the user passes
  `--accept-model-licenses`. Qwen-Image 2.1 / Turbo (Qwen Research License) and LocateAnything-3B are
  non-commercial. Never commit weights.
- Validation results and known issues are in `docs/validation.md`.

## Coding conventions

- **TypeScript, strict.** Server imports use the `.js` suffix (Node ESM); client imports do not. Shared
  types and constants go in `src/shared/contracts.ts`.
- **Validate at the edge.** Parse every request body and query with zod in `index.ts`.
- **Files stay the storage model.** Write JSON atomically through the store helpers, build paths only with
  `assertSafeName`, `safeArtifactPath` and friends, keep artifact lineage intact, and keep schema changes
  additive: never silently rewrite a user's folders.
- **Match the surrounding code.** Same naming, same density of comments. Comments say why, not what.
- **Styles.** Use the `--sk-*` colour tokens and existing component classes (for example `.theme-choice` for
  segmented controls); never hard-code colours. Every UI change must work in the dark and light themes and
  at 1440 and 375 px wide, with no horizontal scroll.
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
| `fork-release.yml` | pushes to `main` | release-please keeps a release PR with the next version and `CHANGELOG.md`; merging it tags the release, publishes `ghcr.io/<owner>/sparklingkit` (amd64 and arm64, with SBOM and provenance) and attaches the DGX stack bundle |
| `release.yml`, `publish-run-site.yml` | upstream only | Upstream's own release and install site; skipped outside `stevibe/SparklingKit` |

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

1. `npm run typecheck` and `npm test` pass (apart from the known Windows-only failures above), adapter
   tests pass if you touched `services/`, and the CI and Security workflows are green.
2. New behaviour has tests; UI changes were checked in both themes at both widths.
3. Docs are updated: `docs/fork.md` for fork features, the README for anything a user installs or sees,
   `docs/validation.md` for measured results.
4. No personal or machine-specific details in tracked files.
5. Commits and the PR title follow Conventional Commits and explain why.
