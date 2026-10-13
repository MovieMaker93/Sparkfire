# DGX Spark reference model stack

This directory holds the containers and thin API adapters of Sparkfire's reference stack: seven models, one
fixed model for each use case, chosen and measured to run side by side on one DGX Spark. Model weights are
downloaded directly from their publishers and are never included in this repository.

From the repository root, use `scripts/start-dgx-spark.sh` to run the model layer and Sparkfire on the same
Spark. Use `scripts/start-dgx-spark.sh --models-only` (or its shorthand, `scripts/start-dgx-models.sh`) when
the workspace will run on another server. Both build the adapters, download the models at pinned revisions
(Saluki's is not pinned yet), start the services in a memory-safe sequence and check each one; the
models-only form does not start Redis or the app.

Each release also attaches a `sparkfire-dgx-stack-<version>.tar.gz` bundle with everything the start script
needs, for installs without git. Upgrades reuse the downloaded model weights.

| Directory | Service | Port |
| --- | --- | --- |
| `downloader/` | The Hugging Face CLI that fetches each model at its pinned revision during installation, then exits | |
| `llama-server/` | Underdog Saluki 27B in llama.cpp's `llama-server` (pinned b11576, built for the GB10's sm_121), with its vision add-on. It speaks the OpenAI API itself, so it has no adapter, and starts before the other services | 8331 |
| `paddleocr-vl/` | PaddleOCR-VL-1.6 adapter: page layout (PP-DocLayoutV3, on the CPU) and the vision model in vLLM on 127.0.0.1:8342 | 8332 |
| `parakeet/` | NVIDIA's Parakeet-TDT-0.6B-v3, run by parakeet.cpp (built from pinned source for the GB10) on 127.0.0.1:8343, behind an adapter that gives it the endpoints Sparkfire speaks. It takes WAV only and serves one request at a time | 8333 |
| `hy-mt2/` | Hy-MT2-1.8B-FP8 translation in Transformers | 8334 |
| `image-generation/` | Qwen-Image-2.1-Turbo in diffusers; it reports sizes and steps at `/v1/capabilities` | 8336 |
| `video/` | FastH3 (Fast and Sharp) in a pinned ComfyUI on 127.0.0.1:8347, behind an adapter that reports sizes, lengths and variants at `/v1/capabilities`, refuses a job that would not fit in free memory (503 with `Retry-After`), streams the MP4 back and frees the weights after ten idle minutes or on `POST /v1/unload`; left out with `--video-backend none` | 8337 |
| `music/` | YuE2-3B, which writes a song as an ABC score and sings it as FLAC; like video, it loads nothing until a song, refuses one that would not fit in free memory and frees its weights after ten idle minutes or on `POST /v1/unload` | 8339 |

The system monitor (`services/dgx-status/`, port 8330) and SearXNG for chat web search (`services/searxng/`,
127.0.0.1:8338) live next to this directory.

The adapter tests need no GPU and no weights. CI runs them for `image-generation`, `paddleocr-vl`,
`parakeet`, `music` and `video`; from the repository root, for example:

```bash
docker run --rm -v "$PWD/services/dgx-models/video:/app" -w /app python:3.12-slim \
  sh -c "pip install -q fastapi uvicorn python-multipart httpx && python -m unittest"
```

The Apache 2.0 license in this repository applies to Sparkfire and these adapters. Each model is distributed
under its publisher's own terms, which the start script asks you to accept (`--accept-model-licenses`);
review every model card before deployment, Saluki's included. Three narrow what you may do:

- Qwen-Image-2.1-Turbo uses the Qwen Research License: non-commercial use only.
- FastH3, a distill of MiniMax H3, uses the MiniMax H3 Community License. It excludes the European Union,
  the United Kingdom, South Korea and the United States (use `--video-backend none` there) and asks that
  shared outputs be disclosed as machine-generated, which the adapter writes into every MP4.
- YuE2's weights use CC BY-NC 4.0 with a creator permission: creators may publish and sell their songs,
  academic use is non-commercial, and companies need a license from m-a-p. Each song shows that line.

ComfyUI, which runs FastH3, is GPL-3.0. It is fetched at a pinned commit when the video image is built and
runs as its own process. Parakeet-TDT-0.6B-v3 uses CC BY 4.0, which asks for credit to NVIDIA; the main
README's acknowledgements give it.
