# DGX Spark reference model stack

This directory contains the thin API adapters used by Sparkfire's reference six-model deployment. Model weights are downloaded directly from their publishers and are never included in this repository.

From the repository root, use `scripts/start-dgx-spark.sh` to run the model layer and Sparkfire on the same DGX. Use `scripts/start-dgx-models.sh` when the workspace will run on another server. Both commands build the adapters, download pinned model revisions, start services in a memory-safe sequence, and verify each endpoint; the models-only command deliberately does not start Redis or the application.

Each release also attaches a `sparkfire-dgx-stack-<version>.tar.gz` bundle with everything the start script needs, for installs without git. Upgrades reuse the downloaded model weights.

Speech recognition has two interchangeable services on port 8333. `parakeet/` is Sparkfire's default: NVIDIA's Parakeet TDT 0.6B v3, run by parakeet.cpp (built from pinned source for the GB10) behind a small adapter that gives it the endpoints Sparkfire speaks. It takes WAV only and serves one request at a time. `asr/` is Qwen3-ASR-1.7B in vLLM, upstream's default. Choose with `--asr-backend parakeet|qwen3-asr`; the start script stops the one you did not choose.

The Apache 2.0 license in this repository applies to Sparkfire and these adapters. Each model is distributed under its publisher's own terms. In particular, `nvidia/LocateAnything-3B` is currently limited by NVIDIA to non-commercial and research use; review every model card before deployment. Parakeet-TDT-0.6B-v3 uses CC BY 4.0, which asks for credit to NVIDIA; the README's acknowledgements give it.
