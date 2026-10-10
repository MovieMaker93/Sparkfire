"""Parakeet adapter for SparklingKit.

NVIDIA Parakeet runs as parakeet.cpp's `parakeet-server`, which has GET /health and
POST /v1/audio/transcriptions only, takes WAV only and handles one request at a time. This adapter starts
that server on a private port and puts the surface SparklingKit already speaks in front of it:

  GET  /health                    200 once the engine answers, 503 until then (readiness checks wait on it)
  GET  /v1/models                 the configured model name, which the engine cannot list
  POST /v1/audio/transcriptions   multipart "file" (WAV) with an optional response_format and
                                  timestamp_granularities[] -> the engine's reply, unchanged

The `model` field is ignored on purpose: an install that still sends the old ASR model id keeps working.
"""

import asyncio
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from starlette.datastructures import UploadFile

# Everything else in the request (model, temperature, prompt, language) means nothing to the engine.
FORWARDED_FIELDS = ("response_format", "timestamp_granularities[]")
NOT_WAV = "Upload WAV audio; SparklingKit sends 16 kHz WAV chunks"
UNREACHABLE = b'{"detail":"The Parakeet engine is not reachable"}'


def is_wav(data: bytes) -> bool:
    return data[:4] == b"RIFF" and data[8:12] == b"WAVE"


class Engine:
    """Client for parakeet-server. It serves one request at a time, so transcriptions queue here instead of racing."""

    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._lock = asyncio.Lock()

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                return (await client.get(f"{self._base_url}/health")).status_code == 200
        except httpx.HTTPError:
            return False

    async def transcribe(self, audio: bytes, filename: str, fields: list[tuple[str, str]]) -> tuple[int, bytes, str]:
        # A field may repeat (one timestamp_granularities[] per granularity), which a dict of lists keeps.
        data: dict[str, list[str]] = {}
        for name, value in fields:
            data.setdefault(name, []).append(value)
        async with self._lock:
            try:
                async with httpx.AsyncClient(timeout=30 * 60) as client:
                    response = await client.post(
                        f"{self._base_url}/v1/audio/transcriptions",
                        files={"file": (filename, audio, "audio/wav")},
                        data=data,
                    )
            except httpx.TransportError:
                return 503, UNREACHABLE, "application/json"
        return response.status_code, response.content, response.headers.get("content-type", "application/json")


def create_app(engine: Engine, model_name: str) -> FastAPI:
    app = FastAPI(title=f"{model_name} adapter", version="1.0")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        if not await engine.healthy():
            raise HTTPException(status_code=503, detail="The Parakeet engine is not ready")
        return {"ok": True, "model": model_name}

    @app.get("/v1/models")
    def models() -> dict[str, Any]:
        return {"object": "list", "data": [{"id": model_name, "object": "model"}]}

    @app.post("/v1/audio/transcriptions")
    async def transcriptions(request: Request) -> Response:
        # The form owns a temporary file for the upload; leaving the block closes it before the engine call.
        async with request.form() as form:
            upload = form.get("file")
            audio, filename = b"", "audio.wav"
            if isinstance(upload, UploadFile):
                audio, filename = await upload.read(), upload.filename or filename
            fields = [(key, str(value)) for key in FORWARDED_FIELDS for value in form.getlist(key)]
        if not is_wav(audio):
            raise HTTPException(status_code=400, detail=NOT_WAV)
        status, body, content_type = await engine.transcribe(audio, filename, fields)
        return Response(body, status_code=status, media_type=content_type)

    return app


def watch_engine(process: Any, on_exit: Callable[[int], None], interval: float = 1.0) -> threading.Thread:
    def watch() -> None:
        while (code := process.poll()) is None:
            time.sleep(interval)
        on_exit(code)

    thread = threading.Thread(target=watch, name="parakeet-engine-watch", daemon=True)
    thread.start()
    return thread


def main() -> None:
    port = int(os.getenv("PORT", "8333"))
    engine_port = int(os.getenv("ENGINE_PORT", "8343"))
    binary = os.getenv("ENGINE_BINARY", "/usr/local/bin/parakeet-server")
    model_path = os.environ["MODEL_PATH"]
    model_name = os.getenv("MODEL_NAME", "Parakeet-TDT-0.6B-v3")

    process = subprocess.Popen([binary, "--model", model_path, "--host", "127.0.0.1", "--port", str(engine_port)])

    def engine_exited(code: int) -> None:
        print(f"parakeet-server exited with code {code}", file=sys.stderr, flush=True)
        # Exit the whole container so Docker restarts it; an adapter without its engine only answers 503.
        os._exit(1)

    watch_engine(process, engine_exited)
    app = create_app(Engine(f"http://127.0.0.1:{engine_port}"), model_name)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
