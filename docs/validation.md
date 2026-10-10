# Validation on a DGX Spark

Measurements of this fork's model backends on one NVIDIA DGX Spark (GB10, aarch64, CUDA 13, about
121 GiB of usable unified memory), October 2026. Unless noted, the stack ran with
`--ocr-backend paddleocr-vl` and a Qwen-Image backend, and nothing else used the GPU.

## OCR: PaddleOCR-VL-1.6

- **It runs on aarch64.** `paddlepaddle==3.2.2` installs from wheels, PP-DocLayoutV3 (the layout stage)
  runs on CPU, and the vision-language model runs in vLLM 0.24. The adapter returns Markdown plus layout
  blocks with labels and boxes.
- **Benchmark:** a generated 20-page PDF with known content: headings, prose, bullet lists, one table per
  page, and two-column layout on pages 15–20. Each page's Markdown was scored against the source.

| Metric | Result |
| --- | --- |
| Words found, in reading order (two-column pages included) | 99.9% |
| Headings marked as headings | 20 / 20 |
| Numeric table cells correct | 480 / 480 |
| Speed through the app | about 6 s per page |

- **Failure mode:** in 2 of 20 tables, two adjacent row labels that read like one name ("Coastal",
  "Islands") were merged into one cell, which shifted the labels below them by one row.

## Image generation: Qwen-Image 2.1 and Qwen-Image-2.1-Turbo

Both load with torchao float8 weight-only quantization (about 17–18 GiB) and PyTorch SDPA attention. Seed
42, four prompts (a shop sign, a portrait, an isometric illustration, a chalkboard menu):

| | 1024 × 1024 | 2048 × 2048 |
| --- | --- | --- |
| Qwen-Image 2.1, 40 steps | 80 s | 286 s |
| Qwen-Image-2.1-Turbo, 8 steps | 18 s | 65 s |

- **Quality:** Turbo matches the base model on these prompts. Lettering is clean, and the portrait and
  composition are as convincing.
- **Small text at 1024²:** both models pad a sparse menu with invented lines at 1024², and Turbo also
  misspelled one item. At 2048², the model's native size, the requested text is right; extra invented
  lines can still appear. Use the High (2K) sizes for images that contain text.
- **Fixes this needed:**
  - **torchao 0.16:** the NVIDIA base image ships torchao 0.14, which diffusers cannot import.
  - **Per-component quantization configs:** diffusers' and transformers' `TorchAoConfig` differ.
  - **SDPA attention:** Qwen-Image's attention mask is rejected by flash-attn 2.

## Speech recognition: Parakeet TDT 0.6B v3 and Qwen3-ASR

[parakeet.cpp](https://github.com/mudler/parakeet.cpp) v0.5.0 was built from source with CUDA for sm_121,
since there is no ARM64 CUDA release. It runs `parakeet-tdt-0.6b-v3` (f16) behind a small adapter on the ASR
port. Both engines received the same clips, one request at a time:
- **English:** the LibriSpeech dummy validation set, 73 clips, 8 min.
- **Italian:** the first 60 clips of FLEURS `it_it` dev, 16 min.

| | WER, English | WER, Italian | Speed | GPU memory |
| --- | --- | --- | --- | --- |
| Qwen3-ASR-1.7B (vLLM) | 3.7% | 4.4% | 7–14× realtime | about 12.6 GiB |
| Parakeet TDT 0.6B v3, engine alone | 3.6% | 3.9% | 134–248× realtime | 1.5 GiB |
| Parakeet TDT 0.6B v3, through the adapter | 3.6% | 3.9% | 101–181× realtime | see Memory |

The adapter adds about 20 ms per request (an HTTP hop and the multipart upload), which shows on short clips.

- **Word timestamps:** Parakeet returns per-word timestamps and confidence when asked for
  `timestamp_granularities[]=word`. The app turns them into one transcript line per sentence and
  subtitle-sized cues.
- **Limits:**
  - **Languages:** 25 European languages, against 52 for Qwen3-ASR.
  - **Server:** handles one request at a time.
  - **Input:** WAV only.

### Through the app

Measured on 2026-10-10. For Parakeet the app targets 30 s chunks, about 30–38 s each once the split snaps to
a pause and the 3 s overlap is added; Qwen3-ASR keeps the configured 60 s target. The two long files are the
clips above joined with 0.6 s gaps: the 73 English clips (8.7 min) with faint noise in the gaps, and the 60
Italian clips (16.8 min) with exact digital-zero gaps.

| | English, 8.7 min | Italian, 16.8 min |
| --- | --- | --- |
| Parakeet, 30 s chunk target, through the app | 4.3% in 3.6 s | 4.9% in 6.9 s |
| Parakeet, the whole file in one request to the adapter | 5.0% | 4.7% |
| Qwen3-ASR, 60 s chunk target, through the app | 5.9% in 35 s | 11.2% in 115 s |
| Short clips, one request each (table above): Parakeet / Qwen3-ASR | 3.6% / 3.7% | 3.9% / 4.4% |

- **Why Qwen3-ASR scores worse through the app:** it returns no word times, so the app cannot cut the
  overlap between chunks by time, and the overlap is often transcribed twice ("…used to flash his teeth.
  Used to flash his teeth, and Mr. John Collier…"). Without those repeats its English is 3.7%. In Italian
  the seams are also garbled, with paraphrased repeats and spliced sentences, which leaves 9.6%. On short
  clips the two models are close, so this table compares the app's two chunk paths more than the models.
- **Speed:** about 145× realtime for Parakeet through the app, including audio conversion and chunking,
  against 9–15× for Qwen3-ASR.
- **Skipped speech:** Parakeet occasionally drops a stretch of speech; see Known issues. Qwen3-ASR also
  lost 12 Italian words, at about 792 s, through the app.

Parakeet's transcripts with the 30 s chunk target. The Italian clip was measured before the cap; at 16 s it
is one chunk either way.

| Input | Audio | Chunks | Time in the app | Transcript lines | SRT cues | Longest cue | Most characters |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The README demo reading (English) | 65.5 s | 2 | 0.5 s | 7 | 14 | 6.5 s | 84 |
| One FLEURS clip (Italian) | 16 s | 1 | under 1 s | 2 | 3 | 6.7 s | 83 |
| The English long file (noise gaps) | 8.7 min | 17 | 3.6 s | 76 | 115 | 6.5 s | 84 |
| The Italian long file (zero gaps) | 16.8 min | 34 | 6.9 s | 77 | 166 | 6.96 s | 84 |

- **Cues:** every SRT cue lasts at most 7 s and holds at most 84 characters. Each `transcript.json` has a
  `words` array (150, 27, 1,138 and 1,501 words) that matches the words of its lines.
- **Sentence lines:** one line per sentence, with two exceptions the rules make on purpose:
  - A dot followed by a lowercase word does not end a sentence. Parakeet sometimes writes "Mr." as
    "mister", lowercase even at the start of a sentence, so in one run "…as a jingo poem. mister Burkett
    Foster's landscapes…" stayed one line.
  - A single capital letter with a dot reads as an initial: "…posto nel Super G. Il sudcoreano…".
- **`<unk>`:** Parakeet marks a character it cannot spell, such as "°", with `<unk>` in its word list. The
  app removes the mark, as Parakeet's own `text` does, so it no longer reaches transcripts.
- **Health while busy:** the adapter's `GET /health`, probed every 0.2 s, answered 200 within 65 ms
  throughout the long jobs and throughout one 16.8-minute request sent straight to the adapter, so the
  container's health check does not fail while it transcribes.
- **Status page:** the system monitor labels the engine's GPU process "ASR" and names its model.

## LLM: Underdog Saluki 27B (evaluated, not integrated)

[Saluki](https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0) is a 2-bit GGUF of Qwen3.8-27B
(7.9 GB) with an optional vision add-on. It ran in stock `llama-server` (CUDA) with `--jinja -ngl 99 -fa on
-c 65536 --parallel 1`, on the LLM port, so the app used it unchanged.

| | Saluki 27B | Qwen3.6-35B-A3B NVFP4 (current) |
| --- | --- | --- |
| GPU memory | 13.0 GiB, loads in about 5 s with no peak | about 28 GiB, about 60 GB peak while loading |
| Decode | 22–23 tok/s | 20–54 tok/s |
| Prefill | about 740 tok/s up to 6k tokens; 703 tok/s at 25k | faster |

It read a table page from an image correctly, answered reasoning questions, and produced a working mind map
through the app.

- **Context:** 65,536 tokens (64k) in one slot (`-c 65536 --parallel 1`). The model was trained for 262,144
  (256k), so the window can grow at the cost of more cache memory. SparklingKit's default LLM uses the same
  64k (`--max-model-len 65536`).
- **Memory breakdown:**
  - 13.0 GiB on the GPU: about 7.3 GiB of weights, 0.9 GiB for the vision add-on, and roughly 4.8 GiB for the
    64k context cache and working buffers.
  - 8.5 GiB of process memory, mostly the memory-mapped GGUF file. The system can reclaim it, and
    `--no-mmap` avoids holding it next to the GPU copy. The chat's thinking control maps onto its template (`enable_thinking`,
`reasoning_effort`: low, medium, xhigh).
- **Mind maps need thinking off.** Twice on 2026-10-10 the mind-map job on six pages of prose failed with
  "The endpoint returned no content": Saluki's default-on reasoning consumed the module's whole
  8192-token completion budget and the answer came back empty. The same request with
  `chat_template_kwargs: {"enable_thinking": false}` returned valid JSON (four branches) in 32 s and
  529 tokens. Chat already exposes the thinking control; the mind-map executor should turn thinking off
  for a llama.cpp backend.

## Memory

Per container, with every service loaded and idle (`nvidia-smi` per process for GPU memory, `docker stats` for
the container's own RAM). The LLM was replaced by Saluki for this measurement, so its row is an estimate
from its configuration and the stack totals.

Rows for services this fork has since removed stay for the record and are marked; everything else was
measured with every service loaded and idle.

| Container | GPU | RAM | Total |
| --- | --- | --- | --- |
| `sparklingkit-qwen36` (Qwen3.6-35B-A3B, vLLM) — *removed from the stack 2026-10-10* | ≈ 27 GiB | ≈ 4 GiB | ≈ 31 GiB; about 60 GB while loading |
| `sparklingkit-image-generation` (Qwen-Image-2.1-Turbo, float8) | 17.1 GiB | 1.9 GiB | 19.0 GiB |
| `sparklingkit-qwen3-asr` — *removed from the stack 2026-10-10* | 12.6 GiB | 3.9 GiB | 16.5 GiB |
| `sparklingkit-parakeet` (the only ASR since 2026-10-10) | 1.5 GiB on start, 1.6–1.8 GiB during jobs | 0.2 GiB on start, up to 1.5 GiB during jobs | 1.7–3.4 GiB |
| `sparklingkit-locateanything` — *removed from the stack 2026-10-10* | 8.4 GiB | 2.5 GiB | 10.9 GiB |
| `sparklingkit-paddleocr-vlm` | 5.4 GiB | 3.6 GiB | 9.0 GiB |
| `sparklingkit-hy-mt2` | 2.4 GiB | 3.0 GiB | 5.4 GiB |
| `sparklingkit-paddleocr-vl` (layout, CPU) | — | 0.8 GiB | 0.8 GiB |
| `sparklingkit-app-1`, `sparklingkit-redis-1`, `sparklingkit-dgx-status` | — | 0.1 GiB together | 0.1 GiB |
| Saluki 27B in `llama-server` (the fork's reference LLM, run next to the stack) | 13.0 GiB | 8.5 GiB, reclaimable | 13–21.5 GiB |

| State | Used |
| --- | --- |
| Full stack starting up | 95.8 GiB peak |
| All seven services idle (Qwen3.6 LLM, Qwen-Image 2.1) | 84–86 GiB |
| One job per module, two running at a time (the app's worker concurrency) | 93.5 GiB peak |
| Saluki and Qwen-Image-2.1-Turbo in place of Qwen3.6 and Qwen-Image 2.1 | about 78 GiB with all services up |
| Parakeet in place of Qwen3-ASR, everything else unchanged (2026-10-10) | 14–15 GiB less; available memory went from 35 to 49 GiB |
| One job per module, with Saluki as the LLM and Parakeet as the ASR (2026-10-10) | 73.5 GiB peak; 92.4 GiB in a degenerate pass |
| Four-service stack: LLM, Qwen3-ASR and grounding removed (2026-10-10) | ≈ 29 GiB idle, ≈ 38 GiB at the old busy peak — derived by subtracting their rows above |

Parakeet's peak, about 1.8 GiB of GPU memory and 1.5 GiB of RAM, was measured during the 16.8-minute
transcription through the app with the 30 s chunk target. The 2026-10-10 load pass ran with Saluki as the
LLM (started by hand) and the mind map requested directly with thinking off, so its figures describe the
Saluki configuration, not the default Qwen3.6 LLM; the busy peak of Qwen3.6 plus Parakeet remains the
README's estimate. The 92.4 GiB peak belongs to the pass that ran before Hy-MT2's wedge was found (see
Known issues): the LLM spent its whole 8192-token budget on a reasoning trace while every translation
request hung.

## Known issues

- **The stock LLM can crash on long generations.**
  - vLLM 0.24 serving Qwen3.6-35B-A3B NVFP4 with MTP speculative decoding and `--async-scheduling` failed
    with `CUDA error: an illegal memory access` about 6,100 tokens into a long answer.
  - Docker then restarted it while the other services were resident. Its loading peak (about 42 GB of GPU
    memory plus a 16 GB staging buffer) did not fit, so the kernel's OOM killer stopped it, and other
    host processes with it, in a restart loop.
  - **Workaround:** stop the LLM service, then start it again before the other services, or with the image
    service stopped.
  - **Fixes under consideration:** a bounded restart policy, testing without `--async-scheduling`, or a
    llama.cpp LLM backend such as Saluki, which has no loading peak.
- **Parakeet occasionally skips a stretch of speech.** parakeet.cpp sometimes emits nothing for several
  seconds of clear speech, always in the same place for the same audio window, at every chunk length tested.
  - With 60 s chunks it skipped two sentences of about 7 s each in the English long file built with exact
    digital-zero gaps: 5.6% WER, against 4.1% for the whole file. Windows of 30–40 s around the first one
    kept it, which is why the app caps Parakeet's chunk target at 30 s.
  - The cap moved the problem rather than removing it. At 30 s the same file lost a different 14 s stretch
    (5.9%). With faint noise in the gaps the drops moved instead of disappearing: 8 words at the end of one
    chunk through the app (4.3%), and 13 words as one request (5.0%, against 4.1% with exact zeros). The
    Italian file lost nothing at 30 s.
- **Parakeet keeps its largest working memory.** A whole file sent straight to the adapter in one request
  raised the engine's GPU memory to 8.3 GiB (16.8 min of audio) or 12.1 GiB (8.7 min), and it stayed there
  until the container restarted. The app sends one chunk of about 30–38 s per request, so through the app
  it stays at 1.6–1.8 GiB.
- **parakeet.cpp v0.6.0 and v0.6.1 change none of this (checked 2026-10-10).** Built from source with the
  same flags and the same GGUF, v0.6.1 returned byte-identical transcripts to the pinned v0.5.0 on the
  English long file with both gap kinds (one request each), on the Italian long file (one request) and on
  both 30 s-chunked passes (17 and 34 chunks), and it held the same 12.3 GiB of GPU memory after a
  whole-file request. The releases' TDT beam-search fix and new VAD tooling do not reach the server's
  default greedy decode of this model, and the new server flags (`--concurrency`, which adds CPU backends,
  and `--sound-model`) do not affect the CUDA path. There is nothing to gain from repinning.
- **The translation service can wedge with a green health check.** On 2026-10-10 Hy-MT2 answered
  `GET /health` with 200 but every completion hung: a one-line request returned zero bytes within 120 s,
  and app jobs failed with "The operation was aborted due to timeout". The container had been up for
  days, so it most likely wedged during or after the OOM storms of 2026-10-05. `docker restart
  sparklingkit-hy-mt2` fixed it: a one-line translation answered in 1.5 s and a 20-page job then completed
  through the app. After the clean restart the service holds 3.9 GiB of GPU memory, against the 2.4 GiB
  the table above recorded while it was wedged. The health endpoint runs no inference, so only a real
  request catches this state.
- **Fixed in this fork:** model calls were cut off after exactly 300 s by Node's fetch timeouts. 2048² images
  and long translations on a busy GPU hit this.

## FastH3 video bake-off (2026-10-10)

One GPU window with the whole stack resident (Parakeet ASR, PaddleOCR-VL, Qwen-Image-2.1-Turbo,
LocateAnything, Hy-MT2; idle about 71 GiB of 121). Scripts, pins and raw logs: `~/sk-bench/fasth3` on the
Spark. Decides the runtime for the planned `text-to-video` module; the full grilling log and plan live in
`docs/superpowers/plans/2026-10-10-fasth3-video.md`.

**Runtime bake-off.**

| Contender | Outcome |
| --- | --- |
| Own diffusers adapter | Cannot load any FastH3 checkpoint: diffusers 0.41.0 and git main lack the Trim rank-16 AdaLN architecture (`norm_out.linear.weight` `[10752, 16]` vs `[10752, 2688]`), and transformers 5.19.0 and git main refuse every pre-quantized NVFP4 checkpoint — which all FastH3 distills bundle as their text encoder. Revisit on the next diffusers/transformers releases. |
| ComfyUI (pinned `0df64eb`), driven headlessly over its HTTP API | **Chosen.** Official t2v and i2v templates converted to API prompts (`comfy_bench.py`); runs in the production image-generation image (torch 2.10 cu130). |
| TensorFold int8 engine (Studio path) | Published numbers only (no install found): 7.1 s/pass at 480p, 183 s at 720p, ~195 s at 768p — but the Studio's ComfyUI setup holds ~70 GiB resident, which cannot coexist with our stack. Stays a documented fallback. |

**Chosen checkpoint set** (MiniMax H3 Community License, download gated): `FastVideo/FastVideo-FastH3-Trim-Comfy`
@ `f66c13dc` — Trim-8-Step NVFP4 DiT (19B, 11.9 GB), Qwen3-VL-32B NVFP4-AWQ text encoder (15.7 GB), int8
video VAE, fp32 audio VAE; about 31 GB on disk. Quality option: FastH3 V2-pruned-int8 DiT (22.1 GB,
`FastVideo/FastVideo-FastH3-Comfy` @ `ec1e3aa3`; the Comfy-Org copy of the same file is HF-gated) —
measured ~11 s/pass at 480p (~119 s a 5 s clip, cold) and ~25.5 s/pass at 720p (~238 s warm), about twice
the Trim times, with visibly sharper frames on the same seed (cleaner folds, droplet detail).

| Measurement (8 passes, seed 42, 24 fps, h264+AAC out) | Result |
| --- | --- |
| 864x480, 5 s clip (124 frames), warm | ~5.3 s/pass, ~66 s end-to-end |
| Same, cold after `POST /free` | +~11 s (weight reload) |
| 1280x736, 5 s clip | ~17 s/pass, ~169 s end-to-end |
| 1344x768, 5 s clip | ~176 s end-to-end |
| 1280x736, 8 s clip (192 frames) | ~28.6 s/pass, ~283 s end-to-end |
| Image-to-video (first-frame artifact), 864x480, 5 s | works, ~6.5 s/pass |
| Whole-job host peak above the resident stack | +32 GiB at 480p, +35 GiB at 720p/768p (idle 71 → ~105) |
| Unload | `POST /free {"unload_models": true}` returns ~30 GiB immediately |

Decision gates from the plan: staged peak ≤ ~40 GiB (measured 32–35) and speed within 2× the engine at 480p
(measured 5.3 s/pass vs the engine's 7.1 on a twice-bigger model; 720p wall-clock matches the engine's 183 s).
Prompt encoding (Qwen3-VL-32B) costs ~10 s per job. Two behaviours worth keeping for the module design:

- The first i2v run animated the template's example image until the prompt was rewritten to describe the
  actual first frame — prefill the i2v prompt from the image artifact's own prompt (lineage carries it).
- ComfyUI keeps all weights resident between jobs until `/free`; the service must unload after the warm TTL
  or the stack idles ~30 GiB heavier.

**Qwen-Image-2.1-Turbo quantization follow-up** (same window, `image_eval.py`): the Studio's ComfyUI image
path is not worth porting. An int8 text encoder changes nothing on GB10 (17.5 GiB peak either way — their
15 GiB figure is a Mac/MLX number and does not transfer to unified memory), and full bf16 costs 30.8 GiB
resident while cutting sampling at 1344x768 from 15.4 s to 10.3 s. Float8 stays the image backend default;
bf16 is a possible opt-in if 13 GiB are ever spare.
