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

## Memory

Per container, with every service loaded and idle (`nvidia-smi` per process for GPU memory, `docker stats` for
the container's own RAM). The LLM was replaced by Saluki for this measurement, so its row is an estimate
from its configuration and the stack totals.

| Container | GPU | RAM | Total |
| --- | --- | --- | --- |
| `sparklingkit-qwen36` (Qwen3.6-35B-A3B, vLLM) | ≈ 27 GiB | ≈ 4 GiB | ≈ 31 GiB; about 60 GB while loading |
| `sparklingkit-image-generation` (Qwen-Image-2.1-Turbo, float8) | 17.1 GiB | 1.9 GiB | 19.0 GiB |
| `sparklingkit-qwen3-asr` | 12.6 GiB | 3.9 GiB | 16.5 GiB |
| `sparklingkit-parakeet` (instead of `qwen3-asr`) | 1.5 GiB on start, 1.6–1.8 GiB during jobs | 0.2 GiB on start, up to 1.5 GiB during jobs | 1.7–3.4 GiB |
| `sparklingkit-locateanything` | 8.4 GiB | 2.5 GiB | 10.9 GiB |
| `sparklingkit-paddleocr-vlm` | 5.4 GiB | 3.6 GiB | 9.0 GiB |
| `sparklingkit-hy-mt2` | 2.4 GiB | 3.0 GiB | 5.4 GiB |
| `sparklingkit-paddleocr-vl` (layout, CPU) | — | 0.8 GiB | 0.8 GiB |
| `sparklingkit-app-1`, `sparklingkit-redis-1`, `sparklingkit-dgx-status` | — | 0.1 GiB together | 0.1 GiB |
| Saluki 27B in `llama-server` (instead of `qwen36`) | 13.0 GiB | 8.5 GiB, reclaimable | 13–21.5 GiB |

| State | Used |
| --- | --- |
| Full stack starting up | 95.8 GiB peak |
| All seven services idle (Qwen3.6 LLM, Qwen-Image 2.1) | 84–86 GiB |
| One job per module, two running at a time (the app's worker concurrency) | 93.5 GiB peak |
| Saluki and Qwen-Image-2.1-Turbo in place of Qwen3.6 and Qwen-Image 2.1 | about 78 GiB with all services up |
| Parakeet in place of Qwen3-ASR, everything else unchanged (2026-10-10) | 14–15 GiB less; available memory went from 35 to 49 GiB |

Parakeet's peak, about 1.8 GiB of GPU memory and 1.5 GiB of RAM, was measured during the 16.8-minute
transcription through the app with the 30 s chunk target.

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
- **Fixed in this fork:** model calls were cut off after exactly 300 s by Node's fetch timeouts. 2048² images
  and long translations on a busy GPU hit this.
