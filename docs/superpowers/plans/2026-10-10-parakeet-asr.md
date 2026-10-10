# Parakeet ASR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Parakeet TDT 0.6B v3 (parakeet.cpp) the fork's default speech recognition service on :8333, keep
Qwen3-ASR as `--asr-backend qwen3-asr`, and turn Parakeet's word timestamps into one transcript line per
sentence and subtitle-sized SRT/VTT cues.

**Architecture:** A thin FastAPI adapter in front of `parakeet-server` gives the app the same endpoint shape
as today. The app picks an ASR profile from the model id; with the `parakeet` profile it asks for word
timestamps, and pure functions in `src/server/transcript-timing.ts` join chunk words and build sentences,
cues and paragraphs. Without words, the output is unchanged.

**Tech Stack:** TypeScript (Node ESM, vitest), Python 3.12 (FastAPI, httpx, unittest), parakeet.cpp v0.5.0
built with CUDA for sm_121, Docker Compose, bash.

**Spec:** `docs/superpowers/specs/2026-10-10-parakeet-asr-design.md`

## Global Constraints

- parakeet.cpp tag `v0.5.0`, commit `1bfbebfaaf493866f49597cd3b7901959d395c60`; CMake
  `-DPARAKEET_GGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121`.
- Base image `nvcr.io/nvidia/pytorch:25.11-py3@sha256:4a85d8cf6fb3a943280960b8948cf4e9b6eca77b4414c68c9b2c7bb863f79b70`
  (the digest the other GPU images use).
- Model `mudler/parakeet-cpp-gguf`, revision `741158ae71e64ef5c89385862c18f777d07a97a1`, file
  `tdt-0.6b-v3-f16.gguf` only, stored under `data/dgx-models/mudler/parakeet-cpp-gguf/`.
- Model id `Parakeet-TDT-0.6B-v3`; container `sparklingkit-parakeet`; image
  `sparklingkit/parakeet:parakeet.cpp-v0.5.0`; adapter port 8333, engine port 8343 (127.0.0.1 only).
- Timing values: sentence pause 1.5 s; cue pause 0.8 s; cue caps 7 s and 84 characters; paragraph pause 2 s.
- Non-WAV error text, exactly: `Upload WAV audio; SparklingKit sends 16 kHz WAV chunks`.
- Python requirements pinned: `fastapi==0.124.4`, `uvicorn[standard]==0.38.0`, `python-multipart==0.0.30`,
  `httpx==0.28.1`.
- AGENTS.md rules: server imports end in `.js`; LF line endings; Conventional Commits; commit with
  `git -c user.name=MovieMaker93 -c user.email=57877156+MovieMaker93@users.noreply.github.com commit`, no
  Co-Authored-By trailer; no host names, home paths or container names of other workloads in tracked files.
- Push, PRs and anything that stops a running service only after the user's explicit OK.

## Review Focus

1. **Abbreviations and initials** ("Mr. Quilter", "J. Smith", "etc. and"): no sentence break after them.
   Test in Task 4.
2. **Word times that jitter across a chunk seam** (one chunk says 13.48 s, the next 13.53 s for the same
   word, seam at 13.5 s): the word appears exactly once, never twice and never zero times. Test in Task 4.
3. **Punctuation returned as its own word token** (`"classes"`, `","`): the text reads "classes," and
   sentence ends still work. Test in Task 4.
4. **A silent chunk between spoken ones** (`words: []`): the job keeps word-timed output instead of falling
   back to minute-long blocks. Test in Task 6.
5. **An existing install whose saved speech model is still `Qwen3-ASR-1.7B`** after the service switches to
   Parakeet (settings from the environment only seed a new file): transcription keeps working with
   chunk-level timing because the adapter ignores `model`, and the docs say how to switch. Test in Task 1;
   docs in Task 8.

---

### Task 1: Parakeet adapter

**Files:**
- Create: `services/dgx-models/parakeet/parakeet_server.py`
- Create: `services/dgx-models/parakeet/requirements.txt` (the four pins above)
- Test: `services/dgx-models/parakeet/test_parakeet_server.py`
- Modify: `.github/workflows/ci.yml` (adapters matrix gets `services/dgx-models/parakeet`; the install step
  becomes `pip install fastapi uvicorn python-multipart httpx`)
- Modify: `.github/dependabot.yml` (`/services/dgx-models/parakeet` in the pip and docker directories)

**Interfaces:**
- Produces:
  - `class Engine(base_url: str)` with `async healthy() -> bool` and
    `async transcribe(audio: bytes, filename: str, fields: list[tuple[str, str]]) -> tuple[int, bytes, str]`
    (status, body, content type). Each `Engine` owns an `asyncio.Lock` that serializes `transcribe`. An
    unreachable engine gives `(503, b'{"detail":"The Parakeet engine is not reachable"}', "application/json")`.
  - `is_wav(data: bytes) -> bool`: `RIFF` at 0 and `WAVE` at 8.
  - `FORWARDED_FIELDS = ("response_format", "timestamp_granularities[]")`
  - `create_app(engine: Engine, model_name: str) -> FastAPI` with `GET /health`, `GET /v1/models`,
    `POST /v1/audio/transcriptions`.
  - `watch_engine(process, on_exit: Callable[[int], None], interval: float = 1.0) -> threading.Thread`:
    a daemon thread that calls `on_exit(code)` once `process.poll()` returns a code.
  - `main()`: env `PORT` (8333), `ENGINE_PORT` (8343), `ENGINE_BINARY` (`/usr/local/bin/parakeet-server`),
    `MODEL_PATH` (required), `MODEL_NAME` (`Parakeet-TDT-0.6B-v3`). Starts
    `[ENGINE_BINARY, "--model", MODEL_PATH, "--host", "127.0.0.1", "--port", ENGINE_PORT]` with the
    adapter's environment (dgx-status reads `MODEL_NAME` from it), watches it with `on_exit=os._exit`
    semantics (exit code 1), then serves uvicorn on `0.0.0.0:PORT`. `/health` stays 503 until the engine
    answers, which is what readiness checks wait on.

- [ ] **Step 1: Write the failing tests**

A fake engine: `http.server.ThreadingHTTPServer` on port 0 in a daemon thread. It records the raw body of
each POST, answers `GET /health` with 200 (or 500 when `FakeEngine.down` is set), sleeps 0.2 s per POST,
tracks the most requests in flight at once, and replies with a JSON body and a status the test chooses.
Routes are tested with `fastapi.testclient.TestClient`. `WAV` is a 44-byte RIFF/WAVE header plus silence.

```python
def test_health_follows_the_engine(self):          # 200 with engine up; 503 after FakeEngine.down = True
def test_models_lists_the_configured_name(self):   # {"object": "list", "data": [{"id": "Parakeet-TDT-0.6B-v3", "object": "model"}]}
def test_forwards_format_and_every_granularity(self):
    # POST file=WAV, model="Qwen3-ASR-1.7B", temperature="0", response_format="verbose_json",
    # timestamp_granularities[]="word" and ="segment"
    body = FakeEngine.bodies[-1]
    self.assertIn(b"verbose_json", body)
    self.assertEqual(body.count(b'name="timestamp_granularities[]"'), 2)
    self.assertNotIn(b'name="model"', body)
    self.assertNotIn(b'name="temperature"', body)
    # and the client receives the engine's JSON unchanged with status 200
def test_returns_engine_errors_unchanged(self):    # engine replies 500 {"error": "boom"} -> client sees 500 and that body
def test_refuses_audio_that_is_not_wav(self):      # b"ID3..." -> 400, detail == "Upload WAV audio; SparklingKit sends 16 kHz WAV chunks", FakeEngine.bodies == []
def test_engine_down_gives_503(self):              # Engine("http://127.0.0.1:9") -> transcription status 503
def test_requests_run_one_at_a_time(self):
    engine = server.Engine(self.engine_url)
    async def both():
        return await asyncio.gather(engine.transcribe(WAV, "a.wav", []), engine.transcribe(WAV, "b.wav", []))
    statuses = [status for status, _, _ in asyncio.run(both())]
    self.assertEqual(statuses, [200, 200])
    self.assertEqual(FakeEngine.max_in_flight, 1)
def test_watcher_reports_the_engine_exit(self):    # fake process whose poll() yields None, None, 7 -> on_exit called once with 7
```

- [ ] **Step 2: Run them to make sure they fail**

Run (Windows, once): `python -m venv "$SCRATCH/venv" && "$SCRATCH/venv/Scripts/pip" install fastapi uvicorn python-multipart httpx`,
then from `services/dgx-models/parakeet`: `"$SCRATCH/venv/Scripts/python" -m unittest -v`
Expected: errors with `ModuleNotFoundError: No module named 'parakeet_server'`.

- [ ] **Step 3: Implement `parakeet_server.py`** to the interfaces above. The route reads
  `await request.form()`, takes the `file` upload, checks `is_wav`, collects
  `[(key, value) for key in FORWARDED_FIELDS for value in form.getlist(key)]`, and returns
  `Response(body, status_code=status, media_type=content_type)`. `Engine.transcribe` posts multipart with
  httpx (timeout 30 min) inside `async with self._lock`.

- [ ] **Step 4: Run the tests to make sure they pass**

Same command. Expected: 8 tests, `OK`.

- [ ] **Step 5: Commit**

```bash
git add services/dgx-models/parakeet .github/workflows/ci.yml .github/dependabot.yml
git commit -m "feat(asr): add a Parakeet adapter with the OpenAI transcription route"
```

---

### Task 2: Parakeet image and compose service, built on the Spark

**Files:**
- Create: `services/dgx-models/parakeet/Dockerfile`, `services/dgx-models/parakeet/.dockerignore`
  (`__pycache__`, `test_*.py`)
- Modify: `compose.dgx.yaml` (new `parakeet` service after `qwen3-asr`)
- Test: `src/server/deployment.test.ts`
- Create: `src/server/fixtures/parakeet-verbose.json` (a real engine response, used by Task 5)

**Interfaces:**
- Consumes: Task 1's `parakeet_server.py` and its env names.
- Produces: the image `sparklingkit/parakeet:parakeet.cpp-v0.5.0`; the compose service `parakeet`; the
  fixture file (top-level `text` and `words: [{word, start, end, conf}]` as parakeet-server returns them).

- [ ] **Step 1: Write the failing test** in `deployment.test.ts`, next to the Hy-MT2 one:

```ts
it("keeps the Parakeet image tag aligned with the pinned parakeet.cpp release", async () => {
  // reads services/dgx-models/parakeet/Dockerfile and compose.dgx.yaml
  expect(dockerfile.match(/ARG PARAKEET_REF=(\S+)/)?.[1]).toBe("v0.5.0");
  expect(dockerfile).toContain("ARG PARAKEET_COMMIT=1bfbebfaaf493866f49597cd3b7901959d395c60");
  expect(compose.match(/image:\s+sparklingkit\/parakeet:parakeet\.cpp-(\S+)/)?.[1]).toBe("v0.5.0");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/server/deployment.test.ts`
Expected: FAIL, `ENOENT` for the Dockerfile.

- [ ] **Step 3: Write the Dockerfile and the compose service**
  - Build stage `FROM ${PYTORCH_IMAGE} AS build`: clone the tag with submodules, fail the build unless
    `git rev-parse HEAD` equals `PARAKEET_COMMIT`, configure with the constraint flags plus
    `-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF`, build only `parakeet-server` with `-j 8`.
  - Runtime stage on the same base: copy the binary to `/usr/local/bin/parakeet-server` (plus any `.so` it
    still needs), install `requirements.txt`, copy `parakeet_server.py` to `/app`,
    `CMD ["python3", "/app/parakeet_server.py"]`.
  - Compose `parakeet`: comment "Default ASR backend (SPARKLINGKIT_ASR_BACKEND=parakeet); replaces qwen3-asr
    on :8333"; `build.context`, `image`, `container_name`, `restart: unless-stopped`, `network_mode: host`;
    env `NVIDIA_VISIBLE_DEVICES: all`, `NVIDIA_DRIVER_CAPABILITIES: compute,utility`,
    `MODEL_PATH: /models/mudler/parakeet-cpp-gguf/tdt-0.6b-v3-f16.gguf`, `MODEL_NAME`, `PORT: "8333"`,
    `ENGINE_PORT: "8343"`; volume `./data/dgx-models:/models:ro`; the GPU reservation block the other
    services use; healthcheck `curl -fsS http://127.0.0.1:8333/health`, `start_period: 1m`.

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/server/deployment.test.ts` → PASS.

- [ ] **Step 5: Build and smoke-test on the Spark, beside the running stack**
  1. `ssh spark 'free -g; docker ps --format "{{.Names}}"'`: continue only with ≥ 12 GiB available.
  2. Copy the branch with a git bundle (`git bundle create`, `scp`, then on the Spark
     `git fetch <bundle> feat/parakeet-asr:feat/parakeet-asr`); build from a temporary
     `git worktree add` so the running checkout stays on `main`:
     `docker compose -p sparklingkit -f compose.yaml -f compose.spark.yaml -f compose.dgx.yaml build parakeet`.
  3. `docker run --rm sparklingkit/parakeet:parakeet.cpp-v0.5.0 sh -c 'ldd /usr/local/bin/parakeet-server | grep -c "not found"'` → `0`.
  4. Download the model the way Task 3's `download_model` will:
     `... --profile tools run --rm --no-deps --user "$(id -u):$(id -g)" model-downloader download mudler/parakeet-cpp-gguf --revision 741158ae71e64ef5c89385862c18f777d07a97a1 --include tdt-0.6b-v3-f16.gguf --local-dir /models/mudler/parakeet-cpp-gguf`,
     run from the main checkout so the file lands in its `data/dgx-models`.
  5. Run the image on spare ports: `docker run -d --name parakeet-smoke --gpus all --network host -e PORT=18333 -e ENGINE_PORT=18343 -e MODEL_PATH=/models/mudler/parakeet-cpp-gguf/tdt-0.6b-v3-f16.gguf -v <main checkout>/data/dgx-models:/models:ro sparklingkit/parakeet:parakeet.cpp-v0.5.0`;
     wait until `curl -fsS 127.0.0.1:18333/health` answers.
  6. Capture the fixture from a ~10 s LibriSpeech clip (from `scripts/media/demo-audio.py`'s source or
     `~/sk-bench`), converted to 16 kHz mono WAV:
     `curl -fsS -F file=@clip.wav -F response_format=verbose_json -F 'timestamp_granularities[]=word' 127.0.0.1:18333/v1/audio/transcriptions`.
     Save it as `src/server/fixtures/parakeet-verbose.json` (pretty-printed, LF). Check by eye: words carry
     their punctuation or punctuation comes as separate tokens; note which in the commit body.
  7. `docker rm -f parakeet-smoke`; remove the worktree.

- [ ] **Step 6: Commit**

```bash
git add services/dgx-models/parakeet/Dockerfile services/dgx-models/parakeet/.dockerignore compose.dgx.yaml src/server/deployment.test.ts src/server/fixtures/parakeet-verbose.json
git commit -m "feat(asr): package parakeet.cpp for the DGX Spark"
```

---

### Task 3: Stack wiring (start script, defaults, status, switch)

**Files:**
- Modify: `scripts/start-dgx-spark.sh`
- Modify: `compose.dgx.yaml` (app env `STT_MODEL: ${STT_MODEL:-Parakeet-TDT-0.6B-v3}`)
- Modify: `src/shared/reference-stack.ts` (`stt.model: "Parakeet-TDT-0.6B-v3"`)
- Test: `src/shared/reference-stack.test.ts`
- Modify: `services/dgx-status/server.py`; Test: `services/dgx-status/test_server.py`
- Modify: `scripts/spark-switch.sh` (`parakeet` in the `sparklingkit_running` regex)

**Interfaces:**
- Consumes: the compose service `parakeet` (Task 2).
- Produces: `--asr-backend parakeet|qwen3-asr` and `SPARKLINGKIT_ASR_BACKEND`; `STT_MODEL` exported for
  compose; `download_model REPO REVISION DEST [INCLUDE]`.

- [ ] **Step 1: Write the failing tests**

```ts
// reference-stack.test.ts
it("points speech recognition at the Parakeet service", () => {
  const settings = referenceSettingsForHost(defaults, "192.0.2.10", "all-in-one");
  expect(settings.endpoints.stt.model).toBe("Parakeet-TDT-0.6B-v3");
});
```

```python
# test_server.py: a fake /proc with pid 4242 whose cmdline is
# parakeet-server --model /models/x.gguf --host 127.0.0.1 --port 8343
# and whose environ holds MODEL_NAME=Parakeet-TDT-0.6B-v3 and PORT=8333 (no status file, so no parent)
def test_names_the_parakeet_engine_as_asr(self):
    server.PROC_ROOT = Path(self.proc)   # restore in tearDown
    self.assertEqual(server.resolve_process_service(4242),
                     {"service": "asr", "serviceLabel": "ASR", "port": 8343, "model": "Parakeet-TDT-0.6B-v3"})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/shared/reference-stack.test.ts` → FAIL (`Qwen3-ASR-1.7B`).
Run from `services/dgx-status`: `"$SCRATCH/venv/Scripts/python" -m unittest -v` → FAIL (service `None`).

- [ ] **Step 3: Implement**
  - `reference-stack.ts`: the new model id.
  - `dgx-status/server.py`: `SERVICE_BY_PORT[int(os.getenv("ASR_ENGINE_PORT", "8343"))] = {"id": "asr", "label": "ASR"}`,
    with a comment like the PaddleOCR one.
  - `start-dgx-spark.sh`:
    - `ASR_BACKEND="${SPARKLINGKIT_ASR_BACKEND:-parakeet}"`; usage line
      `--asr-backend NAME       parakeet (default) or qwen3-asr`; parse it in the existing
      `--ocr-backend|--image-backend` branch.
    - `case`: `parakeet` → `ASR_SERVICE=parakeet ASR_READY_URL=http://127.0.0.1:8333/health`,
      `export STT_MODEL="Parakeet-TDT-0.6B-v3"`; `qwen3-asr` → `ASR_SERVICE=qwen3-asr`,
      `ASR_READY_URL=http://127.0.0.1:8333/v1/models`, `export STT_MODEL="Qwen3-ASR-1.7B"`; anything else →
      `Unknown ASR backend: %s (use parakeet or qwen3-asr)`, exit 2. Export `SPARKLINGKIT_ASR_BACKEND`.
      (Parakeet's `/v1/models` answers before the engine has loaded; `/health` does not.)
    - The CUDA 13 `ptxas` check runs only for `qwen3-asr` (only that service mounts it).
    - `build_targets` uses `"$ASR_SERVICE"` instead of `qwen3-asr`.
    - `download_model`: optional 4th argument passed as `--include "$4"`; validation also accepts any
      `*.gguf` in the destination (`compgen -G`).
    - Downloads: Parakeet with the constraint values and `tdt-0.6b-v3-f16.gguf`, or Qwen3-ASR as today.
    - Before starting ASR, `"${COMPOSE[@]}" stop` the other ASR service; before starting OCR, stop
      `unlimited-ocr` (for paddleocr-vl) or `paddleocr-vl paddleocr-vlm` (for unlimited-ocr). Then
      `start_service "$ASR_SERVICE" "Transcription ($ASR_BACKEND)" "$ASR_READY_URL" 600`.
    - `stop --models-only` lists `parakeet` too.
  - `compose.dgx.yaml` app env and `spark-switch.sh` regex as listed above.

- [ ] **Step 4: Run the tests and the script checks**
  - Both test commands above → PASS.
  - `bash scripts/start-dgx-spark.sh --asr-backend nope; echo $?` → the "Unknown ASR backend" line, then `2`.
  - `bash scripts/start-dgx-spark.sh --help | grep asr-backend` → the usage line.
  - On the Spark (Docker there): `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.10.0 --severity=error scripts/start-dgx-spark.sh scripts/spark-switch.sh` → no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/start-dgx-spark.sh scripts/spark-switch.sh compose.dgx.yaml src/shared/reference-stack.ts src/shared/reference-stack.test.ts services/dgx-status/server.py services/dgx-status/test_server.py
git commit -m "feat(dgx): make Parakeet the default speech backend of the start script"
```

---

### Task 4: Transcript timing functions

**Files:**
- Create: `src/server/transcript-timing.ts`
- Test: `src/server/transcript-timing.test.ts`
- Modify: `src/server/ai.ts` (add the `TimedWord` type next to `TranscriptSegment`)

**Interfaces:**
- Produces:
  - in `ai.ts`: `export interface TimedWord { word: string; start: number; end: number }` (absolute seconds)
  - in `transcript-timing.ts`, which imports `TimedWord` and `TranscriptSegment` as types from `./ai.js`:
  - `export interface WordChunk { start: number; end: number; words: TimedWord[] }`
  - `joinChunkWords(chunks: WordChunk[]): TimedWord[]`
  - `toSentences(words: TimedWord[]): TranscriptSegment[]`
  - `toCues(words: TimedWord[]): TranscriptSegment[]`
  - `toParagraphs(sentences: TranscriptSegment[]): string`
  - Constants `SENTENCE_PAUSE_SEC = 1.5`, `CUE_PAUSE_SEC = 0.8`, `CUE_MAX_SEC = 7`, `CUE_MAX_CHARS = 84`,
    `PARAGRAPH_PAUSE_SEC = 2`.

Rules the tests pin:
- **Join.** Chunks come in timeline order. For each chunk, `seam` is the middle of its overlap with the next
  chunk (`(next.start + chunk.end) / 2`, `Infinity` for the last). Keep the chunk's words that start before
  its seam *and* whose midpoint lies after the end of the last word already kept. The second condition
  drops a later chunk's copy of a word the earlier chunk kept, and recovers a word the earlier chunk lost
  because its start jittered past the seam.
- **Sentence end** after word *i*: the word ends in `.`, `?`, `!` or `…` (closing quotes or brackets may
  follow), it is not an abbreviation (`Mr Mrs Ms Dr Prof St Jr Sr vs etc e.g i.e Sig Sig.ra Dott ecc`,
  compared without the final dot, case-insensitive) or a single letter, and the next word does not start
  with a lowercase letter. A pause of at least 1.5 s before a word also ends a sentence.
- **Cue end:** a sentence end, a pause of at least 0.8 s, or the next word would make the cue last more than
  7 s or exceed 84 characters. A word alone over a cap is its own cue.
- **Text:** words join with one space, except a token made only of closing punctuation
  (`. , ; : ! ? … ) ] } " ” ’`) attaches to the word before it. Segment `start`/`end` are the first word's
  start and the last word's end.
- **Paragraphs:** sentences join with a space; a gap of at least 2 s between one sentence's end and the
  next one's start becomes a blank line.

- [ ] **Step 1: Write the failing tests** (`const w = (word, start, end = start + 0.3) => ({ word, start, end })`)

```ts
describe("joinChunkWords", () => {
  it("keeps a word heard by two overlapping chunks once", () => {
    const words = joinChunkWords([
      { start: 0, end: 15, words: [w("one", 1), w("two.", 12.5), w("three", 14.2)] },
      { start: 12, end: 30, words: [w("two.", 12.52), w("three", 14.21), w("four", 20)] },
    ]);
    expect(words.map((x) => x.word)).toEqual(["one", "two.", "three", "four"]);
    expect(words[2].start).toBe(14.21);
  });
  it("keeps a word whose start jitters across the seam exactly once", () => {
    // seam 13.5; first case A says 13.48 and B 13.53, second case A says 13.53 and B 13.47
    expect(joinChunkWords([{ start: 0, end: 15, words: [w("a", 10), w("seam", 13.48)] }, { start: 12, end: 30, words: [w("seam", 13.53), w("b", 20)] }]).map((x) => x.word)).toEqual(["a", "seam", "b"]);
    expect(joinChunkWords([{ start: 0, end: 15, words: [w("a", 10), w("seam", 13.53)] }, { start: 12, end: 30, words: [w("seam", 13.47), w("b", 20)] }]).map((x) => x.word)).toEqual(["a", "seam", "b"]);
  });
  it("keeps every word when chunks do not overlap", () => { /* chunks 0–10 and 11–20 */ });
  it("returns no words for no chunks", () => expect(joinChunkWords([])).toEqual([]));
});

describe("toSentences", () => {
  it("ends sentences after . ? ! and …", () => { /* "Hi." "Yes?" "No!" "Well…" -> 4 sentences */ });
  it("ends a sentence before a pause of 1.5 s, not 1.4 s", () => { /* gap 1.5 -> 2 sentences; gap 1.4 -> 1 */ });
  it("does not end a sentence after an abbreviation, an initial or before a lowercase word", () => {
    expect(texts(["Mr.", "Quilter", "is", "here."])).toEqual(["Mr. Quilter is here."]);
    expect(texts(["J.", "Smith", "came."])).toEqual(["J. Smith came."]);
    expect(texts(["apples", "etc.", "and", "pears."])).toEqual(["apples etc. and pears."]);
  });
  it("attaches punctuation tokens to the word before them", () => {
    expect(texts(["classes", ",", "we", "agree", ".", "Next", "one", "."])).toEqual(["classes, we agree.", "Next one."]);
  });
  it("times a sentence from its first word's start to its last word's end", () => { /* start 1, end 2.3 */ });
  it("returns no sentences for no words", () => expect(toSentences([])).toEqual([]));
});

describe("toCues", () => {
  it("never runs past 7 s or 84 characters and never splits a word", () => {
    const words = Array.from({ length: 60 }, (_, i) => w(`word${i}`, i * 0.4, i * 0.4 + 0.35));
    const cues = toCues(words);
    for (const cue of cues) { expect(cue.end - cue.start).toBeLessThanOrEqual(7); expect(cue.text.length).toBeLessThanOrEqual(84); }
    expect(cues.flatMap((cue) => cue.text.split(" "))).toEqual(words.map((x) => x.word));
  });
  it("cuts at every sentence end and at pauses of 0.8 s", () => { /* each toSentences boundary is a cue boundary; a 0.8 s gap cuts, 0.7 s does not */ });
  it("puts a word longer than the caps in a cue of its own", () => { /* 90-character word between two short words -> 3 cues */ });
});

describe("toParagraphs", () => {
  it("starts a new paragraph after a pause of 2 s", () => {
    expect(toParagraphs([{ start: 0, end: 1, text: "A." }, { start: 1.5, end: 2, text: "B." }, { start: 4, end: 5, text: "C." }])).toBe("A. B.\n\nC.");
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/server/transcript-timing.test.ts`
Expected: FAIL, cannot resolve `./transcript-timing.js`.

- [ ] **Step 3: Implement `transcript-timing.ts`** to the interfaces and rules above. One shared
  `endsSentence(words, index)` and one `joinWords(words)` serve both `toSentences` and `toCues`.

- [ ] **Step 4: Run the tests to make sure they pass**

Same command → PASS. Then `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/transcript-timing.ts src/server/transcript-timing.test.ts src/server/ai.ts
git commit -m "feat(asr): build sentences, subtitle cues and paragraphs from word timestamps"
```

---

### Task 5: ASR profile and word timestamps in `transcribeAudio`

**Files:**
- Modify: `src/server/ai.ts` (`asrProfile`, `transcribeAudio`)
- Test: `src/server/ai.test.ts` (describe "ASR requests")

**Interfaces:**
- Consumes: `TimedWord` (Task 4); `src/server/fixtures/parakeet-verbose.json` (Task 2).
- Produces:
  - `export type AsrProfile = "parakeet" | "default"`; `asrProfile(model: string): AsrProfile`
    (`/parakeet/i`).
  - `transcribeAudio(...)` keeps its parameters and now returns
    `{ text: string; segments: TranscriptSegment[]; words?: TimedWord[] }`. With the `parakeet` profile
    `words` is always an array (empty for silence): top-level `payload.words`, or else the `words` of each
    segment; each word trimmed, empty ones dropped, `start` shifted by `offset`, `end` defaulting to
    `start`. The default profile's request and result are unchanged (`words` undefined).

- [ ] **Step 1: Write the failing tests**

```ts
it("chooses the ASR profile from the model id", () => {
  expect(asrProfile("Parakeet-TDT-0.6B-v3")).toBe("parakeet");
  expect(asrProfile("nvidia/parakeet-tdt-0.6b-v3")).toBe("parakeet");
  expect(asrProfile("Qwen3-ASR-1.7B")).toBe("default");
});
it("asks Parakeet for word timestamps and shifts them by the chunk offset", async () => {
  // jsonServer returns the fixture; transcribeAudio(..., model "Parakeet-TDT-0.6B-v3", offset 60)
  expect(body).toContain('name="response_format"'); expect(body).toContain("verbose_json");
  expect(body).toContain('name="timestamp_granularities[]"');
  expect(result.words!.length).toBe(fixture.words.length);
  expect(result.words![0]).toEqual({ word: fixture.words[0].word.trim(), start: fixture.words[0].start + 60, end: fixture.words[0].end + 60 });
});
it("reads words nested in segments and drops empty ones", async () => {
  // server: { text: "Hi", segments: [{ start: 0, end: 1, text: "Hi", words: [{ word: " Hi ", start: 0.1, end: 0.3 }, { word: "", start: 0.4, end: 0.5 }] }] }
  expect(result.words).toEqual([{ word: "Hi", start: 10.1, end: 10.3 }]);   // offset 10
});
it("keeps the plain JSON request for other models", async () => {
  // model "test-asr"
  expect(body).not.toContain("timestamp_granularities"); expect(body).not.toContain("verbose_json");
  expect(result.words).toBeUndefined();
});
```

The request body is captured the way the existing "sends the configured completion-token limit" test does.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/server/ai.test.ts`
Expected: FAIL, `asrProfile` is not exported.

- [ ] **Step 3: Implement** `asrProfile` beside `ocrProfile`, and the profile branch in `transcribeAudio`
  (the form gets `response_format=verbose_json` and one `timestamp_granularities[]=word` instead of
  `response_format=json`). Update the comment above the form fields to say which profile sends what.

- [ ] **Step 4: Run the tests to make sure they pass**

Same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai.ts src/server/ai.test.ts
git commit -m "feat(asr): request word timestamps from Parakeet"
```

---

### Task 6: Word-timed transcripts in `processAudio`

**Files:**
- Modify: `src/server/processor.ts` (`TranscriptResult`, `transcribeChunk`, `processAudio`)
- Test: `src/server/word-timed-transcription.test.ts` (set up like `adaptive-transcription.test.ts`)

**Interfaces:**
- Consumes: `transcribeAudio(...).words` (Task 5); `joinChunkWords`, `toSentences`, `toCues`,
  `toParagraphs`, `WordChunk` (Task 4).
- Produces: `interface TranscriptResult { text: string; segments: TranscriptSegment[]; words?: TimedWord[] }`
  (checkpoints store `words` too). When the job has at least one transcribed chunk and every one has a
  `words` array:
  - `transcript.json` = `{ text, segments: toSentences(words), words }` with
    `text = toParagraphs(sentences)` and `words = joinChunkWords(<each transcribed chunk's start, end, words>)`;
  - `.srt` and `.vtt` come from `toCues(words)` with the existing writers;
  - the Markdown body is `text`.
  Otherwise everything stays as today. A chunk split by adaptive retry returns
  `words = joinChunkWords([left half, right half])` when both halves have words, else no `words`.

- [ ] **Step 1: Write the failing tests**

Helper `runAudioJob({ model, seconds, respond, audio })`: 16 kHz silent WAV made with ffmpeg, settings with
`chunkTargetSec: 15`, `chunkOverlapSec: 1`, `maxRetriesPerChunk: 0`, the fake ASR server calling
`respond(requestNumber)` for each request; runs `processJob` and returns the parsed `transcript.json`, the
`.srt` text, the `.md` text and the request count.

```ts
it("writes one line per sentence, short cues and the words when the ASR returns word times", async () => {
  // model "Parakeet-TDT-0.6B-v3", 40 s; every request -> { text: "Hello. Again.", words: [w("Hello.", 0.2, 0.6), w("Again.", 2.0, 2.4)] }
  expect(json.segments.map((s) => s.text)).toEqual(Array(requests).fill(["Hello.", "Again."]).flat());
  expect(json.words).toHaveLength(2 * requests);
  expect(srt.match(/ --> /g)).toHaveLength(2 * requests);
  expect(md).toContain("Hello. Again.");
});
it("keeps word-timed output when one chunk has no speech", async () => {
  // request 2 -> { text: "", words: [] }
  expect(json.words).toHaveLength(2 * (requests - 1));
  expect(json.segments).toHaveLength(2 * (requests - 1));
});
it("joins the halves' words when a difficult chunk is split", async () => {
  // 20 s, adaptiveSplit true, minAdaptiveChunkSec 5; request 1 -> "repeated-block!".repeat(24);
  // request 2 -> words [w("Left.", 0.2, 0.6)], request 3 -> words [w("Right.", 0.2, 0.6)]
  expect(json.segments.map((s) => s.text)).toEqual(["Left.", "Right."]);
});
it("keeps one segment per chunk and no words for models without word times", async () => {
  // model "test-asr", every request -> { text: "Plain words." }
  expect(json.words).toBeUndefined();
  expect(json.segments).toHaveLength(requests);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/server/word-timed-transcription.test.ts`
Expected: the first three FAIL (segments are per chunk, `words` undefined); the fourth passes already
(it guards today's behaviour).

- [ ] **Step 3: Implement** in `processor.ts`: keep each transcribed chunk's `{ start, end }` beside its
  result, choose the word-timed or the existing output by the rule above, and join adaptive halves with
  `joinChunkWords`.

- [ ] **Step 4: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: PASS except the 8 known Windows failures in `src/server/dgx-update.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/server/processor.ts src/server/word-timed-transcription.test.ts
git commit -m "feat(asr): write sentence lines and subtitle cues from word timestamps"
```

---

### Task 7: Roll out on the Spark and measure

No code changes unless a check fails (then fix it test-first in the task that owns the code). Results go to
`docs/validation.md`.

- [ ] **Step 1: Ask the user for a window.** This step stops `sparklingkit-qwen3-asr` and recreates the
  app. Wait for an explicit OK. Then: `free -g`, `docker ps`, and confirm no transcription job is running
  (`GET /api/jobs`).
- [ ] **Step 2: Deploy without the full start script.** The Spark's LLM is Saluki in llama.cpp on :8331,
  not the `qwen36` service, so the start script would try to start and download the wrong LLM. Instead, in
  `~/code/SparklingKit`: fetch the branch bundle and `git checkout feat/parakeet-asr` (the stash stays);
  `build parakeet app`; `stop qwen3-asr`; `up -d --no-deps parakeet`; wait for
  `curl -fsS 127.0.0.1:8333/health`; `up -d --no-deps app`.
- [ ] **Step 3: Switch the saved speech model**: read `GET /api/settings`, write it back with
  `PUT /api/settings` changing only `endpoints.stt.model` to `Parakeet-TDT-0.6B-v3`. Check that
  `GET /api/health` shows ASR online with that model and dgx-status labels the engine "ASR".
- [ ] **Step 4: Transcribe through the app** the README demo reading (English) and one Italian FLEURS clip
  from `~/sk-bench`. Pass when:
  - `transcript.json` has one segment per sentence and a `words` array;
  - every SRT cue lasts ≤ 7 s and has ≤ 84 characters (check with a short Python loop over the file);
  - in the Browser pane, clicking a later transcript line moves the player to that line's start.
- [ ] **Step 5: Accuracy and speed through the adapter.** Rerun `~/sk-bench/asrbench.py` for `en` and `it`
  against :8333. Pass: WER within 0.3 points of 3.6% and 3.9%.
- [ ] **Step 6: Memory.** Record `docker stats --no-stream sparklingkit-parakeet` and the engine's
  `nvidia-smi --query-compute-apps` row idle and during a long transcription (peak).
- [ ] **Step 7: Write the results** into `docs/validation.md` (WER, speed, memory, cue checks, the date),
  then commit:

```bash
git add docs/validation.md
git commit -m "docs(validation): record Parakeet results through the app"
```

---

### Task 8: Documentation, demo clip and PR

**Files:**
- Modify: `README.md` (transcription section text; models table row; per-container memory table: Parakeet
  replaces the 16.5 GiB Qwen3-ASR row and the totals change; ports table; credits), `docs/fork.md`,
  `AGENTS.md` (ports table row 8333 `Parakeet-TDT-0.6B-v3` with alternative
  `Qwen3-ASR-1.7B: --asr-backend qwen3-asr`; the rule "Upstream's defaults stay the defaults" becomes
  "The fork's defaults are the ones in the table above"), `services/dgx-models/README.md`,
  `docs/dgx-spark.md` (the new option)
- Replace: `.github/media/transcript.webp` and `.github/media/transcript.mp4`

- [ ] **Step 1: Update the docs.** Include the upgrade note for existing installs: after switching the
  service, choose `Parakeet-TDT-0.6B-v3` under Settings → Speech recognition (saved settings are never
  rewritten). Name Parakeet's license (CC BY 4.0) and its 25-language limit next to the alternative.
- [ ] **Step 2: Re-record the transcription clip** with `scripts/media/record-demo.mjs`, following
  `scripts/media/README.md`, against the demo app on the Spark. Check the WebP and MP4 in the Browser pane.
- [ ] **Step 3: Check for personal details**: `git diff main --stat`, then grep the diff for host names, home
  paths, tailnet names and the always-on LLM's container name. Expected: none.
- [ ] **Step 4: Commit**

```bash
git add README.md docs/fork.md AGENTS.md services/dgx-models/README.md docs/dgx-spark.md .github/media/transcript.webp .github/media/transcript.mp4
git commit -m "docs(asr): document Parakeet as the default speech backend"
```

- [ ] **Step 5: Ask the user** before pushing and opening the PR. The branch starts from `polish-ui`
  (PR #4); once that is merged, rebase onto `main`. Push through the Spark's `gh` (this branch changes
  workflow files) and open the PR with `--repo MovieMaker93/SparklingKit --base main`, title
  `feat(asr): make Parakeet the default speech recognition backend`.
