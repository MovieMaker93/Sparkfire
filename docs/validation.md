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

## Speech recognition: Parakeet vs Qwen3-ASR (evaluated, not integrated)

[parakeet.cpp](https://github.com/mudler/parakeet.cpp) v0.5.0 was built from source with CUDA for sm_121,
since there is no ARM64 CUDA release. It ran `parakeet-tdt-0.6b-v3` (f16). Both engines received the same
clips, one request at a time:
- **English:** the LibriSpeech dummy validation set, 73 clips, 8 min.
- **Italian:** the first 60 clips of FLEURS `it_it` dev, 16 min.

| | WER, English | WER, Italian | Speed | GPU memory |
| --- | --- | --- | --- | --- |
| Qwen3-ASR-1.7B (vLLM, current) | 3.7% | 4.4% | 7–14× realtime | about 12.6 GiB |
| Parakeet TDT 0.6B v3 (parakeet.cpp) | 3.6% | 3.9% | 134–248× realtime | 1.5 GiB |

- **Word timestamps:** Parakeet returns per-word timestamps and confidence when asked for
  `timestamp_granularities[]=word`, which would give word-accurate subtitles.
- **Limits:**
  - **Languages:** 25 European languages, against 52 for Qwen3-ASR.
  - **Server:** handles one request at a time.
  - **Input:** WAV only.

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
- **Fixed in this fork:** model calls were cut off after exactly 300 s by Node's fetch timeouts. 2048² images
  and long translations on a busy GPU hit this.
