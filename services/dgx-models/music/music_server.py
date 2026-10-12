"""Music generation adapter for Sparkfire: YuE2 (lyrics and a style in, a song with vocals out).

YuE2 first writes the song as an editable ABC score (melody and chords), then sings it as 48 kHz stereo audio.
The adapter keeps one pipeline in the process, behind the surface Sparkfire speaks:

  GET  /health                 200 while the adapter runs; says whether the model is loaded
  GET  /v1/models              the configured model name
  GET  /v1/capabilities        limits, the output format, the license line and what is loaded
  POST /v1/music/generations   JSON request -> multipart/form-data: the FLAC, the ABC score and the metadata
  POST /v1/unload              frees the weights now instead of after the idle timeout

Nothing loads until the first song, and the weights are freed after IDLE_UNLOAD_SECONDS without one, so the
service holds no memory between uses. Before loading, it checks that the Spark has room: a song needs about
20 GiB, and the Spark is shared with other models (docs/validation.md).
"""

import asyncio
import io
import json
import os
import secrets
import sys
import threading
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field


@dataclass(frozen=True)
class Backend:
    """One music model the adapter can serve, with its weights' folders under the model mount."""

    model_name: str
    owner: str
    model_dir: str
    vae_dir: str
    # Shown with results: the weights' license, which allows personal and creator use but not company use.
    license: str
    # What loading needs free on the whole machine, measured on the Spark with a margin.
    min_available_gib: float


BACKENDS = {
    "yue2": Backend(
        model_name="YuE2-3B",
        owner="m-a-p",
        model_dir="m-a-p/YuE2-3B",
        vae_dir="m-a-p/YuE2-Vae",
        license="YuE2 weights: CC BY-NC 4.0 with a creator permission (m-a-p)",
        min_available_gib=22,
    ),
}

MAX_STYLE_CHARS = 1000
MAX_LYRICS_CHARS = 20_000
MAX_SCORE_CHARS = 50_000
MAX_SEED = 2**31 - 1
SAMPLE_RATE = 48_000


class Cancelled(Exception):
    """The caller went away, so the song was stopped."""


class NotEnoughMemory(Exception):
    """Loading would not fit next to what already runs on the machine."""


class MusicRequest(BaseModel):
    model: str | None = None
    style: str = Field(min_length=1, max_length=MAX_STYLE_CHARS)
    lyrics: str = Field(min_length=1, max_length=MAX_LYRICS_CHARS)
    # An ABC score to sing instead of writing one: the "Continue with" of an edited score.
    score: str | None = Field(default=None, max_length=MAX_SCORE_CHARS)
    seed: int | None = Field(default=None, ge=0, le=MAX_SEED)


@dataclass
class Song:
    flac: bytes
    score: str
    seed: int
    duration_seconds: float
    elapsed_seconds: float
    truncated: dict[str, bool] = field(default_factory=dict)


class Engine(Protocol):
    """What the service needs from a model: tests use a fake, the container uses YuE2Engine."""

    @property
    def loaded(self) -> bool: ...

    def load(self) -> None: ...

    def generate(self, style: str, lyrics: str, score: str | None, seed: int, cancelled: Callable[[], bool]) -> Song: ...

    def unload(self) -> None: ...


def available_gib(meminfo: Path = Path("/proc/meminfo")) -> float | None:
    """MemAvailable of the whole machine: on the Spark CPU and GPU share it, and a container sees the host's."""
    try:
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 2**20
    except (OSError, ValueError, IndexError):
        pass
    return None


class MusicService:
    def __init__(self, engine: Engine, backend: Backend, idle_unload_seconds: float,
                 memory: Callable[[], float | None] = available_gib) -> None:
        self.engine = engine
        self.backend = backend
        self.idle_unload_seconds = idle_unload_seconds
        self.memory = memory
        # One song at a time: the model is one pipeline, and the lock also keeps the idle unload out of a song.
        self.lock = asyncio.Lock()
        self.last_used = time.monotonic()

    def capabilities(self) -> dict[str, Any]:
        return {
            "model": self.backend.model_name,
            "owner": self.backend.owner,
            "output": {"mimeType": "audio/flac", "sampleRate": SAMPLE_RATE, "channels": 2},
            "maxStyleChars": MAX_STYLE_CHARS,
            "maxLyricsChars": MAX_LYRICS_CHARS,
            "maxScoreChars": MAX_SCORE_CHARS,
            "acceptsScore": True,
            "license": self.backend.license,
            "loaded": self.engine.loaded,
            "idleUnloadSeconds": self.idle_unload_seconds,
            "minAvailableGiB": self.backend.min_available_gib,
        }

    def check_memory(self) -> None:
        if self.engine.loaded:
            return
        free = self.memory()
        if free is not None and free < self.backend.min_available_gib:
            raise NotEnoughMemory(
                f"Not enough free memory to load {self.backend.model_name}: {free:.0f} GiB available, "
                f"{self.backend.min_available_gib:.0f} GiB needed. Wait for other jobs to finish, or free a model."
            )

    async def generate(self, request: MusicRequest, disconnected: Callable[[], Awaitable[bool]]) -> Song:
        seed = request.seed if request.seed is not None else secrets.randbelow(MAX_SEED)
        stop = threading.Event()

        async def watch() -> None:
            while not stop.is_set():
                if await disconnected():
                    stop.set()
                    return
                await asyncio.sleep(1)

        async with self.lock:
            self.check_memory()
            watcher = asyncio.create_task(watch())
            try:
                # The model runs in a thread so the event loop keeps answering health checks and disconnects.
                song = await asyncio.to_thread(self.engine.generate, request.style, request.lyrics, request.score, seed, stop.is_set)
            except InterruptedError:
                print("Stopped a song: the caller went away", flush=True)
                raise Cancelled() from None
            finally:
                stop.set()
                watcher.cancel()
                self.last_used = time.monotonic()
        return song

    async def unload(self) -> bool:
        async with self.lock:
            was_loaded = self.engine.loaded
            await asyncio.to_thread(self.engine.unload)
            return was_loaded

    async def unload_if_idle(self) -> bool:
        if not self.engine.loaded or self.lock.locked() or time.monotonic() - self.last_used < self.idle_unload_seconds:
            return False
        return await self.unload()


def multipart(parts: list[tuple[str, str, str | None, bytes]]) -> tuple[bytes, str]:
    """A multipart/form-data body from (name, content type, filename, bytes) parts, which fetch's formData() reads."""
    boundary = f"sparkfire-{secrets.token_hex(12)}"
    body = io.BytesIO()
    for name, content_type, filename, data in parts:
        disposition = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        body.write(f"--{boundary}\r\nContent-Disposition: {disposition}\r\nContent-Type: {content_type}\r\n\r\n".encode())
        body.write(data)
        body.write(b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


def create_app(service: MusicService, model_name: str, idle_check_seconds: float = 15) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        async def unload_when_idle() -> None:
            while True:
                await asyncio.sleep(idle_check_seconds)
                try:
                    if await service.unload_if_idle():
                        print("Freed the music model after the idle timeout", flush=True)
                except Exception as error:  # try again on the next tick
                    print(f"Idle unload failed: {error}", file=sys.stderr, flush=True)

        task = asyncio.create_task(unload_when_idle())
        yield
        task.cancel()

    app = FastAPI(title=f"{model_name} adapter", version="1.0", lifespan=lifespan)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "model": model_name, "loaded": service.engine.loaded}

    @app.get("/v1/models")
    def models() -> dict[str, Any]:
        return {"object": "list", "data": [{"id": model_name, "object": "model", "owned_by": service.backend.owner}]}

    @app.get("/v1/capabilities")
    def capabilities() -> dict[str, Any]:
        return {**service.capabilities(), "model": model_name}

    @app.post("/v1/music/generations")
    async def generations(body: MusicRequest, request: Request) -> Response:
        if not body.style.strip() or not body.lyrics.strip():
            raise HTTPException(status_code=422, detail="Style and lyrics must not be blank")
        try:
            song = await service.generate(body, request.is_disconnected)
        except Cancelled:
            return Response(status_code=499)
        except NotEnoughMemory as error:
            raise HTTPException(status_code=503, detail=str(error), headers={"Retry-After": "60"}) from None
        except ValueError as error:  # YuE2 refused the request, for example an unreadable score
            raise HTTPException(status_code=422, detail=str(error)) from None
        metadata = {
            "model": model_name,
            "seed": song.seed,
            "durationSeconds": round(song.duration_seconds, 2),
            "elapsedSeconds": round(song.elapsed_seconds, 2),
            "truncated": song.truncated,
            "license": service.backend.license,
        }
        content, content_type = multipart([
            ("metadata", "application/json", None, json.dumps(metadata).encode()),
            ("score", "text/vnd.abc; charset=utf-8", "score.abc", song.score.encode()),
            ("audio", "audio/flac", "song.flac", song.flac),
        ])
        return Response(content=content, media_type=content_type)

    @app.post("/v1/unload")
    async def unload() -> dict[str, Any]:
        await service.unload()
        return {"ok": True}

    return app


class YuE2Engine:
    """The real model. Imports torch and yue2 only when it loads, so the adapter's tests need neither."""

    def __init__(self, model_dir: Path, vae_dir: Path, memory_budget_gib: float = 24) -> None:
        self.model_dir, self.vae_dir = model_dir, vae_dir
        self.memory_budget_gib = memory_budget_gib
        self.pipe: Any = None
        self.vae: Any = None

    @property
    def loaded(self) -> bool:
        return self.pipe is not None

    def load(self) -> None:
        if self.pipe is not None:
            return
        import torch
        from yue2 import YuE2Pipeline
        from yue2.modeling_vae import YuE2VAE

        pipe = YuE2Pipeline(self.model_dir, self.vae_dir, device="cuda", memory_budget_gib=self.memory_budget_gib, progress=False)
        pipe._load_model()
        # YuE2 moves the main model to the CPU and the decoder to the GPU for every song, which saves VRAM
        # on a separate graphics card. On the Spark both share one memory, and the move alone took 59 s of a
        # 96 s song; with both resident the decode takes 1.4 s (docs/validation.md).
        self.vae = YuE2VAE.from_pretrained(self.vae_dir, decoder_only=True, device="cpu", local_files_only=True).to(pipe.device)
        pipe.decode = self._decode_resident
        torch.cuda.synchronize()
        self.pipe = pipe

    def _decode_resident(self, latents: Any, **_: Any) -> Any:
        import torch

        z = torch.as_tensor(latents, dtype=torch.float32)
        if z.ndim == 2 and z.shape[1] == 64:
            z = z.T.unsqueeze(0)
        if z.ndim != 3 or z.shape[0] != 1 or z.shape[1] != 64:
            raise ValueError("Expected latents [T,64] or [1,64,T]")
        with torch.inference_mode():
            audio = self.vae.decode_tiled(z, core_frames=self.pipe.vae_core_frames, halo_frames=16, output_device="cpu")
        if not torch.isfinite(audio).all():
            raise ValueError("The decoder produced non-finite audio")
        return audio[0].float().clamp(-1, 1).T.contiguous().numpy()

    def generate(self, style: str, lyrics: str, score: str | None, seed: int, cancelled: Callable[[], bool]) -> Song:
        import soundfile as sf

        self.load()
        started = time.perf_counter()
        result = self.pipe(style=style, lyrics=lyrics, abc=score, cot="full", seed=seed, cancelled=cancelled)
        buffer = io.BytesIO()
        sf.write(buffer, result.audio, result.sample_rate, format="FLAC", subtype="PCM_24")
        return Song(
            flac=buffer.getvalue(),
            score=result.abc or "",
            seed=seed,
            duration_seconds=len(result.audio) / result.sample_rate,
            elapsed_seconds=time.perf_counter() - started,
            truncated=dict(result.truncated),
        )

    def unload(self) -> None:
        if self.pipe is None:
            return
        import torch

        self.pipe.close()
        self.pipe, self.vae = None, None
        torch.cuda.empty_cache()


def main() -> None:
    backend_id = os.getenv("MUSIC_BACKEND", "yue2")
    if backend_id not in BACKENDS:
        raise SystemExit(f"Unknown MUSIC_BACKEND {backend_id!r}; choose one of {', '.join(BACKENDS)}")
    backend = BACKENDS[backend_id]
    models = Path(os.getenv("MODELS_DIR", "/models"))
    model_name = os.getenv("MODEL_NAME", backend.model_name)
    # MODEL_DIR and VAE_DIR point at weights kept elsewhere, such as a Hugging Face cache snapshot.
    engine = YuE2Engine(Path(os.getenv("MODEL_DIR", models / backend.model_dir)), Path(os.getenv("VAE_DIR", models / backend.vae_dir)))
    for folder in (engine.model_dir, engine.vae_dir):
        if not (folder / "config.json").is_file():
            raise SystemExit(f"{folder} has no config.json; download the pinned weights first (scripts/start-dgx-spark.sh)")
    service = MusicService(engine, backend, float(os.getenv("IDLE_UNLOAD_SECONDS", "600")))
    uvicorn.run(create_app(service, model_name), host="0.0.0.0", port=int(os.getenv("PORT", "8339")), log_level="info")


if __name__ == "__main__":
    main()
