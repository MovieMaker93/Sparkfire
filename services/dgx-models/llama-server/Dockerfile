# The chat LLM, Saluki 27B: llama.cpp's llama-server (ggml on CUDA), which speaks the OpenAI API itself, so it
# needs no adapter. Like Parakeet, both stages use the PyTorch base image the other GPU services use, so the CUDA
# toolkit that builds the engine is the one that runs it, and its layers are already on the Spark.
ARG PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:25.11-py3@sha256:4a85d8cf6fb3a943280960b8948cf4e9b6eca77b4414c68c9b2c7bb863f79b70
ARG LLAMA_CPP_REF=b11576
ARG LLAMA_CPP_COMMIT=358a420ec4ed59b6b0be08b1d1f71dd478b99a99

FROM ${PYTORCH_IMAGE} AS build

ARG LLAMA_CPP_REF
ARG LLAMA_CPP_COMMIT

# The pinned base already has cmake, git and the CUDA 13 toolkit, so nothing is installed from apt.
# A tag can be moved, so the build stops unless it is the exact commit that was pinned.
RUN git clone --branch "${LLAMA_CPP_REF}" --depth 1 https://github.com/ggml-org/llama.cpp.git /src/llama.cpp \
    && test "$(git -C /src/llama.cpp rev-parse HEAD)" = "${LLAMA_CPP_COMMIT}"

# Arch 121 is the GB10 (sm_121); ggml's CMake turns it into 121a itself. Static libraries keep ggml and the
# vision add-on's mtmd inside the one binary. Models come from the read-only mount, so no download support.
RUN cmake -S /src/llama.cpp -B /src/build \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DGGML_CUDA=ON \
        -DCMAKE_CUDA_ARCHITECTURES=121 \
        -DLLAMA_CURL=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
    && cmake --build /src/build --target llama-server -j 8 \
    && install -D "$(find /src/build -name llama-server -type f -perm -u+x | head -n 1)" /out/llama-server \
    && ! ldd /out/llama-server | grep -Ei "libggml|libllama|libmtmd"

FROM ${PYTORCH_IMAGE}

COPY --from=build /out/llama-server /usr/local/bin/llama-server

# The server only listens on an unprivileged port and reads the read-only model mount, so it needs no root
# (uid 65534 is nobody). The check mirrors the compose health check; PORT keeps it right if the port moves.
USER 65534:65534
HEALTHCHECK --interval=30s --timeout=5s --start-period=2m --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8331}/health" || exit 1

ENTRYPOINT ["llama-server"]
