"""Video generation adapter for Sparkfire: FastH3 (MiniMax H3, video with sound) through ComfyUI.

No diffusers or transformers release can load the FastH3 checkpoints yet (docs/validation.md), while a pinned
ComfyUI runs them inside the Spark's memory budget. The adapter starts that ComfyUI on a private port and
drives it headlessly over its HTTP API, behind the surface Sparkfire speaks:

  GET  /health                 200 once ComfyUI answers, 503 until then
  GET  /v1/models              the configured model name
  GET  /v1/capabilities        sizes, durations, variants, the disclosure line and what is loaded
  POST /v1/videos/generations  JSON request -> the MP4 (H.264 + AAC) as the response body
  POST /v1/unload              frees the weights now instead of after the idle timeout

ComfyUI keeps every weight it has loaded until it is told to free them, which would leave the stack about
30 GiB heavier between jobs. The adapter frees them after IDLE_UNLOAD_SECONDS without a job, and before a job
that needs the other variant, so only one diffusion model is ever resident.
"""

import asyncio
import base64
import binascii
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

sys.path.insert(0, str(Path(__file__).parent))

import workflows  # noqa: E402


@dataclass(frozen=True)
class Variant:
    id: str
    label: str
    description: str
    unet: str


@dataclass(frozen=True)
class Backend:
    """One video model the adapter can serve, with the ComfyUI file names of its parts."""

    model_name: str
    owner: str
    text_encoder: str
    video_vae: str
    audio_vae: str
    variants: tuple[Variant, ...]
    sizes: tuple[dict[str, str], ...]
    durations: tuple[int, ...]
    # Written into every MP4 and shown with results: the model's license asks that shared outputs say they
    # are machine-generated.
    disclosure: str


# The sizes and durations measured on the Spark; 720p is 1280x736 because sizes must be multiples of 32.
FASTH3_SIZES = (
    {"value": "864x480", "label": "480p", "ratio": "16:9", "quality": "standard"},
    {"value": "1280x736", "label": "720p", "ratio": "16:9", "quality": "high"},
    {"value": "1344x768", "label": "768p", "ratio": "16:9", "quality": "high"},
)

BACKENDS = {
    "fasth3": Backend(
        model_name="FastH3",
        owner="FastVideo",
        text_encoder="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        video_vae="minimax_h3_video_vae_int8_convrot.safetensors",
        audio_vae="minimax_h3_audio_vae_fp32.safetensors",
        variants=(
            Variant("fast", "Fast", "FastH3 Trim, NVFP4", "fastvideo_fasth3_trim_8step_nvfp4.safetensors"),
            Variant("sharp", "Sharp", "FastH3 V2, int8: about twice as slow, sharper detail", "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"),
        ),
        sizes=FASTH3_SIZES,
        durations=(5, 8),
        disclosure="AI-generated with MiniMax H3 (FastH3)",
    ),
}

MAX_FIRST_FRAME_BYTES = 20 * 1024 * 1024
MAX_SEED = 2**31 - 1


class ComfyError(Exception):
    """ComfyUI refused or failed a job."""


class ComfyCancelled(Exception):
    """The caller went away, so the job was taken off ComfyUI's queue."""


def describe_error(payload: dict[str, Any]) -> str:
    """The useful part of ComfyUI's validation error: its message plus each failing node's first error."""
    parts = []
    error = payload.get("error")
    if isinstance(error, dict) and error.get("message"):
        parts.append(str(error["message"]))
    for node_id, node in (payload.get("node_errors") or {}).items():
        for item in (node or {}).get("errors", [])[:1]:
            parts.append(f"{node_id} ({node.get('class_type', '?')}): {item.get('message', '')} {item.get('details', '')}".strip())
    return "; ".join(parts)


def execution_error(status: dict[str, Any]) -> str:
    for message in status.get("messages") or []:
        if isinstance(message, list) and len(message) == 2 and message[0] == "execution_error":
            details = message[1] or {}
            return f"{details.get('node_type', 'A node')} failed: {details.get('exception_message', 'unknown error')}".strip()
    return "ComfyUI reported an error"


class Comfy:
    """The few ComfyUI routes the adapter needs."""

    def __init__(self, base_url: str, poll_interval: float = 1.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.poll_interval = poll_interval

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                return (await client.get(f"{self.base_url}/system_stats")).status_code == 200
        except httpx.HTTPError:
            return False

    async def queue(self, graph: dict) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{self.base_url}/prompt", json={"prompt": graph, "client_id": "sparklingkit"})
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code != 200 or not payload.get("prompt_id"):
            raise ComfyError(f"ComfyUI rejected the job: {describe_error(payload) or response.text[:500]}")
        return str(payload["prompt_id"])

    async def wait(self, prompt_id: str, cancelled: Callable[[], Awaitable[bool]], timeout: float) -> dict:
        """Polls the history until the job has finished. A job shows up there only once it has run."""
        deadline = time.monotonic() + timeout
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                response = await client.get(f"{self.base_url}/history/{prompt_id}")
                response.raise_for_status()
                entry = response.json().get(prompt_id)
                if entry is not None:
                    status = entry.get("status") or {}
                    if status.get("status_str") == "error":
                        raise ComfyError(execution_error(status))
                    return entry
                if await cancelled():
                    await self.cancel(prompt_id)
                    raise ComfyCancelled()
                if time.monotonic() > deadline:
                    await self.cancel(prompt_id)
                    raise ComfyError(f"ComfyUI did not finish within {int(timeout)} seconds")
                await asyncio.sleep(self.poll_interval)

    async def cancel(self, prompt_id: str) -> None:
        # Deleting covers a job still waiting in the queue; interrupting covers the one that is running.
        with suppress(httpx.HTTPError):
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(f"{self.base_url}/queue", json={"delete": [prompt_id]})
                await client.post(f"{self.base_url}/interrupt", json={"prompt_id": prompt_id})

    async def free(self) -> None:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(f"{self.base_url}/free", json={"unload_models": True, "free_memory": True})
        response.raise_for_status()


def decode_image(value: str) -> tuple[bytes, str]:
    """A base64 image or data URL -> its bytes and file extension, for the first frame."""
    data = value.split(",", 1)[1] if value.startswith("data:") else value
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="first_frame must be a base64-encoded image") from None
    if len(raw) > MAX_FIRST_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="first_frame is larger than 20 MB")
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, ".png"
    if raw[:3] == b"\xff\xd8\xff":
        return raw, ".jpg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, ".webp"
    raise HTTPException(status_code=400, detail="first_frame must be a PNG, JPEG or WebP image")


def output_file(entry: dict, output_dir: Path) -> Path:
    """The video the save node wrote, resolved inside ComfyUI's output folder."""
    root = output_dir.resolve()
    saved = (entry.get("outputs") or {}).get(workflows.SAVE_NODE) or {}
    for items in saved.values():
        for item in items if isinstance(items, list) else []:
            name = str(item.get("filename", "")) if isinstance(item, dict) else ""
            if not name.endswith((".mp4", ".webm", ".mkv")):
                continue
            path = (root / str(item.get("subfolder", "")) / name).resolve()
            if root in path.parents and path.is_file():
                return path
    raise ComfyError("ComfyUI finished without saving a video")


def tag_video(source: Path, target: Path, comment: str) -> None:
    """Copies the MP4 stream by stream (no re-encoding) with `comment` in the container metadata."""
    import av  # ComfyUI's own dependency; imported here so the unit tests run without it

    with av.open(str(source)) as reader, av.open(str(target), "w", format="mp4") as writer:
        writer.metadata["comment"] = comment
        streams = {stream.index: writer.add_stream_from_template(stream) for stream in reader.streams if stream.type in ("video", "audio")}
        for packet in reader.demux(*[stream for stream in reader.streams if stream.index in streams]):
            if packet.dts is None:
                continue
            packet.stream = streams[packet.stream.index]
            writer.mux(packet)


def remove_files(paths: list[Path]) -> None:
    for path in paths:
        with suppress(FileNotFoundError):
            path.unlink()


class VideoRequest(BaseModel):
    # Accepted so OpenAI-style clients can send it; the adapter serves one model.
    model: str | None = None
    prompt: str = Field(min_length=1, max_length=12000)
    sound: str = Field(default="", max_length=4000)
    music: str = Field(default="", max_length=2000)
    size: str = "864x480"
    duration: int = 5
    variant: str | None = None
    seed: int | None = Field(default=None, ge=0, le=MAX_SEED)
    # A base64 image or data URL that the video starts from.
    first_frame: str | None = None


@dataclass
class GeneratedVideo:
    path: Path
    cleanup: list[Path]
    seed: int
    variant: str
    frames: int
    size: str
    elapsed_seconds: float


class VideoService:
    def __init__(self, comfy: Comfy, backend: Backend, work_dir: Path, idle_unload_seconds: float, job_timeout: float = 30 * 60) -> None:
        self.comfy = comfy
        self.backend = backend
        self.input_dir = work_dir / "input"
        self.output_dir = work_dir / "output"
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        # Videos are deleted once sent; a restart clears any whose response never went out.
        shutil.rmtree(self.output_dir / "sparklingkit", ignore_errors=True)
        self.idle_unload_seconds = idle_unload_seconds
        self.job_timeout = job_timeout
        # ComfyUI runs one graph at a time anyway; holding the lock for the whole job keeps the variant switch
        # and the idle unload from interleaving with it.
        self.lock = asyncio.Lock()
        self.loaded: str | None = None
        self.last_used = time.monotonic()

    def capabilities(self) -> dict[str, Any]:
        return {
            "model": self.backend.model_name,
            "owner": self.backend.owner,
            "sizes": list(self.backend.sizes),
            "durations": list(self.backend.durations),
            "variants": [{"id": variant.id, "label": variant.label, "description": variant.description} for variant in self.backend.variants],
            "defaultVariant": self.backend.variants[0].id,
            "firstFrame": True,
            "fps": workflows.FPS,
            "disclosure": self.backend.disclosure,
            "loaded": self.loaded,
            "idleUnloadSeconds": self.idle_unload_seconds,
        }

    def variant(self, variant_id: str | None) -> Variant:
        for variant in self.backend.variants:
            if variant.id == (variant_id or self.backend.variants[0].id):
                return variant
        raise HTTPException(status_code=400, detail=f"Unknown variant {variant_id!r}; choose {', '.join(v.id for v in self.backend.variants)}")

    def size(self, value: str) -> tuple[int, int]:
        if value not in {size["value"] for size in self.backend.sizes}:
            raise HTTPException(status_code=400, detail=f"{self.backend.model_name} does not offer {value}")
        width, height = value.split("x")
        return int(width), int(height)

    async def unload(self) -> None:
        await self.comfy.free()
        self.loaded = None

    async def unload_if_idle(self) -> bool:
        if self.loaded is None or self.lock.locked() or time.monotonic() - self.last_used < self.idle_unload_seconds:
            return False
        async with self.lock:
            if self.loaded is None:
                return False
            await self.unload()
            return True

    async def generate(self, request: VideoRequest, cancelled: Callable[[], Awaitable[bool]]) -> GeneratedVideo:
        width, height = self.size(request.size)
        if request.duration not in self.backend.durations:
            raise HTTPException(status_code=400, detail=f"Duration must be one of {', '.join(f'{d} s' for d in self.backend.durations)}")
        variant = self.variant(request.variant)
        image = decode_image(request.first_frame) if request.first_frame else None
        seed = request.seed if request.seed is not None else secrets.randbelow(MAX_SEED)
        frames = workflows.frames_for(request.duration)
        job = uuid.uuid4().hex[:12]
        image_path = self.input_dir / f"sparklingkit-{job}{image[1]}" if image else None

        async with self.lock:
            if self.loaded and self.loaded != variant.id:
                # One diffusion model at a time keeps the peak at what was measured.
                await self.unload()
            try:
                if image and image_path:
                    image_path.write_bytes(image[0])
                graph = workflows.build_graph(
                    prompt=workflows.format_prompt(request.prompt, request.sound, request.music, first_frame=image is not None),
                    width=width,
                    height=height,
                    frames=frames,
                    seed=seed,
                    unet=variant.unet,
                    text_encoder=self.backend.text_encoder,
                    video_vae=self.backend.video_vae,
                    audio_vae=self.backend.audio_vae,
                    filename_prefix=f"sparklingkit/{job}",
                    first_frame=image_path.name if image_path else None,
                )
                started = time.perf_counter()
                prompt_id = await self.comfy.queue(graph)
                # ComfyUI starts loading as soon as the job is queued, so an unload is due even if it fails.
                self.loaded = variant.id
                entry = await self.comfy.wait(prompt_id, cancelled, self.job_timeout)
                produced = output_file(entry, self.output_dir)
                elapsed = time.perf_counter() - started
            finally:
                self.last_used = time.monotonic()
                if image_path:
                    remove_files([image_path])

        tagged = produced.with_name(f"{produced.stem}-sparklingkit.mp4")
        try:
            tag_video(produced, tagged, self.backend.disclosure)
            path = tagged
        except Exception as error:  # a metadata failure must not throw away minutes of generation
            print(f"Could not tag {produced.name}: {error}", file=sys.stderr, flush=True)
            path = produced
        return GeneratedVideo(path, [produced, tagged], seed, variant.id, frames, request.size, round(elapsed, 2))


def create_app(service: VideoService, model_name: str, idle_check_seconds: float = 15) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        async def unload_when_idle() -> None:
            while True:
                await asyncio.sleep(idle_check_seconds)
                try:
                    if await service.unload_if_idle():
                        print("Freed the video model after the idle timeout", flush=True)
                except Exception as error:  # ComfyUI restarting: try again on the next tick
                    print(f"Idle unload failed: {error}", file=sys.stderr, flush=True)

        task = asyncio.create_task(unload_when_idle())
        yield
        task.cancel()

    app = FastAPI(title=f"{model_name} adapter", version="1.0", lifespan=lifespan)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        if not await service.comfy.healthy():
            raise HTTPException(status_code=503, detail="ComfyUI is not ready")
        return {"ok": True, "model": model_name, "loaded": service.loaded}

    @app.get("/v1/models")
    def models() -> dict[str, Any]:
        return {"object": "list", "data": [{"id": model_name, "object": "model", "owned_by": service.backend.owner}]}

    @app.get("/v1/capabilities")
    def capabilities() -> dict[str, Any]:
        return {**service.capabilities(), "model": model_name}

    @app.post("/v1/videos/generations")
    async def generations(body: VideoRequest, request: Request) -> Response:
        try:
            video = await service.generate(body, request.is_disconnected)
        except ComfyCancelled:
            return Response(status_code=499)
        except ComfyError as error:
            raise HTTPException(status_code=502, detail=str(error)) from None
        headers = {
            "X-Model": model_name,
            "X-Variant": video.variant,
            "X-Seed": str(video.seed),
            "X-Frames": str(video.frames),
            "X-Size": video.size,
            "X-Elapsed-Seconds": str(video.elapsed_seconds),
            "X-Disclosure": service.backend.disclosure,
        }
        return FileResponse(video.path, media_type="video/mp4", headers=headers, background=BackgroundTask(remove_files, video.cleanup))

    @app.post("/v1/unload")
    async def unload() -> dict[str, Any]:
        async with service.lock:
            await service.unload()
        return {"ok": True}

    return app


def watch_process(process: Any, on_exit: Callable[[int], None], interval: float = 1.0) -> threading.Thread:
    def watch() -> None:
        while (code := process.poll()) is None:
            time.sleep(interval)
        on_exit(code)

    thread = threading.Thread(target=watch, name="comfyui-watch", daemon=True)
    thread.start()
    return thread


def prepare_base_directory(work_dir: Path) -> None:
    # ComfyUI lists custom_nodes in its base directory before anything else and stops if it is missing.
    for folder in ("custom_nodes", "models", "input", "output", "temp", "user"):
        (work_dir / folder).mkdir(parents=True, exist_ok=True)


def comfy_command(comfy_dir: Path, port: int, work_dir: Path, model_paths: str) -> list[str]:
    # The base directory holds ComfyUI's input, output, temp and user folders; the models come from the
    # read-only mount listed in the model paths file. Metadata is off so the MP4 does not carry the graph.
    return [
        sys.executable, str(comfy_dir / "main.py"),
        "--listen", "127.0.0.1",
        "--port", str(port),
        "--base-directory", str(work_dir),
        "--extra-model-paths-config", model_paths,
        "--disable-metadata",
        "--disable-auto-launch",
    ]


def main() -> None:
    backend_id = os.getenv("VIDEO_BACKEND", "fasth3")
    if backend_id not in BACKENDS:
        raise SystemExit(f"Unknown VIDEO_BACKEND {backend_id!r}; choose one of {', '.join(BACKENDS)}")
    backend = BACKENDS[backend_id]
    port = int(os.getenv("PORT", "8337"))
    comfy_port = int(os.getenv("COMFY_PORT", "8347"))
    comfy_dir = Path(os.getenv("COMFYUI_DIR", "/opt/ComfyUI"))
    work_dir = Path(os.getenv("WORK_DIR", "/tmp/sparklingkit-video"))
    model_paths = os.getenv("MODEL_PATHS_CONFIG", "/app/extra_model_paths.yaml")
    model_name = os.getenv("MODEL_NAME", backend.model_name)
    idle_unload_seconds = float(os.getenv("IDLE_UNLOAD_SECONDS", "600"))
    prepare_base_directory(work_dir)

    process = subprocess.Popen(comfy_command(comfy_dir, comfy_port, work_dir, model_paths), cwd=comfy_dir)

    def comfy_exited(code: int) -> None:
        print(f"ComfyUI exited with code {code}", file=sys.stderr, flush=True)
        # Exit the whole container so Docker restarts it; an adapter without ComfyUI only answers 503.
        os._exit(1)

    watch_process(process, comfy_exited)
    service = VideoService(Comfy(f"http://127.0.0.1:{comfy_port}"), backend, work_dir, idle_unload_seconds)
    uvicorn.run(create_app(service, model_name), host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
