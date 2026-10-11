# Sparkfire 🔥 — a local AI workspace for one DGX Spark

[![CI](https://github.com/MovieMaker93/Sparkfire/actions/workflows/ci.yml/badge.svg)](https://github.com/MovieMaker93/Sparkfire/actions/workflows/ci.yml)
[![Security](https://github.com/MovieMaker93/Sparkfire/actions/workflows/security.yml/badge.svg)](https://github.com/MovieMaker93/Sparkfire/actions/workflows/security.yml)
[![Platform](https://img.shields.io/badge/platform-DGX%20Spark%20%C2%B7%20ARM64-76b900?style=flat-square)](#quick-start)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square)](https://react.dev)
[![Express](https://img.shields.io/badge/Express-5-444444?style=flat-square)](https://expressjs.com)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)

**Sparkfire turns files into reusable AI work: it reads documents, transcribes recordings, translates, finds things in images, generates pictures, maps ideas and lets you chat about all of it, on models that run on your own DGX Spark.**

Every source and every result stays an ordinary file with its history, so one result can feed the next: a scanned PDF becomes Markdown, then a summary, a mind map or a conversation. Seven specialised models share one Spark behind one interface, and nothing leaves your network.

> [!NOTE]
> Based on [SparklingKit](https://github.com/stevibe/SparklingKit) by Steven Lei (Apache 2.0). Sparkfire is maintained by [MovieMaker93](https://github.com/MovieMaker93) and is not affiliated with or endorsed by the SparklingKit project. See [what Sparkfire adds](#what-sparkfire-adds).

[![A 40-second tour of Sparkfire running real models on a DGX Spark: the workbench, OCR, image generation, the gallery, chat, grounding and a mind map (click for the MP4)](.github/media/tour.webp)](.github/media/tour.mp4)

[Watch the tour as MP4](.github/media/tour.mp4) · recorded on one DGX Spark with the real models; only the waits are fast-forwarded.

* * *

## Contents

- [What Sparkfire adds](#what-sparkfire-adds)
- [Feature tour](#feature-tour)
- [Quick start](#quick-start)
- [Memory and containers](#memory-and-containers) · [Video: choices and trade-offs](#video-choices-and-trade-offs)
- [Why Sparkfire?](#why-sparkfire) · [One DGX Spark, five bundled models](#one-dgx-spark-five-bundled-models) · [Choose your deployment](#choose-your-deployment)
- [Modules](#modules) · [Workbench](#workbench) · [File-based workflows](#file-based-workflows)
- [Architecture](#architecture) · [API overview](#api-overview) · [Security and privacy](#security-and-privacy)
- [Contributing](#contributing) · [License](#license) · [Acknowledgements](#acknowledgements)

* * *

## What Sparkfire adds

Sparkfire started as a fork of SparklingKit and has since become its own project. Compared with upstream:

| Area | What you get |
| --- | --- |
| **Interface** | Light, dark and system themes; a mint accent; one AI-services chip and a compact Spark monitor; a "Running now" strip and readable titles on the Workbench |
| **Gallery** | Every image and generated video with thumbnails, filters by source and model, a lightbox and a side-by-side compare |
| **Job pages** | Transcript lines, one per sentence, that seek the player; image zoom with a before/after slider, a document outline, and run history |
| **Chat** | Attach images, PDFs and text files; a thinking control (Off, Low, Medium, High) with the reasoning shown live |
| **Models** | Parakeet-TDT-0.6B-v3 for speech; PaddleOCR-VL-1.6 for OCR; Qwen-Image 2.1 and Qwen-Image-2.1-Turbo for images; FastH3 for video with sound; seed and step controls |
| **Operations** | One-command install; `spark-switch.sh` to share the Spark with another LLM; long model calls no longer cut off after 300 seconds |
| **Quality** | CI, CodeQL, dependency, secret and container scanning, Dependabot, and releases from Conventional Commits |

Details in [docs/fork.md](docs/fork.md), measured results in [docs/validation.md](docs/validation.md), next steps in the [roadmap](docs/fork.md#roadmap), and instructions for coding agents in [AGENTS.md](AGENTS.md).

* * *

## Feature tour

Each clip is the real app on a DGX Spark with demo files. Only the time spent waiting for a model is fast-forwarded. Click a clip for the full-quality MP4.

### The Workbench

Start anything from one page: drop files, translate text, describe an image or ask the model. Jobs that are running show live progress at the top, and recent work keeps readable names and thumbnails.

[![The Workbench with three jobs running and recent work below (click for the MP4)](.github/media/workbench.webp)](.github/media/workbench.mp4)

### Read documents (OCR)

PaddleOCR-VL-1.6 turns PDFs and scans into Markdown, keeping headings, tables and reading order, and saves the page layout next to it. Long documents get an outline to jump through; the source view shows exactly what the model produced.

[![A three-page report recognised into Markdown: jumping through the outline, then the Markdown source (click for the MP4)](.github/media/ocr.webp)](.github/media/ocr.mp4)

### Transcribe recordings

Parakeet-TDT-0.6B-v3 turns audio and video into a transcript with one line per sentence, and into subtitles (SRT and WebVTT) cut to a readable size from its word timestamps. Click a line and the player jumps there. On long files it runs 10 to 16 times faster than Qwen3-ASR did, and it needs 1.7 GiB instead of 16.5 GiB. It covers 25 European languages.

[![A transcript with one timed line per sentence; clicking a line moves the audio player (click for the MP4)](.github/media/transcript.webp)](.github/media/transcript.mp4)

### Generate images

Describe a picture and Qwen-Image-2.1-Turbo draws it in about 18 seconds at 1024 × 1024, or a minute at 2K. Every image lands in the Gallery, where you can filter by model and compare two side by side.

[![Typing a prompt, the progress view, the finished image, then the Gallery and its compare picker (click for the MP4)](.github/media/image.webp)](.github/media/image.mp4)

### Make videos with sound

Describe a scene, and optionally how it sounds, and FastH3 makes a 5, 8 or 10 second video with its own sound track: Fast or Sharp, at 480p, 720p or 768p. Start from an image by uploading one, or hand a generated image over with **Continue with → Create video**, which keeps its prompt. Videos play on the job page and in the Gallery, and each one is labelled as AI-generated, as the model's license asks.

FastH3 is the 8-step distill of MiniMax's [MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3) made by [FastVideo](https://github.com/hao-ai-lab/FastVideo) at Hao AI Lab, and it runs in [ComfyUI](https://github.com/comfyanonymous/ComfyUI) by comfyanonymous and Comfy-Org. [drowzeys](https://github.com/drowzeys) built [keys-TensorFold Studio](https://github.com/drowzeys/keys-TensorFold-Studio-Mac-DGXSpark-64GB-VRam-Min), which runs FastH3 on Macs and the DGX Spark; Sparkfire adopted FastH3 after studying the Studio's Spark setup and measurements. Why each video setting is what it is: [Video: choices and trade-offs](#video-choices-and-trade-offs).

### Find things in images

Visual grounding boxes every match for anything you can name, with a slider between the original and the result. It needs a grounding endpoint: the tool stays hidden until you enable one in Settings → Services (Sparkfire was tested with LocateAnything-3B).

[![Wind turbines and a lighthouse boxed in a photo, with the before/after slider moving across (click for the MP4)](.github/media/grounding.webp)](.github/media/grounding.mp4)

### Chat with your files

Attach images, PDFs or text files with the + button, choose how hard the model should think, and watch its reasoning before the answer. Any finished job can also be opened in a chat.

[![Attaching the report, asking for its risks with Low thinking, the live reasoning and the answer (click for the MP4)](.github/media/chat.webp)](.github/media/chat.mp4)

### Mind maps

Turn a document, transcript or image into an interactive map, then fold and unfold its branches. The map is also saved as JSON and as a Markdown outline.

[![A mind map of the report with branches being folded and unfolded (click for the MP4)](.github/media/mindmap.webp)](.github/media/mindmap.mp4)

### Dark, light or system

Pick a theme in Settings; the whole interface follows, in both themes and on any screen width.

[![Switching the interface between dark and light in Settings (click for the MP4)](.github/media/theme.webp)](.github/media/theme.mp4)

* * *

## Quick start

You need:
- an NVIDIA DGX Spark (or another GB10 system) with its stock DGX OS, which includes Docker, the NVIDIA container runtime and CUDA 13;
- about 135 GB of free disk for the model weights and service images (about 190 GB with video);
- internet access for the first run.

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
# Builds the services, downloads the models at pinned revisions, starts everything in a memory-safe order
./scripts/start-dgx-spark.sh --ocr-backend paddleocr-vl --accept-model-licenses
```

- The first run takes 30 to 60 minutes, mostly downloads; later runs reuse everything and take a few minutes.
- `--accept-model-licenses` confirms you have read the [model licenses](#model-licenses). The default models can be used anywhere.
- Add `--image-backend qwen-image-2.1-turbo` for Qwen-Image (non-commercial use only) and `--video-backend fasth3` for video with sound (its license does not cover the EU, the UK, South Korea or the US).
- Open `http://<spark-host>:54321` from any device on your network.

| To | Run |
| --- | --- |
| See what is running | `./scripts/start-dgx-spark.sh status` |
| Stop everything (data and models are kept) | `./scripts/start-dgx-spark.sh stop` |
| Switch a model | run the start script again with another `--image-backend` or `--ocr-backend`, or with `--video-backend fasth3` to add video |
| Use Unlimited-OCR instead of PaddleOCR-VL | leave out `--ocr-backend` |
| Update | `git pull`, then run the start script again |
| Share the Spark with another LLM | `./scripts/spark-switch.sh sparkfire` and `./scripts/spark-switch.sh llm` (see [docs/fork.md](docs/fork.md#sharing-the-spark-with-another-llm)) |
| Run only the app against models you already host | `cp .env.example .env`, set the endpoint URLs, then `docker compose up -d --build` |

**Updating an install that used Qwen3-ASR?** Run the start script again, then choose `Parakeet-TDT-0.6B-v3` under Settings → Services → Speech to text. Saved settings are never rewritten. Until you change it, transcription still works, with minute-long lines instead of sentences.

**Coming from SparklingKit or the MovieMaker93/SparklingKit fork?** Point your checkout at this repository and run the start script again; jobs, settings, models and containers are reused as they are. The old `SPARKLINGKIT_*` variables in `.env` still work. Video is now opt-in, so add `--video-backend fasth3` if you used it.

## Memory and containers

The DGX Spark has about 121 GiB of usable unified memory, shared by the CPU and the GPU. The stack runs **8 Docker containers**, or **9** with PaddleOCR-VL, whose vision model and layout stage run separately. A short-lived downloader container also runs during installation.

Measured on one Spark with every service loaded and idle. GPU is what the container allocates through CUDA; RAM is the container's own process memory.

| # | Container | What it runs | GPU | RAM | Total |
| --- | --- | --- | --- | --- | --- |
| 1 | `sparklingkit-app-1` | Web app, API and job worker | — | 0.1 GiB | 0.1 GiB |
| 2 | `sparklingkit-redis-1` | Job queue | — | < 0.1 GiB | < 0.1 GiB |
| 3 | `sparklingkit-dgx-status` | System monitor | — | < 0.1 GiB | < 0.1 GiB |
| 4 | `sparklingkit-image-generation` | Qwen-Image-2.1-Turbo or 2.1, float8 | 17.1 GiB | 1.9 GiB | **19.0 GiB** |
| 5 | `sparklingkit-parakeet` | Parakeet-TDT-0.6B-v3 in parakeet.cpp (ggml on CUDA), behind a small adapter | 1.5 GiB | 0.2 GiB | **1.7 GiB** |
| 6 | `sparklingkit-paddleocr-vlm` | PaddleOCR-VL-1.6 vision model in vLLM | 5.4 GiB | 3.6 GiB | **9.0 GiB** |
| 7 | `sparklingkit-hy-mt2` | Hy-MT2-1.8B-FP8 translation | 2.4 GiB | 3.0 GiB | **5.4 GiB** |
| 8 | `sparklingkit-paddleocr-vl` | PaddleOCR-VL layout stage (PP-DocLayoutV3, on the CPU) | — | 0.8 GiB | 0.8 GiB |
| 9 | `sparklingkit-video-generation` | FastH3 in ComfyUI, behind a small adapter; nothing loaded until a job | 0.7 GiB | 0.1 GiB | **0.8 GiB** idle |

The stack ships no LLM and no grounding service (chat, mind maps and summaries use any
OpenAI-compatible endpoint, and visual grounding activates when a grounding endpoint is configured —
both in **Settings → Services**; see `docs/fork.md` for the Saluki and LocateAnything reference setups).
Every row is measured. Parakeet grows to 1.6–1.8 GiB of GPU memory and up to 1.5 GiB of RAM while it transcribes.

The alternatives change single rows:

| Instead of | You run | Memory |
| --- | --- | --- |
| Rows 6 and 8 | `sparklingkit-unlimited-ocr` (Unlimited-OCR in vLLM, upstream's default) | Not measured. vLLM may reserve up to 12% of memory (about 15 GiB). |
| Row 4's model | Z-Image-Turbo (upstream's default) | Not measured; the container is capped at 26 GiB. |

| State | Memory used |
| --- | --- |
| All services idle | about 29 GiB |
| Busy (two jobs at a time, the app's default) | about 38 GiB at peak |
| Starting up | about 39 GiB at peak |
| A video job (on top of the above) | +35–39 GiB for Fast at 480p, +41–48 GiB for Fast at 720p or longer, +44–57 GiB for Sharp; the weights stay loaded until 10 minutes without a job |

These are the measured figures from [docs/validation.md](docs/validation.md) minus the removed Qwen3.6
LLM (31 GiB) and LocateAnything (10.9 GiB); the Parakeet idle figure was measured on the full stack.

The historical 84–96 GiB figures in [docs/validation.md](docs/validation.md) were measured with the
Qwen3.6 LLM and Qwen3-ASR resident, before Sparkfire removed them.

That leaves about 90 GiB for an LLM of your choice (Saluki needs ~13 GiB), a grounding server if you run
one, the system, and headroom under load. Measured together with Saluki, the largest video job (Sharp,
1344 × 768, 10 s) brought the Spark to 106.6 of 121 GiB. Full measurements are in [docs/validation.md](docs/validation.md).

## Video: choices and trade-offs

FastH3 shares one Spark with four other models and your LLM, so each video setting trades quality or speed
against memory. Every number here was measured on the Spark, with Saluki loaded; the details are in
[docs/validation.md](docs/validation.md) and the runtime decision in
[ADR 0002](docs/adr/0002-video-service-comfyui.md).

| Choice | What Sparkfire uses | What it costs | Why |
| --- | --- | --- | --- |
| Model | FastH3, FastVideo's 8-step distill of MiniMax H3, video and sound from one model | Its license excludes the EU, the UK, South Korea and the US | Sound comes with the picture, in 8 steps, beside the rest of the stack. Wan 2.2 makes no sound; MOVA needs about 48 GB of GPU memory plus 67 GB of RAM and 9 s a step on an H100. LTX-2.5 (worldwide license, video with sound) is the candidate for a second backend |
| Runtime | A pinned ComfyUI behind a small adapter | One service on a runtime the others do not use; moving the pin needs a new measurement | No diffusers or transformers release loads FastH3 yet. keys-TensorFold Studio's native engine is faster per step for the int8 V2 model, but it builds outside a container and its setup held about 70 GB |
| Fast (default) | FastH3 Trim, NVFP4 (11.9 GB) | Less fine detail than Sharp | 58–69 s for 5 s at 480p, about 34 GiB while loaded. NVFP4 runs natively on the GB10's tensor cores; the fp8, int8 and bf16 Trim files are bigger |
| Sharp | FastH3 V2 pruned, int8 (22.1 GB) | About twice as slow; about 44 GiB while loaded and up to 57 GiB above idle | Visibly sharper frames on the same seed |
| Text encoder and decoders | Qwen3-VL-32B in NVFP4-AWQ (15.7 GB), int8 video decoder, fp32 audio decoder, shared by both variants | About 19 GB of the 53 GB download | The encoder is 27 GB in int8 and 51 GB in bf16 |
| Sizes | 864 × 480, 1280 × 736, 1344 × 768 | Landscape 16:9 only for now | These were measured; sizes are multiples of 32, so 720p is 1280 × 736 |
| Length | 5, 8 or 10 s at 24 fps (124, 192 or 243 frames) | No clips over 10 s yet, and no chained clips | FastH3 is trained on about 124–362 frames (5–15 s), in steps of 17. These three lengths were measured; 10 s takes 2.5 minutes with Fast at 480p and up to 9.5 minutes with Sharp at 768p, and peaks highest, so longer clips wait for their own measurement |
| Sampling | 8 steps, `res_multistep`, sigma shift 10 for video and 3 for audio, 10 % video sparse attention | No step or guidance controls in the form | Fixed by the distillation; FastVideo's model cards ask to keep the template's settings |
| Prompt | The form fills the model's own sections: scene, `overall_soundscape`, `non_diegetic_music` | Multi-shot prompts have to be written in that format by hand | FastH3 was trained on sectioned prompts; a prompt already written that way is kept as is |
| First frame | Scaled to the chosen size with a centre crop | An image of another shape loses its edges | Keeps the size you picked. The prompt should describe the image, so a generated image hands over the prompt that made it |
| Memory | Weights load on the first job and unload after 10 idle minutes, or before switching variants | A cold job waits about 10 s longer; ComfyUI keeps about 5 GiB after unloading | Holding them would leave the Spark 34–44 GiB heavier between jobs |
| Concurrency | No extra queue rule; the service renders one video at a time | A second video waits for the first | The largest job (Sharp, 1344 × 768, 10 s) brought the Spark to 106.6 of 121 GiB with Saluki loaded, leaving about 14 GiB for other jobs |
| Transfer | The MP4 streams to disk as the response body; a request may take up to an hour | A long render keeps one connection open | The video never sits in memory as base64 |
| Repeats | ComfyUI caches identical requests | The same prompt, seed and settings give back the same video | It returns in about 2 s; change the seed under Advanced for a new take |
| Default install | Video is left out unless you pass `--video-backend fasth3` | One flag to add it | Its license excludes the EU, the UK, South Korea and the US, so a default install stays usable everywhere; the flag adds about 53 GB of downloads, and onboarding treats video as optional |
| Disclosure | Every MP4 carries "AI-generated with MiniMax H3 (FastH3)" in its metadata, and the app shows it | Re-encoding the file elsewhere can drop the tag | The license asks that shared outputs say they are machine-generated |
| Container cap | 56 GiB | It bounds CPU-side memory only | GPU allocations are not charged to a container's limit on the Spark |

Per job, the form sets Fast or Sharp, the size, the length and the seed. For the whole service:

| Setting | Default | Where |
| --- | --- | --- |
| `--video-backend` | `none` | `scripts/start-dgx-spark.sh`; `fasth3` adds video |
| `VIDEO_IDLE_UNLOAD_SECONDS` | `600` | Environment of `start-dgx-spark.sh` (compose) |
| `VIDEO_MEM_LIMIT` | `56g` | Environment of `start-dgx-spark.sh` (compose) |

* * *

## Why Sparkfire?

AI work rarely ends after one operation. After recording a meeting, you may want to transcribe it, turn the transcript into a concise summary, and then chat with the result to revisit a decision or find an action item. When a large scanned PDF arrives, you may need to extract it into readable text before summarizing, translating, or asking questions about it. Sparkfire keeps these steps connected instead of treating each one as an isolated task.

The same applies to images: generate one from a prompt, pass it directly into visual grounding, and search for a person, object, text region, or other detail inside it. Every source and generated result remains a typed artifact with its files, lineage, and processing history, so you can always see where it came from and choose a compatible **Continue with** action.

Sparkfire is built around small, atomic capabilities—OCR, transcription, translation, grounding, image generation, mind mapping, and language-model reasoning—that can be combined without coupling the underlying services. A document, set of notes, or image can become an interactive mind map with collapsible branches, while its portable JSON and Markdown outline remain available to other tools. For repeatable work, the node-based workflow editor lets you connect those same capabilities with typed inputs, conditions, branches, merges, and explicit file outputs. Design the flow once, then run it again with a new recording, document, image, or piece of text.

For workloads involving recorded meetings, private documents, scanned PDFs, and personal images, we strongly recommend running models locally whenever suitable hardware is available. Local inference keeps sensitive material on infrastructure you control, avoids repeatedly uploading large files, and gives you direct ownership of model selection, capacity, availability, and data retention. Sparkfire is designed local-first: source files, generated artifacts, processing history, workflow definitions, and service endpoints remain under your control. It is not local-only, however. Compatible cloud APIs can also be configured as service endpoints, allowing Sparkfire to serve as one consistent interface for local models, cloud-hosted models, or a deliberate combination of both.

## One DGX Spark, five bundled models

The reference stack deliberately fits five complementary models onto one DGX Spark. The LLM and the grounding service are deliberately **not** bundled: point Sparkfire at any OpenAI-compatible endpoint (local or cloud) for chat, mind maps, summaries, and workflow prompts, and configure a grounding endpoint for visual grounding.

| Capability | Model | Role in Sparkfire |
| --- | --- | --- |
| OCR | [`baidu/Unlimited-OCR`](https://huggingface.co/baidu/Unlimited-OCR) | Page and image text extraction |
| Speech recognition | [`nvidia/parakeet-tdt-0.6b-v3`](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | Audio/video transcription and subtitles |
| Translation | [`tencent/Hy-MT2-1.8B-FP8`](https://huggingface.co/tencent/Hy-MT2-1.8B-FP8) | Dedicated multilingual translation |
| Image generation | [`Tongyi-MAI/Z-Image-Turbo`](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) | Fast text-to-image generation |
| Video generation | [FastH3](https://huggingface.co/FastVideo/FastVideo-FastH3-Trim-Comfy) (MiniMax H3, through ComfyUI) | Short videos with sound, from text or an image |

This gives a small team or individual a practical multimodal workspace without sending every file to a hosted provider. Sparkfire supplies the shared UI, file history, artifact routing, workflows, queueing, and progress monitoring; the five model servers stay independently replaceable.

## Choose your deployment

Sparkfire has two independently deployable layers:

1. the **AI service layer**—the five reference models, your LLM endpoint, and the optional DGX system monitor; and
2. the **workspace layer**—the Sparkfire web application, API, Redis queue, and file data.

Keeping that boundary explicit supports three practical setups without maintaining three different products:

| Setup | AI services | Sparkfire | Best for |
| --- | --- | --- | --- |
| **All in one** | DGX Spark | Same DGX Spark | The simplest out-of-the-box experience |
| **Split** | DGX Spark | Another server | Keeping the DGX focused on inference or sharing it across a network |
| **Sparkfire only** | Your endpoints | Any Docker host | Existing local services, cloud APIs, or a custom mix |

## Install the workspace

Sparkfire installs from a clone; there is no hosted installer. The [quick start](#quick-start) runs the whole stack on one DGX Spark. To run only the workspace on any Docker host:

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
./scripts/start-sparkfire.sh --model-host dgx-spark.local   # or --configure-later
```

Open `http://localhost:54321`, or `http://SERVER-IP:54321` from another device on the trusted network. Each release also publishes a multi-platform image, `ghcr.io/moviemaker93/sparkfire`, for your own Compose file.

On the first visit, choose one of three tabs:

### Run models locally

Choose this when Sparkfire and the five models run on the same DGX Spark. Onboarding shows the clone-and-start command, then verifies all five services through Docker's host gateway before applying anything. Configure the LLM endpoint afterwards in **Settings → Services**.

### Run models remotely

Choose this when the model stack runs on another DGX Spark. Run `./scripts/start-dgx-spark.sh --models-only --accept-model-licenses` on the DGX, enter its trusted-network hostname or IP in onboarding, and verify ports 8332–8337 (video on 8337 is optional). The optional monitor uses port 8330. Keep these ports behind a firewall, LAN, or VPN.

### Configure endpoints manually

Configure only the services you need. Every provider has independent URL, model, API-key, enable, capability, and connection-test controls. Compatible local services and cloud APIs can be mixed.

Reopen onboarding from **Settings → General → Deployment**. Existing configurations are clearly identified, and a reference preset remains staged until **Apply and continue** is pressed. Changing deployment endpoints does not remove jobs, chats, workflows, or files.

## Upgrade and operate

```bash
git pull
./scripts/start-dgx-spark.sh --accept-model-licenses   # or ./scripts/start-sparkfire.sh for the workspace only
```

Run the start script with the same options you installed with. It rebuilds what changed and leaves `data/` untouched. See [Application deployment and upgrades](docs/deployment.md) for network binding, backups and releases.

Coming from the six-model DGX stack? Saved settings still point the LLM at port 8331 and grounding at port 8335, which no longer run: repoint or disable them in **Settings → Services** (see [Upgrading from the six-model stack](docs/dgx-spark.md#upgrading-from-the-six-model-stack)).

Set `HF_TOKEN` in the shell when the DGX model download requires authentication or additional download capacity:

```bash
HF_TOKEN=hf_... ./scripts/start-dgx-spark.sh --accept-model-licenses
```

Model weights are downloaded from their publishers and are not part of Sparkfire's Apache 2.0 distribution. Review their terms before setup. The acceptance flag records that you completed this review; it does not alter or override upstream terms.

The DGX starter enables the status reporter, which surfaces unified-memory use, CUDA allocations, GPU utilization and temperature, plus model-service health in the sidebar. See the [DGX Spark deployment guide](docs/dgx-spark.md) for installation, prerequisites, network layout, storage locations, operational commands, and model-license notes.

## Modules

| Module | Typical input | Output |
| --- | --- | --- |
| OCR | Images, scanned PDFs | Markdown documents and structured page data |
| Transcription | Audio and video | Markdown transcripts, JSON segments (and word times with Parakeet), SRT, and VTT |
| Translation | Pasted text, documents, transcripts | Translated text or document artifacts |
| Grounding | Images and text queries | Framed image preview and normalized box annotations |
| Text to image | Prompt or compatible text result | Generated image |
| Text to video | Prompt or text result, optionally an image as the first frame | Generated video with sound |
| Mind map | Topic, text result, structured data, or an image with a vision-capable LLM | Interactive JSON map and Markdown outline |
| Chat | Text, documents, structured data, and optionally images | Referenced conversation |

Each module has its own history rail, source preview, and detail view. Jobs, chats, source files, and generated files can be renamed or deleted. Compatible outputs expose actions such as translating a transcript, grounding a generated image, creating an image from text, or opening a result in chat.

## Workbench

The Workbench collects common actions into a lightweight grid:

- format-aware file intake for OCR, transcription, and document translation;
- debounced live text translation with an explicit **Save** action;
- text-to-image generation with common canvas sizes;
- a chat starter;
- a shortcut to image grounding;
- a shortcut to interactive mind-map generation;
- enabled reusable workflows;
- searchable recent work.

Global search covers work, conversations, tools, and generated artifacts. Service health and the optional machine-status monitor remain visible from the collapsible sidebar.

## File-based workflows

The visual workflow editor composes the same modules used everywhere else in Sparkfire. Definitions are versioned JSON files stored under `data/config/workflows/`; each run stores an immutable definition snapshot with the job.

Service nodes:

- OCR
- Transcription
- Translation
- Grounding
- Text to image
- Mind map
- LLM prompt
- Create chat

Generic nodes:

- **Input** declares accepted artifact types.
- **Select** narrows results by artifact kind.
- **If** and **Switch** route artifacts through declarative conditions.
- **Merge** rejoins active branches.
- **Save to file** stores incoming content or explicitly defined text.
- **End** collects a successful result.
- **Fail** ends a path with a readable error.

Connections are allowed only when a producer and consumer share compatible artifact types. Workflow JSON cannot execute arbitrary JavaScript or shell commands.

Service nodes store their output by default. Turn off **Store the result** for an intermediate value that should exist only during execution; downstream nodes can still consume it, and Sparkfire removes it when the run finishes. Use **Save to file** when a particular intermediate result should become a durable artifact.

During execution the run view highlights the active node and records succeeded, skipped, failed, or cancelled paths. Historical workflow jobs retain this node diagram, selected branches, durations, child service runs, and artifact lineage.

See [Workflow design and JSON contracts](docs/workflows.md) for details.

## Manual source deployment

### Requirements

- Docker Engine with Docker Compose
- One or more compatible local, remote, or cloud inference services

For a source-built Compose deployment, clone and configure the project:

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
cp .env.example .env
```

Either leave endpoint URLs empty to use browser onboarding or edit `.env` with services already available on your network, then start the application:

```bash
docker compose up -d --build
```

Open [http://localhost:54321](http://localhost:54321).

Application state is written to `./data`; Redis keeps its state in a named volume. The application image includes `ffmpeg`, `ffprobe`, `pdftotext`, and `pdftoppm` and supports `linux/amd64` and `linux/arm64`.

Environment variables bootstrap a new `settings.json`; saved settings take precedence on later starts so upgrades do not replace a user's endpoints. After first launch, manage providers from **Settings → Services** or reopen **Settings → General → Deployment**. If you are deploying the complete reference stack directly on a DGX Spark, use `scripts/start-dgx-spark.sh` instead.

## Service configuration

Every provider can be enabled, edited, and tested independently. The DGX Spark reference deployment exposes its bundled models on adjacent ports (8332–8337); the LLM endpoint is any service you configure:

| Port | Capability | Reference model/backend |
| ---: | --- | --- |
| 8330 | Optional system status | Lightweight Python API |
| 8332 | OCR | Unlimited-OCR |
| 8333 | Speech recognition | Parakeet-TDT-0.6B-v3 / parakeet.cpp |
| 8334 | Translation | Hy-MT2-1.8B-FP8 |
| 8336 | Image generation | Z-Image-Turbo / Diffusers |
| 8337 | Video generation | FastH3 / ComfyUI |

The system-status service is optional. Leave its URL empty to hide the GPU/memory block without affecting service health indicators.

LLM settings declare text and image input capabilities. Sparkfire uses those flags when deciding whether images can be attached to Chat or connected to LLM workflow nodes.

Advanced settings expose machine-dependent processing controls, including transcription chunk size and overlap, adaptive splitting, request timeouts, PDF rasterization, queue concurrency, retries, and work-directory retention. Display timezone is selected separately under **Settings → General**.

### Optional DGX Spark status reporter

The repository includes a small read-only status service for NVIDIA DGX Spark deployments. The full DGX starter enables it automatically; to add it to an otherwise manual deployment, run:

```bash
docker compose -f compose.spark.yaml up -d --build dgx-status
```

Point **Settings → Services → System monitor** to its base URL. Sparkfire runs normally without it.

## Local development

### Requirements

- Node.js 22 or newer
- Redis
- ffmpeg and ffprobe
- Poppler (`pdftotext` and `pdftoppm`)

```bash
cp .env.example .env
npm install
npm run dev
```

The API runs at `http://localhost:54321`. Vite runs at `http://localhost:5173` and proxies `/api` to the API.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

## Architecture

Sparkfire is a TypeScript modular monolith:

```text
React client
    │
    ▼
Express API ───────────► configurable inference services
    │
    ├── BullMQ / Redis       execution coordination
    │
    └── data/                durable source of truth
          ├── settings and workflow definitions
          ├── jobs, artifacts, and flow snapshots
          └── chats and references
```

Core ideas:

- A **module** is a user-facing capability.
- A **provider** is the configured model endpoint behind that capability.
- A **job** is a portable container for sources, artifacts, and runs.
- An **artifact** is a typed file with stable identity and lineage.
- A **workflow run** is a durable invocation with independent progress, cancellation, outputs, and errors.

Redis may be restarted or rebuilt without replacing the file-based record. Job manifests use atomic write-and-rename updates, and API keys are stored separately in `data/config/secrets.json` with restrictive file permissions.

Read [Architecture](docs/architecture.md) and the [modular-monolith ADR](docs/adr/0001-modular-monolith.md) before adding a module or changing storage contracts.

## Data layout

```text
data/
├── config/
│   ├── settings.json
│   ├── secrets.json
│   ├── prompts/*.json
│   └── workflows/*.json
├── jobs/<job-id>/
│   ├── job.json
│   ├── flows/*.json
│   ├── input/
│   ├── work/
│   └── output/
├── chats/<chat-id>/chat.json
└── logs/
```

Back up the entire `data/` directory to preserve configuration, work history, source files, chats, and generated results. Redis is operational state, not the permanent record.

## API overview

| Area | Endpoints |
| --- | --- |
| Health and configuration | `GET /api/health`, `GET/PUT /api/settings`, `GET /api/modules` |
| Search | `GET /api/search` |
| Jobs | `GET/POST /api/jobs`, job/file rename and delete routes, cancellation, SSE progress |
| Artifacts and runs | `GET /api/jobs/:id/artifacts`, `GET/POST /api/jobs/:id/runs` |
| Translation | preview, pasted-text, and uploaded-document routes under `/api/modules/translation` |
| Grounding | `POST /api/modules/grounding/jobs` |
| Image generation | `POST /api/modules/text-to-image/jobs` |
| Mind map | `POST /api/modules/mindmap/jobs` |
| Chat | chat CRUD and streaming messages under `/api/chats` |
| Workflows | definition CRUD/validation and durable flow runs under `/api/workflows` |

See the server routes and [architecture documentation](docs/architecture.md) for request contracts.

## Security and privacy

Sparkfire currently assumes a trusted user and trusted network. It does not provide built-in authentication or multi-tenant isolation. Do not expose it directly to the public internet; place it behind an authenticated reverse proxy, VPN, or equivalent access control.

Uploaded content is sent to the inference endpoints you configure. A self-hosted Sparkfire deployment is only as private as those services and the surrounding network. Review endpoint ownership, logs, retention, and transport security before processing sensitive material.

Grounding overlays are previews, not secure redaction. A visible rectangle over an image or selectable PDF text does not remove the underlying information.

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

1. Keep module compatibility rules in the shared capability router rather than duplicating them in UI code.
2. Preserve the file-based storage model and artifact lineage.
3. Add or update tests for behavioral changes.
4. Run `npm run typecheck`, `npm test`, and `npm run build`.
5. Avoid committing `.env`, `data/`, model credentials, or user files.
6. Title the pull request as a [Conventional Commit](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`); it becomes the squashed commit that release notes are built from.

Coding agents, and humans who like a map, start from [AGENTS.md](AGENTS.md). The README clips are recorded by `scripts/media/`; see its README to refresh them after UI changes.

The project is currently pre-1.0, so APIs and persisted schemas may still evolve. Migrations should remain additive and must not silently rewrite user folders.

## License

Sparkfire is licensed under the [Apache License 2.0](LICENSE). It is a derivative of [SparklingKit](https://github.com/stevibe/SparklingKit), copyright 2026 Steven Lei, also Apache 2.0; its [NOTICE](NOTICE) is kept. Changes since the fork are recorded in the commit history and summarised in [docs/fork.md](docs/fork.md). "SparklingKit" is the upstream project's name, used here only to say where the code comes from.

Third-party packages and model services remain subject to their respective license terms.

Sparkfire changes copyright 2026 MovieMaker93.

### Model licenses

Model weights are not part of this repository. The start script downloads them after you accept their terms. The default models (Unlimited-OCR or PaddleOCR-VL, Parakeet, Hy-MT2 and Z-Image-Turbo) can be used anywhere, commercially too. Parakeet-TDT-0.6B-v3 is NVIDIA's and uses CC BY 4.0, which allows commercial use with credit (see the acknowledgements); parakeet.cpp, which runs it, is MIT.

Two opt-in models have narrower terms. Qwen-Image 2.1 and Qwen-Image-2.1-Turbo use the Qwen Research License (non-commercial). FastH3, the video model, is a distill of MiniMax H3 under the [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE): it grants use only "worldwide, excluding" the European Union, the United Kingdom, South Korea and the United States, asks that shared outputs be disclosed as machine-generated, and asks commercial products to display "MiniMax H3". [ComfyUI](https://github.com/comfyanonymous/ComfyUI), which runs FastH3, is GPL-3.0; it is fetched at a pinned commit when the video image is built, runs as its own process, and is not part of this repository.

## Acknowledgements

- [SparklingKit](https://github.com/stevibe/SparklingKit) by Steven Lei, the project Sparkfire is built on.
- The model teams whose open weights do the work: Qwen ([Qwen-Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1)), PaddlePaddle ([PaddleOCR-VL](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)), Baidu ([Unlimited-OCR](https://huggingface.co/baidu/Unlimited-OCR)), Tencent ([Hy-MT2](https://huggingface.co/tencent/Hy-MT2-1.8B-FP8)), NVIDIA ([Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), Tongyi-MAI ([Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)), MiniMax ([MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3), whose text encoder uses Qwen's Qwen3-VL-32B weights), and [FastVideo](https://github.com/hao-ai-lab/FastVideo) at Hao AI Lab, whose [FastH3 Trim](https://huggingface.co/FastVideo/FastVideo-FastH3-Trim-Comfy) and [FastH3 V2](https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy) distills and workflow templates make the videos.
- A model evaluated for what comes next: [Underdog Saluki 27B](https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0).
- The serving and tooling stack: [parakeet.cpp](https://github.com/mudler/parakeet.cpp) by mudler (MIT), which runs Parakeet from its [GGUF files](https://huggingface.co/mudler/parakeet-cpp-gguf), [vLLM](https://github.com/vllm-project/vllm), [llama.cpp](https://github.com/ggml-org/llama.cpp), [diffusers](https://github.com/huggingface/diffusers), [ComfyUI](https://github.com/comfyanonymous/ComfyUI) by comfyanonymous and Comfy-Org (GPL-3.0), which runs FastH3 with Comfy-Org's [comfy-kitchen](https://pypi.org/project/comfy-kitchen/) kernels, [PyAV](https://github.com/PyAV-Org/PyAV), which writes the disclosure into each video, [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), React, Express, BullMQ, Vite, and [Playwright](https://playwright.dev), which records the README clips.
- The demo transcript reads from [LibriSpeech](https://www.openslr.org/12) (CC BY 4.0); the demo report is fictional.
- The README layout takes its cue from [sparkDash](https://github.com/MiaAI-Lab/sparkDash).
- [drowzeys](https://github.com/drowzeys) built [keys-TensorFold Studio](https://github.com/drowzeys/keys-TensorFold-Studio-Mac-DGXSpark-64GB-VRam-Min), which runs FastH3 on Macs and the DGX Spark. Sparkfire adopted FastH3 after studying the Studio's Spark setup, and measured its own service against the Studio's published Spark numbers; no code was copied from it.
