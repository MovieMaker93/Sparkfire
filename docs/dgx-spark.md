# DGX Spark reference deployment

Sparkfire treats inference and the workspace as two independent deployment layers. The reference stack can co-locate both layers on one NVIDIA DGX Spark with 128 GB of unified memory, or the DGX can serve only the five specialized models while Sparkfire runs on another host.

## Deployment paths

### All in one

Clone the repository on the DGX Spark and start everything:

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
./scripts/start-dgx-spark.sh --accept-model-licenses
```

Open `http://DGX-IP:54321`. Add `--video-backend none` where FastH3's license does not apply
(see [Video generation](#video-generation)).

### Split across two machines

On the DGX Spark, run only the inference layer:

```bash
./scripts/start-dgx-models.sh --accept-model-licenses
```

On the server that will own the workspace files:

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
./scripts/start-sparkfire.sh --model-host DGX-HOSTNAME
```

Or start it with `--configure-later`, select **Run models remotely** in the browser, and enter the DGX hostname or trusted-network IP reachable from the application container. Sparkfire configures the reference ports, verifies the bundled AI services (video generation is optional, so a stack started without it still verifies), then stores the endpoint selection in its settings. The LLM endpoint is configured separately in Settings. The model host does not receive the application's job database, chat history, or durable workspace files.

Ports 8330, 8332–8334, 8336 and 8337 bind on the DGX host for this mode; the internal engines (8342, 8343,
8347) and SearXNG (8338) listen on 127.0.0.1 only. Restrict them to the application server or a trusted private network; the reference adapters are not intended to be exposed directly to the public internet.

### Sparkfire with other providers

No DGX stack is required. Start the workspace with `./scripts/start-sparkfire.sh --configure-later`, then choose **Configure manually** during onboarding. Configure compatible local, remote, or cloud endpoints independently.

## What the DGX starter does

Run from the repository root:

```bash
./scripts/start-dgx-spark.sh --accept-model-licenses
```

The script:

1. verifies Linux ARM64, Docker Compose and NVIDIA GPU access;
2. builds Sparkfire and the thin model API adapters;
3. downloads the chosen models at pinned revisions from their publishers into `data/dgx-models/`;
4. removes the containers of retired services (the Qwen3.6 LLM, Qwen3-ASR, LocateAnything);
5. starts the model servers one at a time and waits for each health endpoint, stopping the OCR backend
   and the optional services you did not choose;
6. starts SearXNG with `--search-backend searxng`, then the read-only system monitor; and
7. for an all-in-one deployment, starts Redis and Sparkfire before reporting the workspace URL.

The first run downloads a substantial amount of model data and builds several ARM64 CUDA images. Later runs reuse both the model files and Docker cache. Set `HF_TOKEN` in the command environment if Hugging Face authentication is required:

```bash
HF_TOKEN=hf_... ./scripts/start-dgx-spark.sh --accept-model-licenses
```

## Reference services

| Port | Service | Model/backend |
| ---: | --- | --- |
| 8330 | System status | Lightweight read-only Python API |
| 8332 | OCR | `baidu/Unlimited-OCR` / vLLM, or with `--ocr-backend paddleocr-vl` `PaddlePaddle/PaddleOCR-VL-1.6`: layout adapter, with its vLLM on 127.0.0.1:8342 |
| 8333 | Speech recognition | `nvidia/parakeet-tdt-0.6b-v3` / parakeet.cpp v0.5.0 |
| 8334 | Translation | `tencent/Hy-MT2-1.8B-FP8` / Transformers |
| 8336 | Image generation | `Tongyi-MAI/Z-Image-Turbo` / Diffusers 0.41.0, or `Qwen/Qwen-Image-2.1-Turbo` / `Qwen/Qwen-Image-2.1` with `--image-backend` |
| 8337 | Video generation | FastH3 (`FastVideo/FastVideo-FastH3-Trim-Comfy`, `FastVideo/FastVideo-FastH3-Comfy`) / ComfyUI 0df64eb |
| 8338 | Web search for chat (127.0.0.1 only) | SearXNG, with `--search-backend searxng` |
| 54321 | Sparkfire | Web application and API |

Port 54321 is present only in an all-in-one deployment. The ports and co-residency settings are defined in `compose.dgx.yaml`. The conservative KV-cache budgets, concurrency limits, and sequential startup order are intentional for a 128 GB unified-memory machine.

### Speech recognition backend

Port 8333 serves Parakeet; it replaced the earlier Qwen3-ASR backend (16.5 GiB, 52 languages,
kept only as a user-configurable endpoint the app can still talk to).

| Model | Container | Memory | Languages |
| --- | --- | --- | --- |
| `nvidia/parakeet-tdt-0.6b-v3` in parakeet.cpp, CC BY 4.0 | `sparklingkit-parakeet` | 1.7 GiB (up to about 3.3 GiB while it transcribes) | 25 European |

Parakeet downloads one 1.4 GB GGUF file at a pinned revision, and its image builds parakeet.cpp from pinned
source for the GB10. The adapter accepts WAV only, which is what Sparkfire sends, and serves one request
at a time. Parakeet returns word timestamps, from which
Sparkfire builds one transcript line per sentence and subtitle-sized cues; Qwen3-ASR gives one line per
chunk.

Saved Sparkfire settings are never rewritten. After switching the speech service on an existing install,
choose `Parakeet-TDT-0.6B-v3` under **Settings → Services → Speech to text**. Until then,
transcription still works, with minute-long lines. The same holds in split mode, where
`scripts/start-sparkfire.sh` assumes the Parakeet id.

### Video generation

Port 8337 serves FastH3, FastVideo's distill of MiniMax H3, which makes video with its own sound track. A
FastAPI adapter starts a pinned ComfyUI on 127.0.0.1:8347 and drives it over its HTTP API. Nothing loads at
start: the first job loads the weights, and they are freed after ten idle minutes
(`VIDEO_IDLE_UNLOAD_SECONDS`) or before a job that needs the other variant. Both variants, Fast and Sharp,
and their shared text encoder and decoders download at pinned revisions, about 53 GB in all. Videos take
turns in the app's GPU lane, so a second video waits for the first instead of loading beside it (see the
README's [Heavy jobs take turns](../README.md#heavy-jobs-take-turns)).

The MiniMax H3 Community License covers use "worldwide, excluding" the European Union, the United Kingdom,
South Korea and the United States, and asks that shared outputs be disclosed as machine-generated; every MP4
carries that note in its metadata. Where the license does not apply, start the stack with
`--video-backend none`: the service is not built, downloaded or started, and the app leaves its video
endpoint off.

## Operations

Update the checkout rather than replacing tracked files, then run the start script again with the options you
installed with. The script does not remember them: without `--ocr-backend`, `--image-backend`,
`--video-backend` and `--search-backend` it starts the defaults (Unlimited-OCR, Z-Image-Turbo, FastH3, no
web search) and stops the others.

```bash
git pull

# Start and reuse existing models and image layers
./scripts/start-dgx-spark.sh --accept-model-licenses [the options you installed with]

# Inspect containers and all service endpoints (repeat --video-backend and --search-backend)
./scripts/start-dgx-spark.sh status

# Stop containers without deleting models, jobs, or Redis data
./scripts/start-dgx-spark.sh stop

# Inspect or stop a models-only deployment
./scripts/start-dgx-models.sh status
./scripts/start-dgx-models.sh stop
```

Model snapshots with unchanged pinned revisions are reused. If a later version pins a new revision, the
script downloads it without deleting the previous snapshot.

Advanced options:

```bash
./scripts/start-dgx-spark.sh --skip-download
./scripts/start-dgx-spark.sh --skip-build
./scripts/start-dgx-spark.sh --skip-pull
./scripts/start-dgx-spark.sh --refresh-images
./scripts/start-dgx-spark.sh --force-recreate
```

Persistent files stay beneath `data/`:

- `data/dgx-models/` — pinned publisher model snapshots;
- `data/dgx-runtime/` — model runtime caches;
- `data/dgx-outputs/` — native service outputs;
- `data/searxng/secret` — SearXNG's secret, generated on the first start with `--search-backend searxng`; and
- the existing Sparkfire data directories — jobs, chats, workflows, uploads, settings, and generated artifacts.

Docker volumes retain Redis queue state. The stop command does not remove any persistent data.

In a split deployment, upgrade the workspace on its own server with `git pull` and
`./scripts/start-sparkfire.sh --model-host DGX-HOSTNAME` (or `--configure-later`; the script needs one of the
two, and keeps saved settings either way). Neither script downloads the model weights again.

## Model terms

Sparkfire and its service adapters are licensed under Apache 2.0. Model weights are separate works and remain governed by the terms published on each model card. Review those terms before downloading or deploying the reference stack.

The stack no longer ships a grounding service: LocateAnything-3B (non-commercial license) was removed with its 10.9 GiB of memory. The grounding module stays in the app, hidden from menus and actions until a grounding endpoint is enabled in Settings, and works once it is; recheck any such model's terms when deploying, because model publishers may update them independently.

## Using different services

The DGX stack is a recommended reference configuration, not a requirement. Sparkfire can connect to other local endpoints, services hosted elsewhere on a trusted network, compatible cloud APIs, or a mixture of these. For those deployments, use `scripts/start-sparkfire.sh --configure-later` or use `compose.yaml`, copy `.env.example` to `.env`, and configure providers in onboarding or under **Settings → Services**.

Saved settings are intentionally retained across restarts and upgrades. To move an existing installation between all-in-one, split, and custom layouts, open **Settings → General → Deployment**. The guided setup updates endpoints without deleting jobs, chats, workflows, or files.

### Upgrading from the six-model stack

`./scripts/start-dgx-spark.sh` removes the containers of the retired Qwen3.6 LLM, Qwen3-ASR and LocateAnything services, which would otherwise keep restarting and hold their memory (31 GiB for the LLM, 16.5 GiB for Qwen3-ASR and
10.9 GiB for LocateAnything, as measured). Their images and downloaded weights stay on disk until you delete
them. Saved settings are not rewritten, so the LLM still points at port 8331 and grounding at port 8335. Until you repoint or disable those two endpoints in **Settings → Services**, they show as offline and `/api/health` reports `ok: false`. A newly configured LLM endpoint accepts text only; tick **Images** under its accepted inputs when the model has vision, or chat will not send it attached images.
