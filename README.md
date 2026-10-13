<img src="src/client/public/favicon.svg" width="64" height="64" alt="">

# Sparkfire — a local AI workspace for one DGX Spark

[![CI](https://github.com/MovieMaker93/Sparkfire/actions/workflows/ci.yml/badge.svg)](https://github.com/MovieMaker93/Sparkfire/actions/workflows/ci.yml)
[![Security](https://github.com/MovieMaker93/Sparkfire/actions/workflows/security.yml/badge.svg)](https://github.com/MovieMaker93/Sparkfire/actions/workflows/security.yml)
[![Release](https://img.shields.io/github/v/release/MovieMaker93/Sparkfire?style=flat-square)](https://github.com/MovieMaker93/Sparkfire/releases)
[![Platform](https://img.shields.io/badge/platform-DGX%20Spark%20%C2%B7%20ARM64-76b900?style=flat-square)](#quick-start)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square)](https://react.dev)
[![Express](https://img.shields.io/badge/Express-5-444444?style=flat-square)](https://expressjs.com)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)

**Sparkfire turns files into reusable AI work. It reads documents, transcribes recordings, translates, generates images and videos with sound, sings songs from your lyrics, maps ideas, and lets you chat about all of it, with web search. The models run on your own DGX Spark.**

Every source and every result stays an ordinary file with its history, so one result can feed the next: a scanned PDF becomes Markdown, then a translation, a mind map or a conversation; a generated image becomes the first frame of a video. Seven models, chosen and measured to share one Spark's memory, sit behind one interface, and your files stay on your network.

> [!NOTE]
> Based on [SparklingKit](https://github.com/stevibe/SparklingKit) by Steven Lei (Apache 2.0). Sparkfire is maintained by [MovieMaker93](https://github.com/MovieMaker93) and is not affiliated with or endorsed by the SparklingKit project. See [what Sparkfire changes](#what-sparkfire-changes).

[![A tour of Sparkfire running real models on a DGX Spark: the workbench, OCR, image and video generation, chat with web search, chat with a file, and a mind map (click for the MP4)](.github/media/tour.webp)](.github/media/tour.mp4)

[Watch the tour as MP4](.github/media/tour.mp4) · recorded on one DGX Spark with the real models; only the waits are fast-forwarded.

* * *

## Contents

- [Features](#features): [the Workbench](#the-workbench) · [documents and recordings](#documents-and-recordings) · [create](#create) · [ask and research](#ask-and-research) · [automate](#automate) · [interface](#interface)
- [Quick start](#quick-start) · [The chat model](#the-chat-model) · [Other ways to run it](#other-ways-to-run-it) · [Upgrading](#upgrading)
- [Models and memory](#models-and-memory) · [Heavy jobs take turns](#heavy-jobs-take-turns) · [Video: choices and trade-offs](#video-choices-and-trade-offs)
- [Configuration](#configuration) · [How it works](#how-it-works) · [Security and privacy](#security-and-privacy)
- [What Sparkfire changes](#what-sparkfire-changes) · [Contributing](#contributing) · [License](#license) · [Acknowledgements](#acknowledgements)

* * *

## Features

Every use case below has its own model, and they all run on the same Spark at the same time: a recording can be transcribed while an image renders and a conversation gets its answer. Only heavy jobs, videos and songs, take turns ([Heavy jobs take turns](#heavy-jobs-take-turns)).

Each clip is the real app on a DGX Spark with demo files. Only the time spent waiting for a model is fast-forwarded. Click a clip for the full-quality MP4.

### The Workbench

Start anything from one page: drop a file to read or transcribe it, translate text as you type, create an image (Standard or High, at 2K) or a video, ask the model, build a mind map, or run one of your workflows. **Running now** at the top shows live progress, and says why a job is still waiting. Recent work keeps readable names and thumbnails, with a tab for each kind of result. Search (Ctrl+K or ⌘K) finds jobs, conversations, modules and generated files by name.

[![The Workbench with two images generating and a video queued, then the modules and recent work below (click for the MP4)](.github/media/workbench.webp)](.github/media/workbench.mp4)

### Documents and recordings

#### Read documents (OCR)

Drop a PDF or a scan and get Markdown that keeps headings, tables and reading order, with the page layout saved next to it. Sparkfire uses PaddleOCR-VL-1.6: on a 20-page test document it kept 99.9 % of the words in reading order and every numeric table cell, at about 6 seconds a page. Long documents get an outline to jump through, and the source view shows the Markdown as saved.

[![A three-page report recognised into Markdown: jumping through the outline, then the Markdown source (click for the MP4)](.github/media/ocr.webp)](.github/media/ocr.mp4)

#### Transcribe recordings

Parakeet-TDT-0.6B-v3 turns audio and video into a transcript with one line per sentence, and into subtitles (SRT and WebVTT) cut to a readable size from its word timestamps. Click a line and the player jumps there. On long files it runs 10 to 16 times faster than Qwen3-ASR, the model it replaced, in 1.7 GiB instead of 16.5 GiB. It covers 25 European languages.

[![A transcript with one timed line per sentence; clicking a line moves the audio player (click for the MP4)](.github/media/transcript.webp)](.github/media/transcript.mp4)

#### Translate

Hy-MT2-1.8B-FP8 translates between 38 languages. Paste text and the translation follows as you type; the live preview covers the first 2,000 characters, and **Save** starts a job that translates the whole text and keeps it. Documents, transcripts and dropped text files translate into a new document in the same job, linked to the original.

### Create

#### Generate images

Describe a picture and get it back in seconds. Qwen-Image-2.1-Turbo makes an image in about 18 seconds at 1024 × 1024 and about a minute at 2K, with legible lettering. Seed and step controls sit under **Advanced** on the Text to image page. Every image and video lands in the Gallery, which shows the latest 200: filter them by generated or uploaded and by model, open one in a lightbox, or compare two side by side.

[![Typing a prompt, the progress view, the finished image, then the Gallery and its compare picker (click for the MP4)](.github/media/image.webp)](.github/media/image.mp4)

#### Make videos with sound

Describe a scene, and optionally its sound and music, and FastH3 makes a 5, 8 or 10 second video with its own sound track: Fast or Sharp, at 480p, 720p or 768p. Five seconds at 480p take about a minute. Start from an image by uploading one, or hand a generated image over with **Continue with → Create video**, which keeps the prompt that made it. Videos play on the job page and in the Gallery. The job page and the form say they are AI-generated, and each MP4 carries that line in its metadata, as the model's license asks. Videos and songs render one at a time: a second one shows *Waiting for the GPU* while the rest of the app keeps working ([Heavy jobs take turns](#heavy-jobs-take-turns)).

FastH3 is the 8-step distill of MiniMax's [MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3) made by [FastVideo](https://github.com/hao-ai-lab/FastVideo) at Hao AI Lab, and it runs in [ComfyUI](https://github.com/comfyanonymous/ComfyUI) by comfyanonymous and Comfy-Org. [drowzeys](https://github.com/drowzeys) built [keys-TensorFold Studio](https://github.com/drowzeys/keys-TensorFold-Studio-Mac-DGXSpark-64GB-VRam-Min), which runs FastH3 on Macs and the DGX Spark; Sparkfire adopted FastH3 after studying the Studio's Spark setup and measurements. Why each video setting is what it is: [Video: choices and trade-offs](#video-choices-and-trade-offs).

[![Typing a scene and its sound, the video waiting for the GPU behind one already rendering, then the finished video playing on the job page (click for the MP4)](.github/media/video.webp)](.github/media/video.mp4)

#### Make songs

Write lyrics, mark the parts with `[Verse]`, `[Chorus]` and `[Bridge]`, describe the style (genre, voice, instruments, tempo), and YuE2 sings it as a song with its own accompaniment: 48 kHz stereo, in English, Italian, Mandarin and other languages. It writes the song as an editable score first (melody and chords in ABC notation), and the score stays with the song. Hand the score back with **Continue with → Make a song** to sing the same melody in another style, or after editing a note. The lyrics can come from any text result too: a transcript, an OCR page, a translation. Once the model is loaded a song takes about as long as it plays, so a three-minute song takes three to four minutes; songs take turns with videos ([Heavy jobs take turns](#heavy-jobs-take-turns)).

YuE2's weights are non-commercial with a creator permission: you may publish and sell the songs you make, but a company needs a license from the authors ([model licenses](#model-licenses)). [YuE2](https://github.com/multimodal-art-projection/YuE) is made by the Multimodal Art Projection team (m-a-p).

### Ask and research

#### Chat with your files

Attach up to 8 images, PDFs, text or code files to a message with the + button, by dragging them in or by pasting. Choose how hard the model should think (Off, Low, Medium, High), and watch its reasoning before the answer. Documents are read as text, up to 60,000 characters each; images, and scanned PDFs as up to four page images, go to the model as pictures, which Saluki reads. Any finished job can also be opened in a conversation with **Ask in chat**. Answers run on the server, so leaving the page, switching conversations or reloading does not stop them: come back and the answer is still being written, or already saved. Restarting the server does stop an answer in progress.

[![Attaching the report, asking for its risks with Low thinking, the live reasoning and the answer (click for the MP4)](.github/media/chat.webp)](.github/media/chat.mp4)

#### Search the web from chat

Turn on **Web** in a conversation and the model can search the web and read pages before it answers, through a local [SearXNG](https://github.com/searxng/searxng). It takes up to six rounds of searches (five results each) and page reads, then answers with numbered sources; a foldable block lists what it searched and read. New conversations start with the switch on.

SearXNG runs with the stack on the Spark, and Saluki answers the tool calls. Searches reach the engines behind SearXNG, so turn the switch off in conversations that must stay local. Page reads refuse local and private network addresses. A workspace on another machine has no web search, because SearXNG listens only on the Spark. Details in [docs/fork.md](docs/fork.md#chat).

[![Turning Web on, asking a current question, the searches and pages as they run, then the answer with numbered sources (click for the MP4)](.github/media/websearch.webp)](.github/media/websearch.mp4)

#### Mind maps

Turn a typed topic, a document, a transcript or an image into an interactive map. Choose how deep it goes (3 to 6 levels) and how many branches each node gets (up to 3, 5 or 7), then fold and unfold its branches or expand them all. The map is also saved as JSON and as a Markdown outline.

[![A mind map of the report with branches being folded and unfolded (click for the MP4)](.github/media/mindmap.webp)](.github/media/mindmap.mp4)

#### Prompt presets

Run a saved instruction on a finished job's text. **Run a preset** on the job page sends it to the language model and saves the answer in the job as `summary.<preset>.md`. Sparkfire comes with Meeting minutes, Clean document and Executive summary; edit them or add your own in **Settings → Prompts**.

### Automate

#### Workflows

Connect the same modules in a node editor and run the result again on a new file. Inputs are typed by artifact kind. The nodes are **Select**, **If** and **Switch** branches, **Merge** (all or any), **Save to file**, **End** and **Fail**, plus a node for every module, video, music, LLM prompts and **Create chat** included. Enabled workflows appear on the Workbench and under **Continue with**. Definitions are JSON files, each workflow run keeps a snapshot of the workflow it ran, and the run view shows which nodes ran, were skipped or failed. A video or song node waits in the GPU lane like any heavy job, but its workflow run keeps one of the queue's workers while it waits ([Heavy jobs take turns](#heavy-jobs-take-turns)). See [Workflow design and JSON contracts](docs/workflows.md).

### Interface

Pick dark, light or system in **Settings → General**; the whole interface follows, at any screen width, with a tab bar on phones. The sidebar shows the AI services' status and a compact Spark monitor.

[![Switching the interface between dark and light in Settings (click for the MP4)](.github/media/theme.webp)](.github/media/theme.mp4)

* * *

## Quick start

You need:
- an NVIDIA DGX Spark (or another GB10 system) with its stock DGX OS, which includes Docker, the NVIDIA container runtime and CUDA 13;
- more than 200 GB of free disk for the model weights and service images (about 55 GB less without video);
- internet access for the first run.

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
# Builds the services, downloads the models at pinned revisions, starts everything in a memory-safe order
./scripts/start-dgx-spark.sh --accept-model-licenses
```

- The first run takes 30 to 60 minutes, mostly downloads; later runs reuse everything and take a few minutes.
- `--accept-model-licenses` confirms you have read the [model licenses](#model-licenses). FastH3, the video model, is not licensed in the EU, the UK, South Korea or the US: add `--video-backend none` there.
- The models are fixed: Saluki 27B, PaddleOCR-VL-1.6, Parakeet, Hy-MT2, Qwen-Image-2.1-Turbo, FastH3 and YuE2, with SearXNG for web search ([Models and memory](#models-and-memory)). There is nothing to choose.
- Open `http://<spark-host>:54321` from any device on your network.

| To | Run |
| --- | --- |
| See what is running | `./scripts/start-dgx-spark.sh status` |
| Stop everything (data and models are kept) | `./scripts/start-dgx-spark.sh stop` |
| Leave video out | run the start script again with `--video-backend none` |
| Update | `git pull`, then run the start script again with the same options |

### The chat model

Chat, mind maps and LLM prompts in workflows use [Underdog Saluki 27B](https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0), a 2-bit GGUF of Qwen3.8-27B with a vision add-on, in `llama-server` from [llama.cpp](https://github.com/ggml-org/llama.cpp): 13 GiB of GPU memory, 22 tokens a second, and it reads images and calls tools. The start script builds `llama-server` for the Spark's GPU, downloads Saluki and starts it first, on port 8331, with the flags its memory was measured with:

```bash
llama-server -m Underdog-Saluki-27B-1.0-IQ2-mix.gguf --mmproj mmproj-Underdog-Saluki-27B-1.0-F16.gguf \
  --jinja -ngl 99 -fa on -c 65536 --parallel 1 --host 0.0.0.0 --port 8331 --alias saluki-27b
```

Mind maps ask the model to answer without thinking, so Saluki's reasoning cannot use up their token budget; chat lets you choose the thinking level per message. Saluki's download is not pinned to a revision yet, unlike the other models.

### Other ways to run it

Sparkfire has two layers that can run apart: the **models** (the stack and its system monitor) and the **workspace** (the web app, its API, the Redis queue and your files).

| Setup | Models | Workspace | Start with |
| --- | --- | --- | --- |
| **All in one** | DGX Spark | the same Spark | the [quick start](#quick-start) |
| **Split** | DGX Spark | another server | `./scripts/start-dgx-spark.sh --models-only --accept-model-licenses` on the Spark, then `./scripts/start-sparkfire.sh --model-host <spark-host>` on the server |

With `./scripts/start-sparkfire.sh --configure-later`, the first visit asks where the stack runs: **Run models locally** or **Run models remotely** (it checks the stack's ports 8330–8339 on the Spark; video on 8337 is optional). Reopen it from **Settings → General → Deployment**; it keeps your jobs, chats, workflows and files. In split mode, keep the Spark's ports 8330–8339 behind a firewall, LAN or VPN.

Each release also publishes a multi-platform image, `ghcr.io/moviemaker93/sparkfire`, for your own Compose file. To build from source instead:

```bash
cp .env.example .env    # leave the URLs empty to set up in the browser
docker compose up -d --build
# with web search, after setting SEARXNG_SECRET in .env: docker compose -f compose.yaml -f compose.search.yaml up -d --build
```

The image includes `ffmpeg`, `ffprobe`, `pdftotext` and `pdftoppm`, for `linux/amd64` and `linux/arm64`. Every start points the services at the stack's models; the environment and setup only say where the stack runs. See [Application deployment and upgrades](docs/deployment.md) for network binding, backups and releases, and the [DGX Spark deployment guide](docs/dgx-spark.md) for what the start script does.

**Local development** needs Node.js 22.12 or newer (CI uses Node 24), Redis, ffmpeg and Poppler:

```bash
npm install
docker run -d --name sk-redis -p 6379:6379 redis:8-alpine   # once
node scripts/seed-dev-data.mjs                              # optional sample data in ./data
npm run dev                                                 # API on :54321, Vite on :5173 with hot reload
```

`npm run typecheck`, `npm test` and `npm run build` check the app; CI also runs the Python adapter tests, ShellCheck and the Docker builds. Set `WORKER_ENABLED=false` to keep seeded jobs as they are while you work on the interface.

### Upgrading

```bash
git pull
./scripts/start-dgx-spark.sh --accept-model-licenses   # with --video-backend none if you installed with it
```

The script rebuilds what changed and leaves `data/` alone. Every start points the services at the stack's models, so no setting needs changing after an upgrade, whatever was chosen before.

- **From the six-model stack or an earlier model set:** the start script removes the retired Qwen3.6 LLM, Qwen3-ASR, LocateAnything and Unlimited-OCR containers, and downloads the models the stack now uses. Earlier model files stay in `data/dgx-models` until you delete them; see [Upgrading from the six-model stack](docs/dgx-spark.md#upgrading-from-the-six-model-stack).
- **An install configured by hand:** the stack replaces services set up in Settings or with **Configure manually**, which is gone. A workspace that is not on the stack goes through setup in the browser again.
- **From an install made before the rename to Sparkfire:** point your checkout at this repository and run the start script again. It removes the old containers and starts the `sparkfire-` ones, reusing your jobs, settings and downloaded models; only `SPARKFIRE_*` variables in `.env` are read.

Set `HF_TOKEN` in the shell when a model download needs authentication or more download capacity: `HF_TOKEN=hf_... ./scripts/start-dgx-spark.sh --accept-model-licenses`.

* * *

## Models and memory

### The stack

Sparkfire's models are fixed: one per service, chosen and measured to share the Spark's memory, each in its own container behind an OpenAI-compatible API. Users do not pick models; every start points the app at these.

| Capability | Model | Port |
| --- | --- | --- |
| Chat, mind maps, LLM prompts | [Saluki 27B](#the-chat-model) in llama-server | 8331 |
| OCR | [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6), with page layout, in vLLM | 8332 |
| Speech recognition | [Parakeet-TDT-0.6B-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) in parakeet.cpp | 8333 |
| Translation | [Hy-MT2-1.8B-FP8](https://huggingface.co/tencent/Hy-MT2-1.8B-FP8) | 8334 |
| Image generation | [Qwen-Image-2.1-Turbo](https://huggingface.co/Qwen/Qwen-Image-2.1) in diffusers, non-commercial | 8336 |
| Video generation | [FastH3](https://huggingface.co/FastVideo/FastVideo-FastH3-Trim-Comfy), Fast and Sharp, in ComfyUI; `--video-backend none` leaves it out | 8337 |
| Music generation | [YuE2-3B](https://huggingface.co/m-a-p/YuE2-3B), non-commercial | 8339 |
| Web search for chat | SearXNG (bound to 127.0.0.1) | 8338 |
| System monitor | memory, GPU and service health in the sidebar | 8330 |

There is no grounding model, so visual grounding is not available. Details of each backend are in [docs/fork.md](docs/fork.md#model-backends), and measured results in [docs/validation.md](docs/validation.md).

### Memory and containers

The DGX Spark has about 121 GiB of usable unified memory, shared by the CPU and the GPU. The stack runs **12 Docker containers**, 11 without video; PaddleOCR-VL's vision model and layout stage run separately. A short-lived downloader container also runs during installation.

Measured on one Spark with every service loaded and idle. GPU is what the container allocates through CUDA; RAM is the container's own process memory.

| # | Container | What it runs | GPU | RAM | Total |
| --- | --- | --- | --- | --- | --- |
| 1 | `sparkfire-app-1` | Web app, API and job worker | — | 0.1 GiB | 0.1 GiB |
| 2 | `sparkfire-redis-1` | Job queue | — | < 0.1 GiB | < 0.1 GiB |
| 3 | `sparkfire-dgx-status` | System monitor | — | < 0.1 GiB | < 0.1 GiB |
| 4 | `sparkfire-image-generation` | Qwen-Image-2.1-Turbo or 2.1, float8 | 17.1 GiB | 1.9 GiB | **19.0 GiB** |
| 5 | `sparkfire-parakeet` | Parakeet-TDT-0.6B-v3 in parakeet.cpp (ggml on CUDA), behind a small adapter | 1.5 GiB | 0.2 GiB | **1.7 GiB** |
| 6 | `sparkfire-paddleocr-vlm` | PaddleOCR-VL-1.6 vision model in vLLM | 5.4 GiB | 3.6 GiB | **9.0 GiB** |
| 7 | `sparkfire-hy-mt2` | Hy-MT2-1.8B-FP8 translation | 2.4 GiB | 3.0 GiB | **5.4 GiB** |
| 8 | `sparkfire-paddleocr-vl` | PaddleOCR-VL layout stage (PP-DocLayoutV3, on the CPU) | — | 0.8 GiB | 0.8 GiB |
| 9 | `sparkfire-video-generation` | FastH3 in ComfyUI, behind a small adapter; nothing loaded until a job | 0.7 GiB | 0.1 GiB | **0.8 GiB** idle |
| 10 | `sparkfire-saluki` | Saluki 27B in llama-server, with its vision add-on and a 64k context | 13.0 GiB | 8.5 GiB, the memory-mapped model file, reclaimable | **13–21.5 GiB** |
| 11 | `sparkfire-music-generation` | YuE2-3B; nothing loaded until a song | — | — | about 0 idle |
| 12 | `sparkfire-searxng` | SearXNG | — | capped at 0.5 GiB | not measured |

Parakeet grows to 1.6–1.8 GiB of GPU memory and up to 1.5 GiB of RAM while it transcribes.

| State | Memory used |
| --- | --- |
| All services idle | about 29 GiB, plus Saluki's 13–21.5 GiB |
| Busy (two jobs at a time, the app's default) | about 38 GiB at peak |
| Starting up | about 39 GiB at peak, plus Saluki; a fresh start first checks that 64 GiB are free (`--skip-memory-check` to override) |
| A video job (on top of the above) | +35–39 GiB for Fast at 480p, +41–48 GiB for Fast at 720p or longer, +44–57 GiB for Sharp; the weights stay loaded until 10 minutes without a job |
| A song (on top of the above) | about +20 GiB at its peak, short or long; about 15 GiB stays loaded until 10 minutes without a song |

These are the measured figures from [docs/validation.md](docs/validation.md) minus the removed Qwen3.6 LLM (31 GiB) and LocateAnything (10.9 GiB); the Parakeet idle figure was measured on the full stack. The older 84–96 GiB figures in that file were measured with the Qwen3.6 LLM and Qwen3-ASR resident, before Sparkfire removed them.

Saluki's row was measured on its own next to the stack (docs/validation.md). Measured together with Saluki, the largest video job (Sharp, 1344 × 768, 10 s) brought the Spark to 106.6 of 121 GiB.

**Keep the queue at two workers** (**Settings → Processing → Concurrent jobs**, the default) on a Spark. The queue sets how many jobs run at once besides videos and songs, which have their own lane (below), and the app reads it only at start. A workflow run counts as one job for its whole run, video and song nodes included. Two is the safer setting: with a video running, two more jobs such as a large image can run beside it, and the video and the image set the memory peak. Jobs past the second wait their turn. Raising the number adds less memory than you might expect, because OCR and transcription use little beyond what their services already hold (vLLM reserves PaddleOCR-VL's memory at start, and Parakeet works through 30-second chunks). What it does add is GPU contention, which slows every running job. Chat answers do not go through the queue, so they run alongside whatever the queue holds with either setting.

### Heavy jobs take turns

Some jobs load tens of GiB only while they work: video (35–57 GiB per job) and music (about 20 GiB per song). Two of them side by side do not fit on a Spark next to the rest of the stack, so Sparkfire runs these **heavy jobs** one at a time, in the **GPU lane**:

- **One heavy job at a time, in order.** Ask for a second video while one renders and it shows *Waiting for the GPU* with what is running, then starts by itself. You can stop it while it waits.
- **Everything else keeps going.** Videos and songs started from their page or with **Continue with** wait on their own queue, so OCR, transcription, translation, images, mind maps and chat never queue behind them. They run more slowly while a video renders, because they share the GPU.
- **Workflows wait too, holding a worker.** A video or song node in a workflow waits in the same lane, but its workflow run keeps one of the two queue workers while it waits. Two such workflows at once hold back other jobs until their heavy nodes start.
- **Switching frees memory first.** A heavy service keeps its weights for a while after a job (10 minutes for both), so the next video or song starts warm. When the next heavy job belongs to the other module, a song after a video for example, Sparkfire first tells the previous service to free its weights, instead of loading on top of them.
- **Short of memory, it waits.** Before a job, the video and music services check that the Spark has the memory the job was measured to need: 50 GiB for a Fast video and 59 GiB for a Sharp one from cold, about 16 GiB when the same variant is already loaded, and 22 GiB for a song. When other jobs or something outside Sparkfire hold it, the job shows *Waiting for memory* and tries again until it fits, for up to 30 minutes, instead of running the Spark out of memory.

A song next to a busy stack (images, OCR, speech, translation and chat all working) fits with 39 GiB to spare, but takes about twice as long and slows the others; the measurements are in [docs/validation.md](docs/validation.md). Why the lane works this way: [ADR 0003](docs/adr/0003-heavy-gpu-lane.md).

## Video: choices and trade-offs

FastH3 shares one Spark with the other six models, so each video setting trades quality or speed against memory. Every number here was measured on the Spark, with Saluki loaded; the details are in [docs/validation.md](docs/validation.md) and the runtime decision in [ADR 0002](docs/adr/0002-video-service-comfyui.md).

| Choice | What Sparkfire uses | What it costs | Why |
| --- | --- | --- | --- |
| Model | FastH3, FastVideo's 8-step distill of MiniMax H3, video and sound from one model | Its license excludes the EU, the UK, South Korea and the US | Sound comes with the picture, in 8 steps, beside the rest of the stack. Wan 2.2 makes no sound; MOVA needs about 48 GB of GPU memory plus 67 GB of RAM and 9 s a step on an H100. LTX-2.5 (worldwide license, video with sound) is the candidate for a second backend |
| Runtime | A pinned ComfyUI behind a small adapter | One service on a runtime the others do not use; moving the pin needs a new measurement | No diffusers or transformers release loads FastH3 yet. keys-TensorFold Studio's native engine is faster per step for the int8 V2 model, but it builds outside a container and its setup held about 70 GB |
| Fast (default) | FastH3 Trim, NVFP4 (11.9 GB) | Less fine detail than Sharp | 58–69 s for 5 s at 480p, about 34 GiB while loaded. NVFP4 runs natively on the GB10's tensor cores; the fp8, int8 and bf16 Trim files are bigger |
| Sharp | FastH3 V2 pruned, int8 (22.1 GB) | About twice as slow; about 44 GiB while loaded and up to 57 GiB above idle | Visibly sharper frames on the same seed |
| Text encoder and decoders | Qwen3-VL-32B in NVFP4-AWQ (15.7 GB), int8 video decoder, fp32 audio decoder, shared by both variants | About 19 GB of the 53 GB download | The encoder is 27 GB in int8 and 51 GB in bf16 |
| Sizes | 864 × 480, 1280 × 736, 1344 × 768 | Landscape 16:9 only for now | These were measured; sizes are multiples of 32, so 720p is 1280 × 736 |
| Length | 5, 8 or 10 s at 24 fps (124, 192 or 243 frames) | No videos over 10 s yet, and no chained videos | FastH3 is trained on about 124–362 frames (5–15 s), in steps of 17. These three lengths were measured; 10 s takes 2.5 minutes with Fast at 480p and up to 9.5 minutes with Sharp at 768p, and peaks highest, so longer videos wait for their own measurement |
| Sampling | 8 steps, `res_multistep`, sigma shift 10 for video and 3 for audio, 10 % video sparse attention | No step or guidance controls in the form | Fixed by the distillation; FastVideo's model cards ask to keep the template's settings |
| Prompt | The form fills the model's own sections: the scene (`integrated_multimodal_description`, as `[Shot 1]`), `overall_soundscape` and `non_diegetic_music` | Multi-shot prompts have to be written in that format by hand | FastH3 was trained on sectioned prompts; a prompt already written that way is kept as is |
| First frame | Scaled to the chosen size with a centre crop | An image of another shape loses its edges | Keeps the size you picked. The prompt should describe the image, so a generated image hands over the prompt that made it |
| Memory | Weights load on the first job and unload after 10 idle minutes, or before switching variants | A cold job waits about 10 s longer; ComfyUI keeps about 5 GiB after unloading | Holding them would leave the Spark 34–44 GiB heavier between jobs |
| Concurrency | Videos take turns with songs in the [GPU lane](#heavy-jobs-take-turns), on their own queue | A second video waits for the first, shown as *Waiting for the GPU*; other jobs do not wait behind it, except behind a workflow whose video node is waiting | The largest job (Sharp, 1344 × 768, 10 s) brought the Spark to 106.6 of 121 GiB with Saluki loaded, leaving about 14 GiB for other jobs |
| Transfer | The MP4 streams to disk as the response body; the app waits up to an hour, and the service stops a render after 30 minutes | A long render keeps one connection open | The video never sits in memory as base64 |
| Repeats | ComfyUI caches identical requests | The same prompt, seed and settings give back the same video | It returns in about 2 s; change the seed under Advanced for a new take |
| Default install | Video is built and downloaded unless you pass `--video-backend none` | About 53 GB more disk and a longer first install | Video with sound is part of Sparkfire; the flag covers the excluded territories, and onboarding treats video as optional |
| Disclosure | Every MP4 carries "AI-generated with MiniMax H3 (FastH3)" in its metadata, and the app shows it | Re-encoding the file elsewhere can drop the tag | The license asks that shared outputs say they are machine-generated |
| Container cap | 56 GiB | It bounds CPU-side memory only | GPU allocations are not charged to a container's limit on the Spark |

Per job, the form sets Fast or Sharp, the size, the length, the sound, the music and the seed. For the whole service:

| Setting | Default | Where |
| --- | --- | --- |
| `--video-backend` | `fasth3` | `scripts/start-dgx-spark.sh`; `none` leaves video out |
| `VIDEO_IDLE_UNLOAD_SECONDS` | `600` | Environment of `start-dgx-spark.sh` (compose) |
| `VIDEO_MEM_LIMIT` | `56g` | Environment of `start-dgx-spark.sh` (compose) |

* * *

## Configuration

**Settings** has four tabs (General, Services, Processing, Prompts), saved in `data/config/settings.json`. The services are not set there:

- **Services.** Settings → Services shows each service of the stack, its fixed model and where it runs, with a connection test. Every start points them at the stack's models, and a save from Settings cannot change them. To move the stack to another Spark, run setup again from **General → Deployment**.
- **General.** Appearance (dark, light or system); the time zone for conversation times, job and conversation folder names and the date given to web search; and **Deployment**, which runs setup again to say where the stack runs.
- **Language model.** Saluki takes text and images and answers tool calls, so chat, mind maps and workflow LLM nodes can pass pictures and scanned PDF pages, and chat offers web search.
- **Web search.** The stack's SearXNG, run by `compose.search.yaml` with the settings in `services/searxng/`, which the app reaches as `http://searxng:8080`.
- **Processing.** A transcription profile (Balanced, Low-memory, High-throughput or Custom) sets the processing window, its overlap, the maximum output tokens, the speech request timeout and adaptive recovery. Below it are the number of concurrent jobs, read at start, and recovery attempts. PDF pages are rasterised at 175 DPI; change `pdf.dpi` in `settings.json` for another resolution.
- **Prompts.** The presets that **Run a preset** offers on a finished job: a name, a system prompt, a user template with `{{text}}`, and limits.
- **Uploads.** Up to 8 GiB per file and 100 files at a time.
- **System monitor.** The DGX start script runs a small read-only service that shows unified memory, CUDA allocations, GPU use and temperature in the sidebar.

## How it works

Sparkfire is a TypeScript modular monolith: one Node.js process serves the React client, the Express API and the BullMQ worker.

```text
React client
    │
    ▼
Express API ───────────► model services (OpenAI-compatible HTTP)
    │
    ├── BullMQ / Redis       execution coordination
    │
    └── data/                durable source of truth
          ├── settings and workflow definitions
          ├── jobs, artifacts, and workflow snapshots
          └── conversations, their attachments and answers
```

- A **module** is a capability you use: OCR, transcription, translation, text to image, text to video, text to music, mind map, chat.
- A **service** is the model behind it, one fixed model per service in the stack.
- A **job** is a folder holding sources, artifacts and runs; a **run** is one pass of a module over the job's artifacts.
- An **artifact** is a typed file with a stable identity and lineage, which is what lets one result feed the next (**Continue with**).
- A **workflow run** is one execution of a workflow on a job, with its own progress, cancellation, outputs and errors, and a snapshot of the workflow it ran.
- **Heavy jobs** take turns in the **GPU lane**.

The terms are defined in [GLOSSARY.md](GLOSSARY.md). Redis can be restarted or rebuilt without touching the record on disk, and unfinished jobs and workflow runs are queued again at start. Job manifests are written atomically (write, then rename), one change at a time per job. Read [Architecture](docs/architecture.md) and the [modular-monolith ADR](docs/adr/0001-modular-monolith.md) before adding a module or changing storage contracts.

```text
data/
├── config/
│   ├── settings.json
│   ├── secrets.json
│   ├── prompts/*.json
│   └── workflows/*.json
├── jobs/<job-id>/
│   ├── job.json
│   ├── flows/*.json      workflow runs and their snapshots
│   ├── input/
│   ├── work/             checkpoints, caches and thumbnails
│   └── output/
├── chats/<chat-id>/
│   ├── chat.json
│   └── attachments/
├── tmp/                  uploads before they are filed
├── searxng/              SearXNG's secret
├── dgx-models/           model weights, with the DGX stack
└── logs/
```

Back up `data/` (the weights in `dgx-models/` can be downloaded again) to keep configuration, history, sources, conversations and results. Redis is operational state, not the record.

| Area | Endpoints |
| --- | --- |
| Health and configuration | `GET /api/health`, `GET/PUT /api/settings`, `POST /api/setup/stack`, `GET /api/modules`, `GET /api/system/status` |
| Search | `GET /api/search` |
| Jobs | `GET/POST /api/jobs`, rename and delete routes, cancellation, server-sent progress at `/api/jobs/:id/events` |
| Artifacts and runs | `GET /api/jobs/:id/artifacts`, `GET/POST /api/jobs/:id/runs`, `GET /api/jobs/:id/thumbnails/:artifactId` |
| Gallery | `GET /api/gallery` |
| Translation | preview, pasted-text and uploaded-document routes under `/api/modules/translation` |
| Grounding | `POST /api/modules/grounding/jobs` |
| Image generation | `GET /api/modules/text-to-image/capabilities`, `POST /api/modules/text-to-image/jobs` |
| Video generation | `GET /api/modules/text-to-video/capabilities`, `POST /api/modules/text-to-video/jobs` |
| Music generation | `GET /api/modules/text-to-music/capabilities`, `POST /api/modules/text-to-music/jobs` |
| Mind map | `POST /api/modules/mindmap/jobs` |
| Chat | chat CRUD, attachments, streaming messages, `GET /api/chats/:id/stream` to rejoin an answer, `POST /api/chats/:id/stop` |
| Web search | `POST /api/web-search/test` |
| Workflows | definition CRUD and validation, and durable flow runs, under `/api/workflows` |

Request contracts are in `src/server/index.ts` and [docs/fork.md](docs/fork.md).

## Security and privacy

Sparkfire assumes a trusted user on a trusted network. It has no built-in authentication and no multi-tenant isolation. Do not expose it to the public internet; put it behind an authenticated reverse proxy, a VPN or equivalent access control.

Uploaded content goes to the stack's services on your Spark, so a deployment is as private as the Spark and the network around it. With web search on in a conversation, which new conversations start with, the model's search queries go to the engines behind SearXNG and the pages it reads are fetched from the server; page reads never reach private network addresses.

Grounding overlays are previews, not redaction. A rectangle drawn over an image or over selectable PDF text does not remove what is underneath.

## What Sparkfire changes

Sparkfire started as a fork of SparklingKit 0.1.5 and is now its own project. Compared with upstream:

| Area | What you get |
| --- | --- |
| **Interface** | Light, dark and system themes in warm charcoal and paper with an ember accent, Geist and Bricolage Grotesque type; one AI-services chip and a compact Spark monitor; a "Running now" strip and readable titles on the Workbench; tools whose service is not configured stay out of the way |
| **Gallery** | Every image and generated video with thumbnails, filters by source and model, a lightbox and a side-by-side compare |
| **Job pages** | Transcript lines, one per sentence, that seek the player; image zoom with a before/after slider, a document outline, and run history |
| **Chat** | Attach images, PDFs and text files; a thinking control with the reasoning shown live; answers that keep going when you leave the page; web search with cited sources |
| **Models** | A fixed stack: Saluki 27B for chat, PaddleOCR-VL-1.6 for OCR, Parakeet-TDT-0.6B-v3 for speech, Qwen-Image-2.1-Turbo for images, FastH3 for video with sound, YuE2 for songs; seed and step controls. No grounding model |
| **Operations** | One-command install; long model calls no longer cut off after 300 seconds |
| **Quality** | CI, CodeQL, dependency, secret and container scanning, Dependabot, and releases from Conventional Commits |

Details in [docs/fork.md](docs/fork.md), measured results in [docs/validation.md](docs/validation.md), next steps in the [roadmap](docs/fork.md#roadmap), and instructions for coding agents in [AGENTS.md](AGENTS.md).

## Contributing

Issues and pull requests are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) explains how to set up, test and submit a change. In short: open an issue before a larger change, keep the model stack fixed, run `npm run typecheck`, `npm test` and `npm run build`, and title the pull request as a [Conventional Commit](https://www.conventionalcommits.org/). Coding agents, and humans who like a map, start from [AGENTS.md](AGENTS.md). The project is pre-1.0, so APIs and stored schemas may still change.

## License

Sparkfire is licensed under the [Apache License 2.0](LICENSE). It is a derivative of [SparklingKit](https://github.com/stevibe/SparklingKit), copyright 2026 Steven Lei, also Apache 2.0; its [NOTICE](NOTICE) is kept. Changes since the fork are recorded in the commit history and summarised in [docs/fork.md](docs/fork.md). "SparklingKit" is the upstream project's name, used here only to say where the code comes from.

Third-party packages and model services remain subject to their respective license terms.

Sparkfire changes copyright 2026 MovieMaker93.

### Model licenses

Model weights are not part of this repository. The start script downloads them after you accept their terms; the acceptance flag records that you reviewed them and does not change them. OCR, speech and translation can be used anywhere, commercially too. Underdog Saluki 27B, the chat model, is ConwayResearch's model built on Qwen3.8-27B; review its model card for its terms. Parakeet-TDT-0.6B-v3 is NVIDIA's and uses CC BY 4.0, which allows commercial use with credit (see the acknowledgements); parakeet.cpp, which runs it, is MIT.

Three models have narrower terms. Qwen-Image-2.1-Turbo, the image model, uses the Qwen Research License (non-commercial). FastH3, the video model, is a distill of MiniMax H3 under the [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE): it grants use only "worldwide, excluding" the European Union, the United Kingdom, South Korea and the United States, asks that shared outputs be disclosed as machine-generated, and asks commercial products to display "MiniMax H3". [ComfyUI](https://github.com/comfyanonymous/ComfyUI), which runs FastH3, is GPL-3.0; it is fetched at a pinned commit when the video image is built, runs as its own process, and is not part of this repository. Start the stack with `--video-backend none` where FastH3's license does not apply.

YuE2, the music model, has its code under Apache 2.0 and its weights under [CC BY-NC 4.0 with a creator permission](https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE): personal users and creators may publish and monetize the songs they make, academic use is non-commercial, and companies need a commercial license from m-a-p. Each song in Sparkfire shows that line.

[SearXNG](https://github.com/searxng/searxng), which runs web search, is AGPL-3.0. Like ComfyUI, it runs from its own pinned image as a separate service and is not part of this repository.

## Acknowledgements

- [SparklingKit](https://github.com/stevibe/SparklingKit) by Steven Lei, the project Sparkfire is built on.
- The model teams whose open weights do the work: Qwen ([Qwen-Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1)), PaddlePaddle ([PaddleOCR-VL](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)), Tencent ([Hy-MT2](https://huggingface.co/tencent/Hy-MT2-1.8B-FP8)), NVIDIA ([Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), MiniMax ([MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3), whose text encoder uses Qwen's Qwen3-VL-32B weights), the Multimodal Art Projection team ([YuE2](https://github.com/multimodal-art-projection/YuE), which writes and sings the songs), and [FastVideo](https://github.com/hao-ai-lab/FastVideo) at Hao AI Lab, whose [FastH3 Trim](https://huggingface.co/FastVideo/FastVideo-FastH3-Trim-Comfy) and [FastH3 V2](https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy) distills and workflow templates make the videos.
- The chat model: [Underdog Saluki 27B](https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0) by ConwayResearch.
- The serving and tooling stack: [parakeet.cpp](https://github.com/mudler/parakeet.cpp) by mudler (MIT), which runs Parakeet from its [GGUF files](https://huggingface.co/mudler/parakeet-cpp-gguf), [vLLM](https://github.com/vllm-project/vllm), [llama.cpp](https://github.com/ggml-org/llama.cpp), [diffusers](https://github.com/huggingface/diffusers), [ComfyUI](https://github.com/comfyanonymous/ComfyUI) by comfyanonymous and Comfy-Org (GPL-3.0), which runs FastH3 with Comfy-Org's [comfy-kitchen](https://pypi.org/project/comfy-kitchen/) kernels, [PyAV](https://github.com/PyAV-Org/PyAV), which writes the disclosure into each video, [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), React, Express, BullMQ, Vite, and [Playwright](https://playwright.dev), which records the README clips.
- Web search: [SearXNG](https://github.com/searxng/searxng) (AGPL-3.0), which queries the search engines, and Mozilla's [Readability](https://github.com/mozilla/readability) with [linkedom](https://github.com/WebReflection/linkedom) by Andrea Giammarchi (WebReflection), which pull the main text out of the pages chat reads.
- The demo transcript reads from [LibriSpeech](https://www.openslr.org/12) (CC BY 4.0); the demo report is fictional.
- The README layout follows the one [MiaAI-Lab](https://github.com/MiaAI-Lab) wrote for [sparkDash](https://github.com/MiaAI-Lab/sparkDash).
- [drowzeys](https://github.com/drowzeys) built [keys-TensorFold Studio](https://github.com/drowzeys/keys-TensorFold-Studio-Mac-DGXSpark-64GB-VRam-Min), which runs FastH3 on Macs and the DGX Spark. Sparkfire adopted FastH3 after studying the Studio's Spark setup, and measured its own service against the Studio's published Spark numbers; no code was copied from it.
