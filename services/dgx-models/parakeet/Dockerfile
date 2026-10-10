# NVIDIA Parakeet speech recognition: parakeet.cpp's parakeet-server (ggml on CUDA) behind a small Python
# adapter that gives it the endpoints SparklingKit already speaks. Both stages use the PyTorch base image
# the other GPU services use, so the CUDA toolkit that builds the engine is the one that runs it.
ARG PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:25.11-py3@sha256:4a85d8cf6fb3a943280960b8948cf4e9b6eca77b4414c68c9b2c7bb863f79b70
ARG PARAKEET_REF=v0.5.0
ARG PARAKEET_COMMIT=1bfbebfaaf493866f49597cd3b7901959d395c60

FROM ${PYTORCH_IMAGE} AS build

ARG PARAKEET_REF
ARG PARAKEET_COMMIT

# The pinned base already has cmake, git, the CUDA 13 toolkit and curl, so nothing is installed from apt.
# A tag can be moved, so the build stops unless it is the exact commit that was tested. The ggml patches are
# applied by CMake when it configures, which needs the submodules.
RUN git clone --branch "${PARAKEET_REF}" --depth 1 --recurse-submodules --shallow-submodules \
        https://github.com/mudler/parakeet.cpp.git /src/parakeet.cpp \
    && test "$(git -C /src/parakeet.cpp rev-parse HEAD)" = "${PARAKEET_COMMIT}"

# Arch 121 is the GB10 (sm_121); CMake turns it into 121a itself. Static libraries keep ggml inside the one
# binary instead of four .so files that would have to travel with it.
RUN cmake -S /src/parakeet.cpp -B /src/build \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DPARAKEET_GGML_CUDA=ON \
        -DCMAKE_CUDA_ARCHITECTURES=121 \
    && cmake --build /src/build --target parakeet-server -j 8 \
    && install -D "$(find /src/build -name parakeet-server -type f -perm -u+x | head -n 1)" /out/parakeet-server \
    && ! ldd /out/parakeet-server | grep -Ei "libggml|libparakeet"

FROM ${PYTORCH_IMAGE}

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

COPY --from=build /out/parakeet-server /usr/local/bin/parakeet-server

COPY requirements.txt /app/requirements.txt
RUN PIP_CONSTRAINT= python3 -m pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app
COPY parakeet_server.py /app/parakeet_server.py

# The adapter only listens on unprivileged ports and reads the read-only model mount, so it needs no root
# (uid 65534 is nobody). The check mirrors the compose health check; PORT keeps it right if the port moves.
USER 65534:65534
HEALTHCHECK --interval=30s --timeout=5s --start-period=1m --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8333}/health" || exit 1

ENTRYPOINT []
CMD ["python3", "/app/parakeet_server.py"]
