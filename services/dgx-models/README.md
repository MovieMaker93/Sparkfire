# DGX Spark reference model stack

This directory contains the thin API adapters used by SparklingKit's reference six-model deployment. Model weights are downloaded directly from their publishers and are never included in this repository.

From the repository root, use `scripts/start-dgx-spark.sh` to run the model layer and SparklingKit on the same DGX. Use `scripts/start-dgx-models.sh` when the workspace will run on another server. Both commands build the adapters, download pinned model revisions, start services in a memory-safe sequence, and verify each endpoint; the models-only command deliberately does not start Redis or the application.

Release users can download the checksum-verified model bundle without cloning the repository:

```bash
curl -fsSLO https://run.sparklingkit.com/dgx/stable/install.sh
less install.sh
bash install.sh --accept-model-licenses
```

The hosted installer and the GitHub-source command execute the same versioned stack. Application upgrades remain independent and do not redownload model weights.

Speech recognition has two interchangeable services on port 8333. `parakeet/` is this fork's default: NVIDIA's Parakeet TDT 0.6B v3, run by parakeet.cpp (built from pinned source for the GB10) behind a small adapter that gives it the endpoints SparklingKit speaks. It takes WAV only and serves one request at a time. `asr/` is Qwen3-ASR-1.7B in vLLM, upstream's default. Choose with `--asr-backend parakeet|qwen3-asr`; the start script stops the one you did not choose.

The Apache 2.0 license in this repository applies to SparklingKit and these adapters. Each model is distributed under its publisher's own terms. In particular, `nvidia/LocateAnything-3B` is currently limited by NVIDIA to non-commercial and research use; review every model card before deployment. Parakeet-TDT-0.6B-v3 uses CC BY 4.0, which asks for credit to NVIDIA; the README's acknowledgements give it.
