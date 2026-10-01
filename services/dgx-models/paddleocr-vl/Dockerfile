# CPU-only adapter: PP-DocLayout runs here on Paddle's CPU build (aarch64 wheels exist up to 3.2.2),
# while the PaddleOCR-VL vision-language model is served by vLLM in the paddleocr-vlm container.
FROM python:3.12-slim

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PADDLE_PDX_CACHE_HOME=/root/.cache/paddlex

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN python3 -m pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app
COPY paddle_server.py test_paddle_server.py /app/

ENTRYPOINT []
CMD ["python3", "/app/paddle_server.py"]
