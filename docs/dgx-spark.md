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

Ports 8330–8337 (and 8339 with music) bind on the DGX host for this mode. Restrict them to the application server or a trusted private network; the reference adapters are not intended to be exposed directly to the public internet.

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
3. downloads five pinned model revisions from their publishers into `data/dgx-models/`;
4. starts the model servers one at a time and waits for each health endpoint;
5. starts the read-only system monitor; and
6. for an all-in-one deployment, starts Redis and Sparkfire before reporting the workspace URL.

The first run downloads a substantial amount of model data and builds several ARM64 CUDA images. Later runs reuse both the model files and Docker cache. Set `HF_TOKEN` in the command environment if Hugging Face authentication is required:

```bash
HF_TOKEN=hf_... ./scripts/start-dgx-spark.sh --accept-model-licenses
```

## Reference services

| Port | Service | Model/backend |
| ---: | --- | --- |
| 8330 | System status | Lightweight read-only Python API |
| 8332 | OCR | `baidu/Unlimited-OCR` / vLLM |
| 8333 | Speech recognition | `nvidia/parakeet-tdt-0.6b-v3` / parakeet.cpp v0.5.0 |
| 8334 | Translation | `tencent/Hy-MT2-1.8B-FP8` / Transformers |
| 8336 | Image generation | `Tongyi-MAI/Z-Image-Turbo` / Diffusers 0.41.0 |
| 8337 | Video generation | FastH3 (`FastVideo/FastVideo-FastH3-Trim-Comfy`, `FastVideo/FastVideo-FastH3-Comfy`) / ComfyUI 0df64eb |
| 8339 | Music generation (only with `--music-backend yue2`) | `m-a-p/YuE2-3B`, `m-a-p/YuE2-Vae` / YuE2 v0.1.6 on NGC PyTorch 26.07 |
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
choose `Parakeet-TDT-0.6B-v3` (or `Qwen3-ASR-1.7B`) under **Settings → Services → Speech to text**. Until then,
transcription still works, with minute-long lines. The same holds in split mode, where
`scripts/start-sparkfire.sh` assumes the Parakeet id.

### Video generation

Port 8337 serves FastH3, FastVideo's distill of MiniMax H3, which makes video with its own sound track. A
FastAPI adapter starts a pinned ComfyUI on 127.0.0.1:8347 and drives it over its HTTP API. Nothing loads at
start: the first job loads the weights, and they are freed after ten idle minutes
(`VIDEO_IDLE_UNLOAD_SECONDS`) or before a job that needs the other variant. Both variants, Fast and Sharp,
and their shared text encoder and decoders download at pinned revisions, about 53 GB in all.

The MiniMax H3 Community License covers use "worldwide, excluding" the European Union, the United Kingdom,
South Korea and the United States, and asks that shared outputs be disclosed as machine-generated; every MP4
carries that note in its metadata. Where the license does not apply, start the stack with
`--video-backend none`: the service is not built, downloaded or started, and the app leaves its video
endpoint off.

### Music generation

Port 8339 serves YuE2 from m-a-p, which turns lyrics and a style into a song with vocals: it writes the song as
an editable ABC score first, then sings it as 48 kHz stereo FLAC. It is off unless the stack starts with
`--music-backend yue2`, because the weights are CC BY-NC 4.0: personal users and creators may publish and
sell their songs, academic use is non-commercial, and companies need a license from m-a-p. With the option,
the start script builds the service and downloads the model and its decoder at pinned revisions (about
7.8 GB).

Nothing loads at start. The first song loads the model in about 50 seconds; the weights stay for ten idle
minutes (`MUSIC_IDLE_UNLOAD_SECONDS`) and are freed at once by `POST /v1/unload`. A loaded model holds about
15 GiB and a song peaks near 20 GiB, so the adapter refuses to load while less than 22 GiB is free, and the
app runs music and video one at a time (the heavy GPU lane). YuE2 moves its model between the CPU and the GPU
for every song, which saves memory on a graphics card with its own; on the Spark's shared memory the move took
a minute, so the adapter keeps both on the GPU. A 47-second song then takes about 51 seconds, with audio
identical to YuE2's own path.

## Operations

Update the checkout rather than replacing tracked files, then run the start script again with the options you
installed with:

```bash
git pull

# Start and reuse existing models and image layers
./scripts/start-dgx-spark.sh

# Inspect containers and all service endpoints
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
./scripts/start-dgx-spark.sh --refresh-images
```

Persistent files stay beneath `data/`:

- `data/dgx-models/` — pinned publisher model snapshots;
- `data/dgx-runtime/` — model runtime caches;
- `data/dgx-outputs/` — native service outputs; and
- the existing Sparkfire data directories — jobs, chats, workflows, uploads, settings, and generated artifacts.

Docker volumes retain Redis queue state. The stop command does not remove any persistent data.

In a split deployment, upgrade the workspace on its own server with `git pull` and
`./scripts/start-sparkfire.sh`. Neither script downloads the model weights again.

## Model terms

Sparkfire and its service adapters are licensed under Apache 2.0. Model weights are separate works and remain governed by the terms published on each model card. Review those terms before downloading or deploying the reference stack.

The stack no longer ships a grounding service: LocateAnything-3B (non-commercial license) was removed with its 10.9 GiB of memory. The grounding module stays in the app, hidden from menus and actions until a grounding endpoint is enabled in Settings, and works once it is; recheck any such model's terms when deploying, because model publishers may update them independently.

## Using different services

The DGX stack is a recommended reference configuration, not a requirement. Sparkfire can connect to other local endpoints, services hosted elsewhere on a trusted network, compatible cloud APIs, or a mixture of these. For those deployments, use `scripts/start-sparkfire.sh --configure-later` or use `compose.yaml`, copy `.env.example` to `.env`, and configure providers in onboarding or under **Settings → Services**.

Saved settings are intentionally retained across restarts and upgrades. To move an existing installation between all-in-one, split, and custom layouts, open **Settings → General → Deployment**. The guided setup updates endpoints without deleting jobs, chats, workflows, or files.

### Upgrading from the six-model stack

`./scripts/start-dgx-spark.sh` removes the containers of the retired Qwen3.6 LLM, Qwen3-ASR and LocateAnything services, which would otherwise keep restarting and hold about 27 GiB. Saved settings are not rewritten, so the LLM still points at port 8331 and grounding at port 8335. Until you repoint or disable those two endpoints in **Settings → Services**, they show as offline and `/api/health` reports `ok: false`. A newly configured LLM endpoint accepts text only; tick **Images** under its accepted inputs when the model has vision, or chat will not send it attached images.
