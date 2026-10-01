"""PaddleOCR-VL adapter for SparklingKit.

PaddleOCR-VL needs a layout stage (PP-DocLayout) in front of the 0.9B vision-language model. The VLM is
served by vLLM in its own container; this adapter runs the PaddleOCR pipeline against it and returns
Markdown plus layout blocks:

  POST /v1/ocr                multipart "image" -> {markdown, width, height, blocks: [{label, bbox, text}]}
  POST /v1/chat/completions   OpenAI-style request with one image -> Markdown as the assistant message,
                              so a client still configured for a chat-style OCR model keeps working.
"""

import base64
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

MODEL_NAME = os.getenv("MODEL_NAME", "PaddleOCR-VL-1.6")
VLM_URL = os.getenv("VLM_URL", "http://127.0.0.1:8342/v1")
VLM_MODEL_NAME = os.getenv("VLM_MODEL_NAME", "PaddleOCR-VL-1.6")
PIPELINE_VERSION = os.getenv("PIPELINE_VERSION", "v1.6")
LAYOUT_DEVICE = os.getenv("LAYOUT_DEVICE", "cpu")
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(40 * 1024 * 1024)))

app = FastAPI(title=f"{MODEL_NAME} adapter", version="1.0")
pipeline = None
pipeline_lock = threading.Lock()


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[dict[str, Any]]


def load_pipeline() -> None:
    global pipeline
    from paddleocr import PaddleOCRVL

    pipeline = PaddleOCRVL(
        pipeline_version=PIPELINE_VERSION,
        vl_rec_backend="vllm-server",
        vl_rec_server_url=VLM_URL,
        vl_rec_api_model_name=VLM_MODEL_NAME,
        device=LAYOUT_DEVICE,
    )


IMAGE_REFERENCE = re.compile(r"!\[[^\]]*\]\((?:imgs|images)/[^)]*\)|<img[^>]*src=\"(?:imgs|images)/[^\"]*\"[^>]*/?>", re.IGNORECASE)


def clean_markdown(markdown: str) -> str:
    """Figures are cropped to files the client cannot fetch, so drop their references and tidy blank lines."""
    without_images = IMAGE_REFERENCE.sub("", markdown)
    return re.sub(r"\n{3,}", "\n\n", without_images).strip()


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and abs(result) != float("inf") else None


def result_to_payload(result_json: dict[str, Any], markdown: str, width: int | None, height: int | None) -> dict[str, Any]:
    """Maps PaddleOCR's result JSON (res.parsing_res_list of block_label/block_bbox/block_content) to the adapter format."""
    res = result_json.get("res", result_json)
    blocks = []
    for block in res.get("parsing_res_list") or []:
        bbox = [number(value) for value in (block.get("block_bbox") or [])]
        if len(bbox) != 4 or any(value is None for value in bbox):
            continue
        blocks.append({
            "label": str(block.get("block_label") or "text"),
            "bbox": [round(value, 1) for value in bbox],
            "text": str(block.get("block_content") or ""),
        })
    return {
        "markdown": clean_markdown(markdown),
        "width": int(res.get("width") or width or 0) or None,
        "height": int(res.get("height") or height or 0) or None,
        "blocks": blocks,
    }


def image_size(path: Path) -> tuple[int | None, int | None]:
    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.size
    except Exception:
        return None, None


def recognize(data: bytes, suffix: str) -> dict[str, Any]:
    if pipeline is None:
        raise HTTPException(status_code=503, detail="pipeline not loaded")
    if not data:
        raise HTTPException(status_code=400, detail="empty image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / f"page{suffix or '.png'}"
        path.write_bytes(data)
        width, height = image_size(path)
        started = time.perf_counter()
        with pipeline_lock:
            results = list(pipeline.predict(str(path)))
        if not results:
            raise HTTPException(status_code=502, detail="the OCR pipeline returned no result")
        result = results[0]
        markdown_info = result.markdown if hasattr(result, "markdown") else {}
        markdown = markdown_info.get("markdown_texts", "") if isinstance(markdown_info, dict) else str(markdown_info)
        payload = result_to_payload(result.json if hasattr(result, "json") else {}, markdown, width, height)
        payload["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        return payload


@app.on_event("startup")
def startup() -> None:
    load_pipeline()


@app.get("/health")
def health() -> dict[str, Any]:
    if pipeline is None:
        raise HTTPException(status_code=503, detail="pipeline not loaded")
    return {"ok": True, "model": MODEL_NAME, "vlm": VLM_URL, "layout_device": LAYOUT_DEVICE}


@app.get("/v1/models")
def models() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model", "owned_by": "PaddlePaddle"}]}


@app.post("/v1/ocr")
async def ocr(image: UploadFile = File(...)) -> dict[str, Any]:
    return recognize(await image.read(), Path(image.filename or "page.png").suffix.lower())


DATA_URI = re.compile(r"^data:image/(png|jpe?g|webp);base64,(.+)$", re.DOTALL)


def first_image(messages: list[dict[str, Any]]) -> tuple[bytes, str]:
    for message in messages:
        content = message.get("content")
        for part in content if isinstance(content, list) else []:
            url = (part.get("image_url") or {}).get("url", "") if isinstance(part, dict) else ""
            match = DATA_URI.match(url)
            if match:
                extension = ".jpg" if match.group(1).startswith("jp") else f".{match.group(1)}"
                return base64.b64decode(match.group(2)), extension
    raise HTTPException(status_code=400, detail="send one page as a base64 image_url")


@app.post("/v1/chat/completions")
def chat(request: ChatRequest) -> dict[str, Any]:
    data, suffix = first_image(request.messages)
    payload = recognize(data, suffix)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:16]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL_NAME,
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": payload["markdown"]}}],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8332")), log_level="info")
