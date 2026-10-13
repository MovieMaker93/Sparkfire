# README media

The clips in `.github/media/` are recordings of the real app on a DGX Spark, with the real models and demo
files only. These scripts recreate them after UI changes. The app, the recording and the editing run in
containers; `populate-demo.sh` and the dataset download run on the host and need `curl` and `jq`. Run the
commands from the repository root on the Spark, with the stack up, video included
(`./scripts/start-dgx-spark.sh --accept-model-licenses`). The demo copy uses the stack's services, Saluki among
them, and its own monitor and SearXNG.

| File | Role |
| --- | --- |
| `demo-pdf.py`, `demo-audio.py` | Build the demo inputs: a fictional three-page report and about a minute of read speech from LibriSpeech (CC BY 4.0) |
| `demo.env`, `status-proxy.py` | An isolated demo copy of the app, so no real jobs, chats or host names appear on screen |
| `test_status_proxy.py` | Checks that the status proxy only ever forwards the status route; CI runs it |
| `populate-demo.sh` | Fills the demo copy with real jobs on the real models (OCR, transcription, images, a video, translation, mind map) |
| `record-demo.mjs` | Playwright: Chromium's own screencast frames for each scene, with a visible pointer, plus screenshots and the moments spent waiting for a model. Playwright's built-in video recording is not used, because it compresses to about 1 Mbit/s and blurs text |
| `make-media.mjs` | ffmpeg: plays the frames back at their recorded times, fast-forwards the waits, writes an MP4 (1440 × 900) and an animated WebP (1280 px, 15 fps) per scene, and stitches the tour |

## Steps

1. **Build the app from this checkout and start an empty demo copy** on port 54400, with its own Redis, data
   folder and SearXNG. The status proxy reports the host as `dgx-spark`. The image gets its own name, so the
   running app is not touched.

   ```bash
   docker build -t sparkfire-demo-app --build-arg APP_VERSION=demo .
   mkdir -p scripts/media/work/data
   docker run -d --name sk-demo-redis --network host redis:8-alpine redis-server --port 6390 --save ""
   docker run -d --name sk-demo-status --network host -v "$PWD/scripts/media/status-proxy.py:/proxy.py:ro" python:3.12-slim python /proxy.py
   docker run -d --name sk-demo-searxng -p 127.0.0.1:8398:8080 --cap-drop ALL --security-opt no-new-privileges:true \
     -e SEARXNG_SECRET="$(openssl rand -hex 32)" -e FORCE_OWNERSHIP=false -v "$PWD/services/searxng:/etc/searxng:ro" \
     --tmpfs /var/cache/searxng --tmpfs /tmp "$(sed -n 's/^ *image: *//p' compose.search.yaml)"
   docker run -d --name sk-demo-app --network host -v "$PWD/scripts/media/work/data:/data" --env-file scripts/media/demo.env sparkfire-demo-app
   ```

2. **Build the demo inputs** and fill the demo copy. This takes a few minutes; the mind map and the video are
   the slowest.

   ```bash
   curl -fsSL -o scripts/media/work/librispeech.parquet \
     https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy/resolve/main/clean/validation-00000-of-00001.parquet
   docker run --rm -v "$PWD/scripts/media:/m" -w /m/work python:3.12-slim sh -c \
     "pip install -q reportlab pyarrow soundfile numpy && python ../demo-pdf.py harbor-point-feasibility.pdf && python ../demo-audio.py librispeech.parquet reading.wav"
   ./scripts/media/populate-demo.sh
   ```

3. **Record** every scene, or name some: `workbench ocr transcript image video websearch chat mindmap theme`.

   ```bash
   docker run --rm --network host -v "$PWD/scripts/media:/m" -w /m mcr.microsoft.com/playwright:v1.64.0-noble \
     sh -c "npm i -s --no-save playwright@1.64.0 && node record-demo.mjs"
   ```

4. **Edit** the recordings into `.github/media/`. The app image already has Node and ffmpeg.

   ```bash
   docker run --rm -v "$PWD:/repo" -w /repo/scripts/media --entrypoint node sparkfire-demo-app make-media.mjs work/out /repo/.github/media
   ```

5. **Clean up.** The containers write as root, so remove the work folder from a container too:

   ```bash
   docker rm -f sk-demo-app sk-demo-searxng sk-demo-status sk-demo-redis
   docker run --rm -v "$PWD/scripts/media:/m" python:3.12-slim rm -rf /m/work /m/node_modules
   ```

   `scripts/media/work/` is git-ignored. The frames of a full recording take a few hundred MB there.

Scenes wait for real model output, so the timings depend on the models running. The video scene starts a
first video through the API before it types its own, so the recording shows the second one *Waiting for the
GPU*; it renders two videos and waits up to 15 minutes. The web search scene asks
about something current, so its sources and answer change from one recording to the next. To change
the tour, edit `TOUR` in `make-media.mjs`. The README loads every WebP, so keep the tour around 4 MB and each
clip under 2 MB; a clip with a generated video in it is the largest, because its frames all change.

Generated videos can come back with a made-up broadcaster logo in a corner when the prompt reads like a
nature documentary, so the demo prompts avoid that style. Check the videos before publishing a recording.
