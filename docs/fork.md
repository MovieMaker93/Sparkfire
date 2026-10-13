# What Sparkfire changes

Sparkfire began as a fork of [SparklingKit](https://github.com/stevibe/SparklingKit) 0.1.5 by Steven Lei
(Apache 2.0) and is now its own project: a hard fork that credits upstream and picks up upstream fixes by
hand when they are useful. This file lists what it changes on top of SparklingKit; the README summarises
it. Measured results are in [`validation.md`](validation.md).

## Name and compatibility

- **Name.** The product is Sparkfire; Apache 2.0 section 6 does not grant use of the SparklingKit name, which
  appears only where it says where the code comes from. Upstream's [NOTICE](../NOTICE) is kept below
  Sparkfire's.
- **Renamed throughout.** The compose project, containers, images, job queues, browser storage keys,
  model-download markers and environment variables are all `sparkfire`. The start scripts remove the
  containers an install from before the rename left, which would otherwise keep running beside the new
  ones, and accept its download markers, so no model is downloaded again. Preferences kept in the browser
  (theme, sidebar, thinking level) start over once.
- **Installers.** Upstream's hosted installer (`distribution/`) is removed, because it installs upstream. Sparkfire installs from a clone; releases publish `ghcr.io/<owner>/sparkfire` and a
  DGX stack bundle.

## Interface

- **Themes.** All colours are tokens (`--sk-n0` to `--sk-n17` plus tinted families in `src/client/styles.css`):
  warm charcoal in the dark theme and warm paper in the light one, in place of upstream's cool grey.
  Settings → General → Appearance switches between Dark, Light and System. Graph canvases and the HTML
  preview take their colours from the same tokens.
- **Accent.** Primary actions, focus rings, the active navigation item and progress bars use one ember
  accent (`--sk-accent`). Progress bars run from it to a lighter tip (`--sk-accent-tip`) and shimmer while a
  worker is on the job, unless the system asks for reduced motion. The active page has an ember bar on its
  left edge. Warnings use a clear yellow, so they never read as the accent.
- **Type.** Geist for text, Bricolage Grotesque for headings and the wordmark, Geist Mono for code, all
  bundled from Fontsource.
- **Shape.** Corners come from three tokens (`--sk-radius-sm`, `-md`, `-lg`: 6, 9 and 14 px). Buttons are
  rounded rectangles rather than upstream's pills, and status badges are small tags.
- **Mark.** A flame with a sparkle cut out of it, in the accent colour. It sits beside the wordmark in the
  sidebar, the mobile header and onboarding, stays alone when the sidebar collapses, and is the favicon,
  the home-screen icon and the GitHub social preview (`.github/media/social-preview.png`).
- **Sidebar.** One "AI services" chip with a popover replaces the per-service status rows. The Spark monitor
  expands on click.
- **Optional tools.** Grounding, whose service the stack does not run, stays out of the sidebar, the Tools
  page, search, Continue with actions, the Workbench filters and tiles, the workflow palette and the services
  chip. Video does the same on a stack started with `--video-backend none`.
- **Fixed models.** Settings → Services shows each service of the stack, its model and where it runs, with a
  connection test, but nothing there can be edited, and onboarding has no **Configure manually**: it only asks
  whether the stack runs on this machine or another one.
- **Workbench.** A "Running now" strip, readable titles for UUID-named uploads, filter pills on one row,
  thumbnails in Recent, and a "Create a video" tile in place of "Find something in an image", which needs
  a grounding service the stack does not run.
- **Links.** The footer, the "Update available" check (this repository's GitHub releases, not upstream's
  manifest) and the onboarding install command point at Sparkfire.
- **Gallery** (`/gallery`). Every image and generated video across jobs, with source and model filters, a
  lightbox that plays videos, and a pick-two side-by-side compare.
- **Job viewers.**
  - Transcripts as timed lines, one per sentence with Parakeet, that seek the player.
  - Images with zoom, pan and a before/after slider for grounding results.
  - A heading outline for long documents.
  - A run history in the file sidebar.

API additions:

- `GET /api/jobs/:id/thumbnails/:artifactId?w=160|320|640` returns cached WebP previews of images, video
  frames and PDF first pages.
- `GET /api/gallery?source=&model=&offset=&limit=` lists images and generated videos across jobs.
- `GET /api/modules/text-to-image/capabilities` returns the sizes and step limits of the active image model.
- `GET /api/modules/text-to-video/capabilities` and `POST /api/modules/text-to-video/jobs` (multipart, with an
  optional `firstFrame` image): see [Video generation](#video-generation-fasth3).
- `GET /api/modules/text-to-music/capabilities` and `POST /api/modules/text-to-music/jobs` (JSON: `lyrics`,
  `style`, optional `seed`): see [Music generation](#music-generation-yue2).

## Chat

- **Thinking control.** Off, Low, Medium and High under the composer, remembered per browser. It is sent
  as `chat_template_kwargs`: `enable_thinking`, plus `reasoning_effort` (low, medium) for Qwen3.8-based
  models; High keeps the model's own default. Models without a thinking mode ignore it. Mind maps always
  ask with thinking off, so a reasoning model cannot spend their whole token budget thinking and return no map.
- **Reasoning.** It streams into a foldable block while the model thinks and is saved with the answer. It
  is not sent back to the model on later turns.
- **Attachments.** A + button, paste, or drag and drop add up to 8 files per message.
  - **Images** go to the model as image input (the newest four per request), when the LLM endpoint
    declares image input in Settings → Services.
  - **PDFs** send their text layer. Scans without one send their first pages as images.
  - **Text and code files** send their text, trimmed to 60,000 characters each.
- **Model name.** The header shows the configured LLM with a friendly name. Requests always use the
  configured model, so chats created before a model switch keep working.
- **Answers outlive the page.** The server generates each answer on its own, not inside the browser's
  request. Leaving the chat, switching pages or reloading no longer cuts the model off: the answer is saved
  when it finishes, and opening the chat again picks the stream back up where it is. Stop asks the server to
  end the answer and keeps what was written so far. A chat takes one answer at a time; a second message
  while one is running is refused.
- **Web search.** A **Web** switch under the composer lets the model search the web and read pages while it
  answers. New conversations start with it on, and the choice is saved with the chat.
  - **What it needs.** The stack's SearXNG, which the app reaches on the Spark's compose network, and a model
    that declares tool calling: Saluki does, with `llama-server --jinja`. A workspace on another machine has
    no SearXNG, so the switch stays hidden there.
  - **How it works.** The model gets two tools, `web_search` (five results: title, URL, snippet) and
    `fetch_page` (the page's main text through Readability, at most 24,000 characters). The server runs the
    calls and sends the results back, for at most 6 rounds per answer; then the model is asked once more
    without tools, so it answers from what it found. While web search is on, each request also carries a
    short system note with today's date (in the configured time zone) and the citation rule; it is never
    saved.
  - **Sources.** They are numbered across the whole answer, and the model cites them as `[n](url)`. A
    foldable block above the answer lists each search and page, then the numbered sources. It is saved on
    the answer as `activity`, shows again after a reload, and is never sent back to the model: a later
    question that needs fresh facts searches again.
  - **Safety.** `fetch_page` reads only http and https pages of text or HTML, up to 2 MB, in 15 seconds,
    through at most 3 redirects. It refuses any name or redirect that resolves to a loopback, private,
    link-local or other reserved address, checked on the address it connects to, so a page cannot steer
    the model into the local network. A failed search or page goes back to the model as an error it can
    work around.
  - **Privacy.** Searching sends what the conversation is about to the engines behind SearXNG (Google,
    Bing and others), without the user's identity, and pages are fetched from the Spark. Keep the switch
    off for conversations that must stay local.

API additions:

- `POST /api/chats/:id/attachments` (multipart `files`) stores files in `data/chats/<id>/attachments/`.
- `GET /api/chats/:id/attachments/:attachmentId` serves one back. Anything but images and PDFs is served as
  plain text.
- `POST /api/chats/:id/messages` also accepts `effort` and `attachmentIds`, and streams `reasoning` events
  next to `delta`. It answers 409 while the chat is still generating an answer.
- `GET /api/chats/:id/stream` follows the answer being generated: a `snapshot` of the text so far, then the
  same events as the message stream. It answers 204 when nothing is running.
- `POST /api/chats/:id/stop` stops the answer being generated; the partial answer is saved.
- `POST /api/chats/:id/messages` also accepts `webSearch` (saved on the chat) and streams `activity` events:
  each search or page read once when it starts and again with its result or error.
- `POST /api/web-search/test` runs a test query against the configured (or a given) SearXNG.
- Settings gain `webSearch: { enabled, provider, baseUrl }`, seeded from `WEB_SEARCH_BASE_URL`, and the LLM
  endpoint's capabilities may include `tools`.

## Model backends

Sparkfire's models are fixed: one per service, chosen and measured to share the Spark's memory
(`validation.md`). Users do not pick models, URLs or keys, and there are no start options that switch them;
only video can be left out, where its license does not apply.

| Service | Model |
|---|---|
| LLM (:8331) | Underdog Saluki 27B (`saluki-27b`), a 2-bit GGUF of Qwen3.8-27B with its vision add-on, in llama.cpp's `llama-server` |
| OCR (:8332) | PaddleOCR-VL-1.6 (layout adapter + vLLM VLM on :8342) |
| Speech (:8333) | Parakeet-TDT-0.6B-v3 (parakeet.cpp; CC BY 4.0; 25 European languages) |
| Translation (:8334) | Hy-MT2-1.8B-FP8 |
| Image (:8336) | Qwen-Image-2.1-Turbo (float8 weights, 8 fixed steps, 2K sizes; Qwen Research License) |
| Video (:8337) | FastH3 (MiniMax H3 Community License; not licensed in the EU, UK, South Korea or US): `--video-backend none` leaves it out |
| Music (:8339) | YuE2-3B (CC BY-NC 4.0 weights with a creator permission) |
| Web search (:8338) | SearXNG |

- **Saluki.** `services/dgx-models/llama-server` builds `llama-server` from llama.cpp `b11576` (pinned commit)
  for the GB10 (sm_121), on the same PyTorch base image as Parakeet. The start script downloads the GGUF and
  its vision add-on and starts Saluki first, with the flags its memory was measured with: `--jinja -ngl 99
  -fa on -c 65536 --parallel 1 --alias saluki-27b`. Its download takes the current revision (`main`) until
  its commit is pinned. It replaces upstream's bundled Qwen3.6 LLM, at half the memory and with no loading peak.
- **Every start applies the stack.** The app takes each model from `REFERENCE_SERVICE_CATALOG` and only the
  address from where the stack runs: the start scripts' environment first, then the host chosen in setup.
  Saved services, models and keys are replaced, and a save from Settings cannot change them. An install set up
  by hand goes through setup in the browser again. Upgraded installs therefore move to PaddleOCR-VL,
  Qwen-Image-2.1-Turbo and Saluki by themselves.
- **Retired.** Unlimited-OCR, Z-Image-Turbo and Qwen-Image 2.1 (40 steps) are no longer part of the stack;
  the start script removes the Unlimited-OCR container, and earlier model files stay in `data/dgx-models`
  until deleted. The adapters keep their profiles for those model ids. LocateAnything-3B, the grounding
  model, was removed with its 10.9 GiB and 7.3 GB; the grounding module stays in the code but has no service.

## Speech recognition: Parakeet

Parakeet TDT 0.6B v3 is the default speech model, run by [parakeet.cpp](https://github.com/mudler/parakeet.cpp)
(MIT) from the f16 GGUF in `mudler/parakeet-cpp-gguf`. The weights are NVIDIA's, under CC BY 4.0, which allows
commercial use with credit. It replaced this stack's earlier Qwen3-ASR backend: 1.7 GiB instead of
16.5 GiB, 10 to 16 times faster through the app on long files, and as accurate on short clips (3.6%
against 3.7% word error rate in English, 3.9% against 4.4% in Italian). Its limit is language: 25
European languages against Qwen3-ASR's 52; Qwen3-ASR was removed from the stack, but the app still
speaks its API for a user-configured endpoint.

- **Service.**
  - `sparkfire-parakeet` (image `sparkfire/parakeet:parakeet.cpp-v0.5.0`) builds the engine from
    pinned source for sm_121 and puts a small FastAPI adapter on :8333, so the app's endpoint is unchanged.
    The adapter starts the engine on 127.0.0.1:8343 and exits if it dies, so Docker restarts the container.
  - The engine serves one request at a time, and the adapter queues them. It accepts WAV only, which is
    what the app sends (16 kHz chunks); anything else gets a 400.
  - Both speech backends use :8333, so the start script stops the one you did not choose. It downloads only
    the chosen model, and only the one GGUF file of its repository, at a pinned revision.
- **Sentences.** Sparkfire picks the speech request from the model id. For Parakeet it asks for word
  timestamps and builds the output from them (`src/server/transcript-timing.ts`):
  - One transcript line per sentence, saved as `segments` in `transcript.json` next to the `words`. A
    pause of 1.5 s also ends a line, and the Markdown text starts a new paragraph at a pause of 2 s.
  - SRT and WebVTT cues end at a sentence end or before a pause of 0.8 s, and last at most 7 s and 84
    characters. Words are never split.
  - A dot before a lowercase word, after an abbreviation such as Mr. or Dr., or after a single initial does
    not end a sentence.
  - Other speech models keep the plain transcript: one line per chunk.
- **Chunks.** For Parakeet the app caps the processing window at 30 s (a chunk is about 30–38 s with its
  3 s overlap), because parakeet.cpp skipped whole utterances inside some 60 s chunks. The overlap between
  chunks is cut by word times, so no word appears twice.
- **Known issue.** parakeet.cpp occasionally drops a stretch of speech for a given audio window. See
  [`validation.md`](validation.md#known-issues).
- **Updating an existing install.** Saved settings are never rewritten. After the start script switches the
  service, choose `Parakeet-TDT-0.6B-v3` under Settings → Services → Speech to text. Until then,
  transcription still works, with minute-long lines.
- **Split mode.** `scripts/start-sparkfire.sh` with a model host seeds the Parakeet id, as do the
  other bundled model ids.
- **System monitor.** `services/dgx-status` reads `ASR_MODEL_NAME` (default `Parakeet-TDT-0.6B-v3`) to
  label the engine's GPU process.

## Video generation: FastH3

The Text to video module makes a short video with its own sound track from a prompt, and can start from an
image: upload one in the form, or hand over an image result with **Continue with → Create video**, which also
prefills the prompt that made the image. Videos are `generated-video` artifacts with lineage, play on the job
page and in the Gallery, and can be a workflow node.

- **Model.** FastH3, FastVideo's 8-step distill of MiniMax H3, in two variants that share the Qwen3-VL-32B
  NVFP4 text encoder and the video and audio decoders (about 53 GB in all):
  - **Fast:** FastH3 Trim, NVFP4 (`FastVideo/FastVideo-FastH3-Trim-Comfy`).
  - **Sharp:** FastH3 V2 pruned, int8 (`FastVideo/FastVideo-FastH3-Comfy`): about twice as slow, sharper.
  - Sizes 864 × 480, 1280 × 736 and 1344 × 768; 5, 8 or 10 seconds at 24 fps; H.264 video with AAC sound.
  - Optional sound and music fields go into the model's own prompt sections (`overall_soundscape`,
    `non_diegetic_music`).
- **Service.** `sparkfire-video-generation` on :8337 runs ComfyUI at a pinned commit on 127.0.0.1:8347,
  behind a FastAPI adapter, because no diffusers release loads FastH3 yet ([ADR 0002](adr/0002-video-service-comfyui.md)).
  - The adapter writes FastVideo's official FastH3 graphs with the requested values and returns the MP4 as
    the response body; the app streams it to disk.
  - Nothing loads until the first job. The weights are freed after `VIDEO_IDLE_UNLOAD_SECONDS` (default
    600) without a job, and before a job that needs the other variant, so only one diffusion model is ever
    resident. `POST /v1/unload` frees them at once.
  - Before each job the adapter checks free memory (`MemAvailable`) against what the job was measured to need:
    the variant's peak (Fast 48 GiB, Sharp 57 GiB) less its weights when that variant is already loaded (34 and
    44 GiB), plus 2 GiB. Short of it, it answers 503 with `Retry-After`, and the app waits and asks again.
  - The app runs heavy GPU jobs one at a time (`gpuLane` in the module contract, `src/server/gpu-lane.ts`),
    on their own queue so they never take the workers that OCR, chat and translation use. A second video
    waits, shown as "Waiting for the GPU", instead of loading next to the first. The same lane will take
    music generation, and switching between the two frees the other service's weights first.
  - Identical requests (prompt, seed and settings) return ComfyUI's cached result at once.
- **Disclosure.** The MiniMax H3 license asks that shared outputs be disclosed as machine-generated. Every
  MP4 carries the comment "AI-generated with MiniMax H3 (FastH3)", and the job page and the form show it.
  Commercial products built on it must also display "MiniMax H3".
- **Territory.** The license grants use only "worldwide, excluding" the European Union, the United Kingdom,
  South Korea and the United States. Deploy with `--video-backend none` there; onboarding then verifies the
  stack without video. LTX-2.5 (Lightricks, LTX-2.x Community License, worldwide) also makes video with sound
  and has official ComfyUI support, so it is the candidate for a second backend in the adapter's registry.
- **Updating an existing install.** The start script builds the service and
  downloads both checkpoint sets at pinned revisions. Saved settings gain the video endpoint automatically when it was empty.

## Music generation: YuE2

The Text to music module sings a song from lyrics and a style. It is part of the stack, and each song shows
the license line, because YuE2's weights are non-commercial.

- **Model.** [YuE2-3B](https://huggingface.co/m-a-p/YuE2-3B) from m-a-p (release `yue2-v0.1.6`) with its
  audio decoder `m-a-p/YuE2-Vae`, about 7.8 GB at pinned revisions. It writes the song as an ABC score
  (melody and chords), then sings it: 48 kHz stereo FLAC. Quality was judged very good in English, Italian and
  Mandarin (docs/validation.md).
- **Results.** A song job keeps the lyrics as `Lyrics.txt` and returns `song.flac` (`generated-audio`) and
  `score.abc` (`score`, a new artifact kind no other module is offered). Text from any module can become the
  lyrics; a score goes back into **Make a song** to be sung as written, with the lyrics and style of the song
  that wrote it unless new ones are given, so a melody can be edited or restyled. A workflow node takes the
  style and sings incoming text or a score. The run records the seed, duration and the weights' license,
  which the job page shows under the song.
- **Service.** `sparkfire-music-generation` on :8339 (`services/dgx-models/music`), a FastAPI adapter
  around the YuE2 package, built on the NGC PyTorch 26.07 image it was measured on. `POST
  /v1/music/generations` answers with `multipart/form-data`: the FLAC, the score and a JSON part with the
  seed, length and license.
  - Nothing loads until the first song (about 50 s); the weights are freed after `MUSIC_IDLE_UNLOAD_SECONDS`
    (default 600) or at once by `POST /v1/unload`. Before loading it checks that 22 GiB is free.
  - YuE2 moves its model to the CPU and its decoder to the GPU for every song, which suits a graphics card
    with its own memory. On the Spark's shared memory that move took 59 s of a 96 s song, so the adapter
    keeps both on the GPU: a 47-second song takes 51 s, with audio identical to YuE2's own path.
  - It sings one song at a time and stops a song when the app hangs up.
- **Heavy lane.** Music and video share the heavy GPU lane: they take turns, and switching from one to the
  other frees the previous service's weights first.
- **License.** Code Apache 2.0; weights CC BY-NC 4.0 with a creator permission: personal users and creators
  may publish and monetize their songs, academic use is non-commercial, companies need a license from m-a-p.

## Development

```bash
docker run -d --name sk-redis -p 6379:6379 redis:8-alpine
node scripts/seed-dev-data.mjs          # sample jobs, media and a chat in ./data (needs ffmpeg)
npm run dev
```

## Status

- **Unit tests** cover:
  - the image, PaddleOCR, Parakeet and video adapters, without a GPU
  - OCR and speech profiles, sentence and cue building, thumbnails, the gallery and the viewer helpers
  - chat thinking options, stream parsing, attachments, and answers that continue without the page
- **Validated on a DGX Spark:** PaddleOCR-VL-1.6, Parakeet TDT 0.6B v3, Qwen-Image 2.1 and its Turbo
  version, FastH3 video through the service, and the memory of the full stack. Results and known issues are in [`validation.md`](validation.md).

## Roadmap

1. **Pin Saluki:** pin its Hugging Face commit in `scripts/start-dgx-spark.sh`, and measure the
   `llama-server` image on the Spark.
2. **Safer LLM restarts:** the start script starts Saluki first; replace `restart: unless-stopped` with a
   bounded restart too, so a crash cannot turn into an out-of-memory loop.
3. **Image sizes:** make Qwen-Image-2.1-Turbo's 2K sizes the default for prompts with text.
4. **Security:**
   - Remove the open `cors()`.
   - Redact API keys in `GET /api/settings`.
   - Add a host allowlist and an optional access token.
   - Run the app and service containers as a non-root user (Trivy DS-0002); existing `data/` folders need
     their ownership migrated.
5. **Speed:** send OCR pages and ASR chunks with bounded concurrency.
6. **Long documents:**
   - Give chat and mind maps a token budget, then retrieval.
   - Add full-text search.
7. **Image editing** with Qwen-Image 2.1: reference images, masks, and grounding → edit.
