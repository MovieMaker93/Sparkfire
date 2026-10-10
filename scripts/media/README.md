# README media

The clips in `.github/media/` are recordings of the real app on a DGX Spark, with the real models and demo
files only. These scripts recreate them after UI changes. Everything runs in containers; run the commands
from the repository root on the Spark, with the stack up (see the main README's quick start).

| File | Role |
| --- | --- |
| `demo-pdf.py`, `demo-audio.py` | Build the demo inputs: a fictional three-page report and about a minute of read speech from LibriSpeech (CC BY 4.0) |
| `demo.env`, `status-proxy.py` | An isolated demo copy of the app, so no real jobs, chats or host names appear on screen |
| `populate-demo.sh` | Fills the demo copy with real jobs on the real models (OCR, transcription, images, grounding, translation, mind map) |
| `record-demo.mjs` | Playwright: one video per scene, with a visible pointer, plus screenshots and the moments spent waiting for a model |
| `make-media.mjs` | ffmpeg: fast-forwards the waits, writes an MP4 and an animated WebP per scene, and stitches the tour |

## Steps

1. **Start an empty demo copy** of the app on port 54400, with its own Redis and data folder. The status
   proxy reports the host as `dgx-spark`.

   ```bash
   mkdir -p scripts/media/work/data
   docker run -d --name sk-demo-redis --network host redis:8-alpine redis-server --port 6390 --save ""
   docker run -d --name sk-demo-status --network host -v "$PWD/scripts/media/status-proxy.py:/proxy.py:ro" python:3.12-slim python /proxy.py
   docker run -d --name sk-demo-app --network host -v "$PWD/scripts/media/work/data:/data" --env-file scripts/media/demo.env sparklingkit-app
   ```

2. **Build the demo inputs** and fill the demo copy. This takes a few minutes; the mind map is the slowest.

   ```bash
   curl -fsSL -o scripts/media/work/librispeech.parquet \
     https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy/resolve/main/clean/validation-00000-of-00001.parquet
   docker run --rm -v "$PWD/scripts/media:/m" -w /m/work python:3.12-slim sh -c \
     "pip install -q reportlab pyarrow soundfile numpy && python ../demo-pdf.py harbor-point-feasibility.pdf && python ../demo-audio.py librispeech.parquet reading.wav"
   ./scripts/media/populate-demo.sh
   ```

3. **Record** every scene, or name some: `workbench ocr transcript image grounding chat mindmap theme`.

   ```bash
   docker run --rm --network host -v "$PWD/scripts/media:/m" -w /m mcr.microsoft.com/playwright:v1.64.0-noble \
     sh -c "npm i -s --no-save playwright@1.64.0 && node record-demo.mjs"
   ```

4. **Edit** the recordings into `.github/media/`. The app image already has Node and ffmpeg.

   ```bash
   docker run --rm -v "$PWD:/repo" -w /repo/scripts/media --entrypoint node sparklingkit-app make-media.mjs work/out /repo/.github/media
   ```

5. **Clean up:**

   ```bash
   docker rm -f sk-demo-app sk-demo-status sk-demo-redis
   ```

   `scripts/media/work/` is git-ignored.

Scenes wait for real model output, so the timings depend on the models running. To change the tour, edit
`TOUR` in `make-media.mjs`. Keep each WebP under about 1 MB and the tour under 2 MB, so the README loads
quickly.
