# ADR 0002: The video service drives a pinned ComfyUI

Status: Accepted

## Context

Text-to-video needs a model that makes video with its own sound track and fits next to the other services
on one DGX Spark. FastH3, FastVideo's 8-step distill of MiniMax H3, does both, but on 2026-10-10 no
diffusers or transformers release could load its checkpoints (the Trim model's rank-16 AdaLN is missing
from diffusers, and transformers refuses pre-quantized NVFP4 text encoders). A pinned ComfyUI, driven
headlessly over its HTTP API, ran them at 32 to 35 GiB above the idle stack (`docs/validation.md`).

## Decision

- The video service runs ComfyUI at a pinned commit, started by a small FastAPI adapter that gives it the
  same `/v1` surface as the other services. The FastH3 graphs are written out in the adapter, from
  FastVideo's official templates.
- The adapter frees ComfyUI's weights after a few idle minutes and before switching variants, because
  ComfyUI keeps every weight it loaded.
- FastH3 runs by default. Its license (MiniMax H3 Community License) excludes the EU, the UK, South Korea
  and the US, so `--video-backend none` leaves the service out, and the app treats the video endpoint as
  optional.

## Considered options

- **Our own diffusers adapter**, like the image service: cannot load FastH3 today. Revisit when diffusers
  and transformers support it; the app side would not change.
- **The TensorFold engine from keys-TensorFold Studio**: faster per pass for the int8 V2 model, but it is a
  native build outside a container, and the Studio's setup held about 70 GiB.
- **A model under a worldwide license** (LTX-2.5) for the default: not needed for this deployment; the
  adapter's backend registry leaves room for it.

## Consequences

- This is the one service whose runtime is not diffusers, vLLM or a native engine; ComfyUI updates need a
  new measurement on the Spark before the pin moves.
- The graphs depend on ComfyUI node names and inputs, so the adapter tests pin their shape.
- ComfyUI caches identical graphs: the same prompt, seed and settings return the earlier video at once.
