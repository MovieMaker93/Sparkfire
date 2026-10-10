# Video generation: FastH3 (MiniMax H3, video with sound) through a pinned ComfyUI, behind a small Python
# adapter that gives it the endpoints SparklingKit speaks. It uses the PyTorch base image the other GPU
# services use, which is also the torch build the FastH3 bake-off ran on.
ARG PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:25.11-py3@sha256:4a85d8cf6fb3a943280960b8948cf4e9b6eca77b4414c68c9b2c7bb863f79b70

FROM ${PYTORCH_IMAGE}

# The ComfyUI commit the FastH3 graphs were converted and measured on (ComfyUI 0.39.0).
ARG COMFYUI_COMMIT=0df64eb242b7c5759c3e86afd5d1846d923b1033

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# The base already has git. Fetching the one commit by hash pins it without trusting a branch or tag.
RUN git init --quiet /opt/ComfyUI \
    && git -C /opt/ComfyUI fetch --quiet --depth 1 https://github.com/comfyanonymous/ComfyUI.git "${COMFYUI_COMMIT}" \
    && git -C /opt/ComfyUI checkout --quiet FETCH_HEAD \
    && test "$(git -C /opt/ComfyUI rev-parse HEAD)" = "${COMFYUI_COMMIT}" \
    && rm -rf /opt/ComfyUI/.git

COPY requirements.txt /app/requirements.txt
RUN PIP_CONSTRAINT= python3 -m pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app
COPY video_server.py workflows.py extra_model_paths.yaml /app/

HEALTHCHECK --interval=30s --timeout=5s --start-period=2m --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8337}/health" || exit 1

ENTRYPOINT []
CMD ["python3", "/app/video_server.py"]
