# Parakeet as the default speech recognition backend

Date: 2026-10-10. Status: approved in conversation, awaiting review of this written spec.

## Goal

Replace Qwen3-ASR-1.7B with NVIDIA Parakeet TDT 0.6B v3 (through parakeet.cpp) as the fork's default speech
recognition service, keeping Qwen3-ASR as an option, and use Parakeet's word timestamps to produce one
transcript line per sentence and subtitle-sized cues.

Why: measured on a DGX Spark (see `docs/validation.md`), Parakeet matches or beats Qwen3-ASR on word error
rate (3.6% vs 3.7% English, 3.9% vs 4.4% Italian), runs about 18× faster and needs about 1.5–2 GiB instead of
16.5 GiB. It covers 25 European languages; Qwen3-ASR covers 52, which is why it stays available.

## Decisions

| Topic | Decision |
| --- | --- |
| Default | Parakeet is the fork's default ASR; `--asr-backend qwen3-asr` keeps Qwen3-ASR. AGENTS.md's rule "upstream's defaults stay the defaults" becomes "the fork's defaults are listed in the backends table". |
| Timing | Transcript timeline: one line per sentence. SRT/WebVTT: cues cut at sentence ends and pauses, capped at 7 s and 84 characters. Word times kept in the transcript JSON. |
| Approach | Thin adapter in front of parakeet-server; the app builds sentences and cues from word timestamps (works for any ASR that returns them). |

## 1. Service and packaging

New folder `services/dgx-models/parakeet/`:

- **Dockerfile**, two stages, both on the NVIDIA PyTorch base the stack already uses
  (`nvcr.io/nvidia/pytorch:25.11-py3`, pinned by digest):
  - build: parakeet.cpp tag `v0.5.0`, commit `1bfbebfaaf493866f49597cd3b7901959d395c60`, with
    `-DPARAKEET_GGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121`, target `parakeet-server`;
  - runtime: the `parakeet-server` binary (and any shared libraries it links), the adapter, and its Python
    requirements (FastAPI, uvicorn, python-multipart, httpx), pinned.
- **`parakeet_server.py`**, a FastAPI adapter on port 8333 (Qwen3-ASR's port, so the app's endpoint is
  unchanged). At start-up it launches `parakeet-server --model $MODEL_PATH --host 127.0.0.1 --port 8343` as a
  child process and waits for its `/health`.
  - `GET /health`: 200 only when parakeet-server's `/health` answers; 503 otherwise.
  - `GET /v1/models`: `{"object": "list", "data": [{"id": "Parakeet-TDT-0.6B-v3", "object": "model"}]}`
    (the id comes from `MODEL_NAME`, default `Parakeet-TDT-0.6B-v3`).
  - `POST /v1/audio/transcriptions` (multipart): forwards `file`, `response_format` and every
    `timestamp_granularities[]` value to parakeet-server and returns its response unchanged; other fields the
    app sends (`model`, `temperature`) are ignored, since parakeet-server serves one model. Requests run
    one at a time behind a lock, because parakeet-server serves one request at a time. Files that are not
    WAV (by RIFF/WAVE header) get 400 `"Upload WAV audio; SparklingKit sends 16 kHz WAV chunks"`.
  - If the child process exits, the adapter exits too, so Docker restarts the container.
- **Model**: `mudler/parakeet-cpp-gguf`, revision `741158ae71e64ef5c89385862c18f777d07a97a1`, file
  `tdt-0.6b-v3-f16.gguf` (1.37 GB) only.
- **Container**: `sparklingkit-parakeet`, host network, GPU, model mounted read-only at `/models`.

## 2. Stack wiring

- `scripts/start-dgx-spark.sh`
  - `--asr-backend parakeet|qwen3-asr` (or `SPARKLINGKIT_ASR_BACKEND`), default `parakeet`; exports
    `STT_MODEL` (`Parakeet-TDT-0.6B-v3` or `Qwen3-ASR-1.7B`).
  - Builds, downloads and starts only the chosen backend. `download_model` gains an optional file pattern
    (passed to the downloader as `--include`) and accepts a `.gguf` file as proof of a complete download.
  - Before starting the chosen backend, stops the other one's container: both use port 8333. The same is
    done for OCR (`unlimited-ocr` vs `paddleocr-vlm` + `paddleocr-vl`, port 8332), which has the same gap
    today.
  - `stop` includes the new container.
- `compose.dgx.yaml`: a `parakeet` service; the app's environment uses `STT_MODEL: ${STT_MODEL:-Qwen3-ASR-1.7B}`.
- `services/dgx-status/server.py`: labels the adapter process as ASR with the Parakeet model name.
- `scripts/spark-switch.sh`: recognises `sparklingkit-parakeet` as part of the stack.
- CI runs the adapter's tests (the image itself is too large for hosted runners, like the other GPU images);
  Dependabot watches the new folder (pip and Docker).

## 3. The app

- `src/server/ai.ts`
  - `asrProfile(model)`: `parakeet` when the model id matches `/parakeet/i`, otherwise `default`.
  - `transcribeAudio`: with the `parakeet` profile it sends `response_format=verbose_json` and
    `timestamp_granularities[]=word`, and returns `words` (each `{ word, start, end }` shifted by the chunk's
    offset) next to `text` and `segments`. The default profile's request is unchanged.
- New `src/server/transcript-timing.ts` (pure functions):
  - `joinChunkWords(chunks)`: chunks overlap by `chunkOverlapSec` (3 s by default). For each neighbouring
    pair the seam is the middle of the overlap; words of the earlier chunk that start before the seam and
    words of the later chunk that start at or after it are kept, so each spoken word appears once.
  - `toSentences(words)`: a sentence ends after a word ending in `.`, `?`, `!` or `…`, or before a pause of
    at least 1.5 s.
  - `toCues(words)`: a cue ends at a sentence end or before a pause of at least 0.8 s, and before the word
    that would make it longer than 7 s or 84 characters. Words are never split; a single word longer than
    the caps becomes its own cue.
- `src/server/processor.ts` (`processAudio`): when every transcribed chunk returned words,
  - `transcript.json` is `{ text, segments: <sentences>, words }`;
  - `.srt` and `.vtt` are built from the cues;
  - the Markdown text joins the sentences, with a paragraph break at pauses of at least 2 s.
  Otherwise (Qwen3-ASR, or any chunk without words) the output is exactly as today. Checkpoints and adaptive
  retries are unchanged; a chunk retried in halves contributes the halves' words in order.

## 4. Testing and rollout

- vitest, written first: `transcript-timing.ts` (seams across overlapping chunks, sentence breaks at
  punctuation and long pauses, cue caps without splitting words, empty and single-word input), and
  `transcribeAudio` with each profile against a local fake server (request fields, word offsets).
- Python `unittest` for the adapter with a fake parakeet-server: health (up and down), models, field
  pass-through, the non-WAV 400, and requests serialized.
- ShellCheck for the start script; a dry run of `--asr-backend` handling on the Spark.
- On the DGX Spark: build the image, download the model, stop `sparklingkit-qwen3-asr`, start
  `sparklingkit-parakeet`, set the existing app's speech model to `Parakeet-TDT-0.6B-v3` through the
  settings API, transcribe the demo reading and an Italian FLEURS clip through the app, check transcript
  lines, SRT/VTT cue lengths and player seeking, and compare word error rate with the earlier benchmark.
  Re-record the README's transcription clip.
- Docs: README (backends, memory table, transcription section), `docs/fork.md`, `docs/validation.md`,
  `AGENTS.md` (ports table, defaults rule).

## Out of scope

- Word-by-word (karaoke) highlighting in the player.
- Language selection in the UI; Parakeet detects the language itself.
- Batching several chunks per request.
