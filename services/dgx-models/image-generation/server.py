import base64
import os
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


@dataclass(frozen=True)
class Backend:
    """One text-to-image model the adapter can serve. Exactly one is loaded per container."""

    model_name: str
    model_path: str
    owner: str
    pipeline: str
    default_steps: int
    max_steps: int
    guidance_scale: float
    size_multiple: int
    max_pixels: int
    sizes: list[dict[str, str]] = field(default_factory=list)
    # diffusers attention backend; empty keeps PyTorch SDPA.
    attention_backend: str = ""


STANDARD_SIZES = [
    {"value": "1024x1024", "label": "Square", "ratio": "1:1", "quality": "standard"},
    {"value": "1536x1024", "label": "Landscape", "ratio": "3:2", "quality": "standard"},
    {"value": "1024x1536", "label": "Portrait", "ratio": "2:3", "quality": "standard"},
]

BACKENDS = {
    "z-image": Backend(
        model_name="Z-Image-Turbo",
        model_path="/models/Tongyi-MAI/Z-Image-Turbo",
        owner="Tongyi-MAI",
        pipeline="ZImagePipeline",
        default_steps=9,
        max_steps=50,
        guidance_scale=0.0,
        size_multiple=16,
        max_pixels=2048 * 2048,
        sizes=STANDARD_SIZES,
        attention_backend="flash",
    ),
    # Qwen-Image 2.1 is sampled without classifier-free guidance (true_cfg_scale 1.0) and needs
    # dimensions divisible by 32. The high-quality set keeps the same ratios at about 4 MP. Its transformer
    # passes a text attention mask, which flash-attn 2 rejects, so it stays on SDPA.
    "qwen-image-2.1": Backend(
        model_name="Qwen-Image-2.1",
        model_path="/models/Qwen/Qwen-Image-2.1",
        owner="Qwen",
        pipeline="QwenImage21Pipeline",
        default_steps=40,
        max_steps=60,
        guidance_scale=1.0,
        size_multiple=32,
        max_pixels=2048 * 2048,
        sizes=STANDARD_SIZES + [
            {"value": "2048x2048", "label": "Square", "ratio": "1:1", "quality": "high"},
            {"value": "2496x1664", "label": "Landscape", "ratio": "3:2", "quality": "high"},
            {"value": "1664x2496", "label": "Portrait", "ratio": "2:3", "quality": "high"},
        ],
    ),
}

BACKEND_ID = os.getenv("IMAGE_BACKEND", "z-image")
if BACKEND_ID not in BACKENDS:
    raise SystemExit(f"Unknown IMAGE_BACKEND {BACKEND_ID!r}; choose one of {', '.join(BACKENDS)}")
BACKEND = BACKENDS[BACKEND_ID]
MODEL_PATH = os.getenv("MODEL_PATH", BACKEND.model_path)
MODEL_NAME = os.getenv("MODEL_NAME", BACKEND.model_name)
ATTENTION_BACKEND = os.getenv("ATTENTION_BACKEND") or BACKEND.attention_backend
DEFAULT_STEPS = int(os.getenv("DEFAULT_STEPS") or BACKEND.default_steps)
MAX_PIXELS = int(os.getenv("MAX_PIXELS") or BACKEND.max_pixels)
# float8 weight-only quantization of the transformer and text encoder; "none" keeps bfloat16.
QUANTIZE = os.getenv("QUANTIZE") or ("float8wo" if BACKEND_ID == "qwen-image-2.1" else "none")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=MODEL_NAME, version="2.0")
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
generation_lock = threading.Lock()
pipe = None
active_attention_backend = "unloaded"
active_quantization = "none"


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=12000)
    n: int = Field(default=1, ge=1, le=1)
    size: str = "1024x1024"
    response_format: Literal["url", "b64_json"] = "url"
    seed: int | None = Field(default=None, ge=0, le=2**63 - 1)
    steps: int | None = Field(default=None, ge=2, le=100)
    guidance_scale: float | None = Field(default=None, ge=0.0, le=20.0)


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=12000)
    width: int = Field(default=1024, ge=256, le=4096)
    height: int = Field(default=1024, ge=256, le=4096)
    seed: int | None = Field(default=None, ge=0, le=2**63 - 1)
    steps: int | None = Field(default=None, ge=2, le=100)
    guidance_scale: float | None = Field(default=None, ge=0.0, le=20.0)
    response_format: Literal["url", "b64_json"] = "url"


def validate_dimensions(width: int, height: int) -> None:
    multiple = BACKEND.size_multiple
    if width % multiple or height % multiple:
        raise HTTPException(status_code=400, detail=f"width and height must be multiples of {multiple}")
    if width * height > MAX_PIXELS:
        raise HTTPException(status_code=400, detail=f"image area exceeds MAX_PIXELS={MAX_PIXELS}")


def validate_steps(steps: int | None) -> int:
    actual = steps or DEFAULT_STEPS
    if actual > BACKEND.max_steps:
        raise HTTPException(status_code=400, detail=f"{MODEL_NAME} accepts at most {BACKEND.max_steps} steps")
    return actual


def parse_size(size: str) -> tuple[int, int]:
    try:
        width_text, height_text = size.lower().split("x", 1)
        width, height = int(width_text), int(height_text)
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=400, detail="size must look like 1024x1024") from exc
    validate_dimensions(width, height)
    return width, height


# QUANTIZE names → torchao config classes. diffusers on main only accepts config instances, not these strings.
TORCHAO_CONFIGS = {
    "float8wo": "Float8WeightOnlyConfig",
    "float8dq": "Float8DynamicActivationFloat8WeightConfig",
    "int8wo": "Int8WeightOnlyConfig",
}


def quantization_config(torch):
    """float8 weight-only roughly halves the ~30 GB of bf16 weights; unified memory makes CPU offload useless."""
    global active_quantization
    if QUANTIZE == "none":
        return None
    if QUANTIZE not in TORCHAO_CONFIGS:
        raise ValueError(f"QUANTIZE must be none or one of {', '.join(TORCHAO_CONFIGS)}, got {QUANTIZE!r}")
    import torchao.quantization
    import transformers
    from diffusers import PipelineQuantizationConfig, TorchAoConfig

    config_class = getattr(torchao.quantization, TORCHAO_CONFIGS[QUANTIZE])
    active_quantization = QUANTIZE
    # diffusers' and transformers' TorchAoConfig differ in signature, so each component gets its own.
    return PipelineQuantizationConfig(quant_mapping={
        "transformer": TorchAoConfig(quant_type=config_class()),
        "text_encoder": transformers.TorchAoConfig(quant_type=config_class()),
    })


def load_pipeline() -> None:
    global pipe, active_attention_backend, active_quantization
    import diffusers
    import torch

    pipeline_class = getattr(diffusers, BACKEND.pipeline)
    options = {"dtype": torch.bfloat16, "device_map": "cuda", "low_cpu_mem_usage": True, "local_files_only": True}
    quantization = quantization_config(torch)
    try:
        pipe = pipeline_class.from_pretrained(MODEL_PATH, **options, **({"quantization_config": quantization} if quantization else {}))
    except Exception as exc:
        if quantization is None:
            raise
        print(f"{QUANTIZE} quantization failed, loading bfloat16 instead: {exc}", flush=True)
        active_quantization = "none"
        pipe = pipeline_class.from_pretrained(MODEL_PATH, **options)
    pipe.set_progress_bar_config(disable=True)
    for method in ("enable_slicing", "enable_tiling"):
        if hasattr(pipe.vae, method):
            getattr(pipe.vae, method)()
    active_attention_backend = "sdpa"
    if ATTENTION_BACKEND:
        try:
            pipe.transformer.set_attention_backend(ATTENTION_BACKEND)
            active_attention_backend = ATTENTION_BACKEND
        except Exception as exc:
            print(f"attention backend {ATTENTION_BACKEND!r} unavailable; using SDPA: {exc}", flush=True)


def generate_image(prompt: str, width: int, height: int, seed: int | None, steps: int | None, guidance_scale: float | None) -> dict:
    if pipe is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    import torch

    validate_dimensions(width, height)
    actual_steps = validate_steps(steps)
    actual_seed = seed if seed is not None else secrets.randbelow(2**31 - 1)
    guidance = BACKEND.guidance_scale if guidance_scale is None else guidance_scale
    guidance_argument = {"true_cfg_scale": guidance} if BACKEND_ID == "qwen-image-2.1" else {"guidance_scale": guidance}
    generator = torch.Generator(device="cuda").manual_seed(actual_seed)
    started = time.perf_counter()
    with generation_lock, torch.inference_mode():
        image = pipe(
            prompt=prompt,
            height=height,
            width=width,
            num_inference_steps=actual_steps,
            generator=generator,
            **guidance_argument,
        ).images[0]
        torch.cuda.synchronize()
        torch.cuda.empty_cache()
    elapsed = time.perf_counter() - started
    filename = f"{BACKEND_ID}-{int(time.time())}-{uuid.uuid4().hex[:10]}.png"
    output_path = OUTPUT_DIR / filename
    image.save(output_path, format="PNG")
    return {
        "filename": filename,
        "path": str(output_path),
        "seed": actual_seed,
        "width": width,
        "height": height,
        "steps": actual_steps,
        "guidance_scale": guidance,
        "elapsed_seconds": round(elapsed, 4),
    }


def encode_png(path: str) -> str:
    with open(path, "rb") as handle:
        return base64.b64encode(handle.read()).decode("ascii")


def response_data(result: dict, response_format: str, base_url: str) -> dict:
    if response_format == "b64_json":
        return {"b64_json": encode_png(result["path"])}
    return {"url": f"{base_url.rstrip('/')}/outputs/{result['filename']}"}


def capabilities() -> dict:
    return {
        "backend": BACKEND_ID,
        "model": MODEL_NAME,
        "sizes": BACKEND.sizes,
        "defaultSteps": DEFAULT_STEPS,
        "maxSteps": BACKEND.max_steps,
        "sizeMultiple": BACKEND.size_multiple,
        "maxPixels": MAX_PIXELS,
        "quantization": active_quantization,
    }


@app.on_event("startup")
def startup() -> None:
    load_pipeline()


@app.get("/health")
def health() -> dict:
    if pipe is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    import torch

    return {
        "ok": True,
        "model": MODEL_NAME,
        "backend": BACKEND_ID,
        "dtype": "bfloat16",
        "quantization": active_quantization,
        "attention_backend": active_attention_backend,
        "cuda_allocated_bytes": torch.cuda.memory_allocated(),
        "cuda_reserved_bytes": torch.cuda.memory_reserved(),
    }


@app.get("/v1/models")
def models() -> dict:
    return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model", "owned_by": BACKEND.owner}]}


@app.get("/v1/capabilities")
def get_capabilities() -> dict:
    return capabilities()


@app.post("/generate")
def generate(request: GenerateRequest, http_request: Request) -> dict:
    result = generate_image(request.prompt, request.width, request.height, request.seed, request.steps, request.guidance_scale)
    result["image"] = response_data(result, request.response_format, str(http_request.base_url))
    return {"model": MODEL_NAME, **result}


@app.post("/v1/images/generations")
def openai_images(request: ImageRequest, http_request: Request) -> dict:
    width, height = parse_size(request.size)
    result = generate_image(request.prompt, width, height, request.seed, request.steps, request.guidance_scale)
    return {
        "created": int(time.time()),
        "model": MODEL_NAME,
        "data": [response_data(result, request.response_format, str(http_request.base_url))],
        "seed": result["seed"],
        "size": request.size,
        "steps": result["steps"],
        "elapsed_seconds": result["elapsed_seconds"],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8336")), log_level="info")
