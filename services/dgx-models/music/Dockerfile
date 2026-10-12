# Music generation: YuE2 (m-a-p) behind a small Python adapter that gives it the endpoints Sparkfire speaks.
# The base is the NGC PyTorch build YuE2 was measured on (docs/validation.md): it supports the GB10's
# compute capability 12.1 and runs YuE2's CUDA-graph and FlashAttention path. YuE2 pins torch 2.10, which
# would replace that build, so its other requirements are installed and the package itself goes in
# without dependencies.
ARG PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:26.07-py3@sha256:2140e699b3beaf7f96a0081fd9c9406bc3832b435cdb60dfa2d261f7d2f34a1c

FROM ${PYTORCH_IMAGE}

# Release yue2-v0.1.6, the code the measurements ran.
ARG YUE_COMMIT=9c6c4b349be978b06a9d0d958471a07a6cdeff4d

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt /app/requirements.txt
RUN PIP_CONSTRAINT= python3 -m pip install --no-cache-dir -r /app/requirements.txt

# Fetching the one commit by hash pins it without trusting a branch or tag.
RUN git init --quiet /opt/YuE \
    && git -C /opt/YuE fetch --quiet --depth 1 https://github.com/multimodal-art-projection/YuE.git "${YUE_COMMIT}" \
    && git -C /opt/YuE checkout --quiet FETCH_HEAD \
    && test "$(git -C /opt/YuE rev-parse HEAD)" = "${YUE_COMMIT}" \
    && rm -rf /opt/YuE/.git \
    && PIP_CONSTRAINT= python3 -m pip install --no-cache-dir --no-deps /opt/YuE

WORKDIR /app
COPY music_server.py /app/

HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8339}/health" || exit 1

ENTRYPOINT []
CMD ["python3", "/app/music_server.py"]
