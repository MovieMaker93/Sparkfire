#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ACTION="start"
ACCEPT_MODEL_LICENSES=false
SKIP_BUILD=false
SKIP_DOWNLOAD=false
SKIP_PULL=false
DEPLOY_APP=true
REFRESH_IMAGES=false
FORCE_RECREATE=false
OCR_BACKEND="${SPARKLINGKIT_OCR_BACKEND:-unlimited-ocr}"
ASR_BACKEND="${SPARKLINGKIT_ASR_BACKEND:-parakeet}"
IMAGE_BACKEND="${SPARKLINGKIT_IMAGE_BACKEND:-z-image}"

usage() {
  cat <<'EOF'
Usage: ./scripts/start-dgx-spark.sh [start|status|stop] [options]

Set up and run SparklingKit's reference five-model stack on a 128 GB DGX Spark.

Options:
  --accept-model-licenses  Confirm that you reviewed and accept each model's terms
  --skip-build             Reuse existing local container images
  --skip-download          Reuse model files already present under data/dgx-models
  --skip-pull              Reuse existing pulled service images
  --refresh-images         Refresh base images and recreate every service
  --force-recreate         Recreate services after using the selected images
  --models-only            Run the five models and monitor without SparklingKit
  --ocr-backend NAME       unlimited-ocr (default) or paddleocr-vl
  --asr-backend NAME       parakeet (default) or qwen3-asr
  --image-backend NAME     z-image (default), qwen-image-2.1 or qwen-image-2.1-turbo
  -h, --help               Show this help

Examples:
  ./scripts/start-dgx-spark.sh --accept-model-licenses
  ./scripts/start-dgx-spark.sh --models-only --accept-model-licenses
  ./scripts/start-dgx-spark.sh status
  ./scripts/start-dgx-spark.sh stop
EOF
}

while (($#)); do
  case "$1" in
    start|status|stop)
      ACTION="$1"
      ;;
    --accept-model-licenses)
      ACCEPT_MODEL_LICENSES=true
      ;;
    --skip-build)
      SKIP_BUILD=true
      ;;
    --skip-download)
      SKIP_DOWNLOAD=true
      ;;
    --skip-pull)
      SKIP_PULL=true
      ;;
    --refresh-images)
      REFRESH_IMAGES=true
      FORCE_RECREATE=true
      ;;
    --force-recreate)
      FORCE_RECREATE=true
      ;;
    --models-only)
      DEPLOY_APP=false
      ;;
    --ocr-backend|--asr-backend|--image-backend)
      if (($# < 2)); then printf '%s needs a value\n' "$1" >&2; exit 2; fi
      case "$1" in
        --ocr-backend) OCR_BACKEND="$2" ;;
        --asr-backend) ASR_BACKEND="$2" ;;
        *) IMAGE_BACKEND="$2" ;;
      esac
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

case "$OCR_BACKEND" in
  unlimited-ocr) export OCR_MODEL="Unlimited-OCR" ;;
  paddleocr-vl) export OCR_MODEL="PaddleOCR-VL-1.6" ;;
  *) printf 'Unknown OCR backend: %s (use unlimited-ocr or paddleocr-vl)\n' "$OCR_BACKEND" >&2; exit 2 ;;
esac
# Parakeet answers /v1/models as soon as its adapter is up, before the engine has loaded, so it is ready on /health.
case "$ASR_BACKEND" in
  parakeet)
    ASR_SERVICE=parakeet
    ASR_READY_URL="http://127.0.0.1:8333/health"
    export STT_MODEL="Parakeet-TDT-0.6B-v3"
    ;;
  qwen3-asr)
    ASR_SERVICE=qwen3-asr
    ASR_READY_URL="http://127.0.0.1:8333/v1/models"
    export STT_MODEL="Qwen3-ASR-1.7B"
    ;;
  *) printf 'Unknown ASR backend: %s (use parakeet or qwen3-asr)\n' "$ASR_BACKEND" >&2; exit 2 ;;
esac
case "$IMAGE_BACKEND" in
  z-image) export IMAGE_GENERATION_MODEL="Z-Image-Turbo" IMAGE_MEM_LIMIT="${IMAGE_MEM_LIMIT:-26g}" ;;
  qwen-image-2.1) export IMAGE_GENERATION_MODEL="Qwen-Image-2.1" IMAGE_MEM_LIMIT="${IMAGE_MEM_LIMIT:-34g}" ;;
  qwen-image-2.1-turbo) export IMAGE_GENERATION_MODEL="Qwen-Image-2.1-Turbo" IMAGE_MEM_LIMIT="${IMAGE_MEM_LIMIT:-34g}" ;;
  *) printf 'Unknown image backend: %s (use z-image, qwen-image-2.1 or qwen-image-2.1-turbo)\n' "$IMAGE_BACKEND" >&2; exit 2 ;;
esac
export SPARKLINGKIT_OCR_BACKEND="$OCR_BACKEND" SPARKLINGKIT_ASR_BACKEND="$ASR_BACKEND" SPARKLINGKIT_IMAGE_BACKEND="$IMAGE_BACKEND"

COMPOSE=(
  docker compose
  --project-name sparklingkit
  --file compose.yaml
  --file compose.spark.yaml
  --file compose.dgx.yaml
)

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

require_command docker
require_command curl

if ! docker compose version >/dev/null 2>&1; then
  printf 'Docker Compose v2 is required.\n' >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  printf 'The Docker daemon is not available.\n' >&2
  exit 1
fi

if [[ "$ACTION" == "stop" ]]; then
  if [[ "$DEPLOY_APP" == "true" ]]; then
    "${COMPOSE[@]}" stop
    printf 'SparklingKit and the DGX model services are stopped. Persistent data was kept.\n'
  else
    "${COMPOSE[@]}" stop qwen3-asr parakeet unlimited-ocr paddleocr-vl paddleocr-vlm hy-mt2 locateanything z-image dgx-status
    printf 'The DGX model services are stopped. Persistent model data was kept.\n'
  fi
  exit 0
fi

endpoint_status() {
  local label="$1"
  local url="$2"
  if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; then
    printf '  %-18s ready\n' "$label"
  else
    printf '  %-18s unavailable\n' "$label"
  fi
}

show_status() {
  "${COMPOSE[@]}" ps
  printf '\nEndpoints\n'
  endpoint_status "System status" "http://127.0.0.1:8330/health"
  endpoint_status "Multimodal LLM" "http://127.0.0.1:8331/v1/models"
  endpoint_status "OCR" "http://127.0.0.1:8332/v1/models"
  endpoint_status "Transcription" "http://127.0.0.1:8333/v1/models"
  endpoint_status "Translation" "http://127.0.0.1:8334/health"
  endpoint_status "Grounding" "http://127.0.0.1:8335/health"
  endpoint_status "Image generation" "http://127.0.0.1:8336/health"
  if [[ "$DEPLOY_APP" == "true" ]]; then
    endpoint_status "SparklingKit" "http://127.0.0.1:54321/api/health"
  fi
}

if [[ "$ACTION" == "status" ]]; then
  show_status
  exit 0
fi

machine_arch="$(uname -m)"
if [[ "$(uname -s)" != "Linux" || "$machine_arch" != "aarch64" ]]; then
  printf 'This reference stack is validated for the ARM64 NVIDIA DGX Spark (detected %s/%s).\n' "$(uname -s)" "$machine_arch" >&2
  printf 'Use compose.yaml with your own service endpoints on other systems.\n' >&2
  exit 1
fi

require_command nvidia-smi
if ! nvidia-smi >/dev/null 2>&1; then
  printf 'NVIDIA GPU access is unavailable. Check the DGX driver and container runtime.\n' >&2
  exit 1
fi

# Only the Qwen3-ASR container mounts this ptxas.
if [[ "$ASR_BACKEND" == "qwen3-asr" && ! -x /usr/local/cuda-13.0/bin/ptxas ]]; then
  printf 'CUDA 13 ptxas was not found at /usr/local/cuda-13.0/bin/ptxas.\n' >&2
  printf 'Update DGX OS/CUDA or adjust the ASR mount in compose.dgx.yaml.\n' >&2
  exit 1
fi

model_root="$PROJECT_DIR/data/dgx-models"
license_marker="$model_root/.model-licenses-accepted"
mkdir -p "$model_root" "$PROJECT_DIR/data/dgx-runtime" "$PROJECT_DIR/data/dgx-outputs/images"

if [[ "$ACCEPT_MODEL_LICENSES" == "true" ]]; then
  touch "$license_marker"
elif [[ ! -f "$license_marker" ]]; then
  cat >&2 <<'EOF'
The model weights are not covered by SparklingKit's Apache 2.0 license.
Review the five publishers' model cards before downloading. In particular,
nvidia/LocateAnything-3B is currently licensed for non-commercial/research use,
and Qwen/Qwen-Image-2.1 (--image-backend qwen-image-2.1 or qwen-image-2.1-turbo) uses the Qwen Research License.
EOF
  if [[ -t 0 ]]; then
    printf 'Have you reviewed and accepted the model terms? [y/N] ' >&2
    read -r answer
    if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
      touch "$license_marker"
    else
      printf 'Setup cancelled. Re-run with --accept-model-licenses after reviewing the terms.\n' >&2
      exit 1
    fi
  else
    printf 'Re-run with --accept-model-licenses after reviewing the terms.\n' >&2
    exit 1
  fi
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  printf '\nBuilding SparklingKit and DGX service images...\n'
  build_targets=(model-downloader "$ASR_SERVICE" hy-mt2 locateanything z-image dgx-status)
  if [[ "$OCR_BACKEND" == "paddleocr-vl" ]]; then build_targets+=(paddleocr-vl); fi
  if [[ "$DEPLOY_APP" == "true" ]]; then build_targets+=(app); fi
  if [[ "$REFRESH_IMAGES" == "true" ]]; then
    "${COMPOSE[@]}" --profile tools build --pull "${build_targets[@]}"
  else
    "${COMPOSE[@]}" --profile tools build "${build_targets[@]}"
  fi
  pull_targets=()
  if [[ "$OCR_BACKEND" == "unlimited-ocr" ]]; then pull_targets+=(unlimited-ocr); fi
  if [[ "$DEPLOY_APP" == "true" ]]; then pull_targets+=(redis); fi
  if [[ "$SKIP_PULL" != "true" ]]; then "${COMPOSE[@]}" pull "${pull_targets[@]}"; fi
fi

download_model() {
  local repository="$1"
  local revision="$2"
  local destination="$3"
  local include="${4:-}"
  local completion_marker="$model_root/$destination/.sparklingkit-$revision.complete"
  local include_args=()

  if [[ -f "$completion_marker" ]]; then
    printf 'Using existing %-34s %s\n' "$repository" "$revision"
    return
  fi

  # A repository that ships several variants (GGUF files) is fetched for one file only.
  if [[ -n "$include" ]]; then include_args=(--include "$include"); fi

  printf 'Downloading %-34s %s\n' "$repository" "$revision"
  mkdir -p "$model_root/$destination"
  "${COMPOSE[@]}" --profile tools run --rm --no-deps \
    --user "$(id -u):$(id -g)" \
    model-downloader \
    download "$repository" \
    --revision "$revision" \
    --local-dir "/models/$destination" \
    "${include_args[@]}" \
    --max-workers 8

  if [[ ! -s "$model_root/$destination/config.json" && ! -s "$model_root/$destination/model_index.json" ]] \
    && ! compgen -G "$model_root/$destination/*.gguf" >/dev/null; then
    printf 'Download validation failed for %s: no model configuration found\n' "$repository" >&2
    exit 1
  fi
  touch "$completion_marker"
}

if [[ "$SKIP_DOWNLOAD" != "true" ]]; then
  printf '\nDownloading pinned model revisions (existing downloads are reused)...\n'
  if [[ "$OCR_BACKEND" == "paddleocr-vl" ]]; then
    download_model \
      "PaddlePaddle/PaddleOCR-VL-1.6" \
      "c5630abae1d940eafe0697512a0325494b02ab42" \
      "PaddlePaddle/PaddleOCR-VL-1.6"
  else
    download_model \
      "baidu/Unlimited-OCR" \
      "27a5997fa0524f9adcf9e2f3d5e7d3f784434fa5" \
      "baidu/Unlimited-OCR"
  fi
  if [[ "$ASR_BACKEND" == "qwen3-asr" ]]; then
    download_model \
      "Qwen/Qwen3-ASR-1.7B" \
      "7278e1e70fe206f11671096ffdd38061171dd6e5" \
      "Qwen/Qwen3-ASR-1.7B"
  else
    download_model \
      "mudler/parakeet-cpp-gguf" \
      "741158ae71e64ef5c89385862c18f777d07a97a1" \
      "mudler/parakeet-cpp-gguf" \
      "tdt-0.6b-v3-f16.gguf"
  fi
  download_model \
    "tencent/Hy-MT2-1.8B-FP8" \
    "b3f6f590920726d69a5504293bd4f36d50e5f681" \
    "tencent/Hy-MT2-1.8B-FP8"
  download_model \
    "nvidia/LocateAnything-3B" \
    "c32291ca5e996f5a7a485845b4f57a233936bba0" \
    "nvidia/LocateAnything-3B"
  if [[ "$IMAGE_BACKEND" == "qwen-image-2.1" ]]; then
    download_model \
      "Qwen/Qwen-Image-2.1" \
      "d26bb61231c349cf6b7896fa83353113880e1ba3" \
      "Qwen/Qwen-Image-2.1"
  elif [[ "$IMAGE_BACKEND" == "qwen-image-2.1-turbo" ]]; then
    download_model \
      "Qwen/Qwen-Image-2.1-Turbo" \
      "d65dbc9a7e8f6b5479e33dee6030eaab2a906509" \
      "Qwen/Qwen-Image-2.1-Turbo"
  else
    download_model \
      "Tongyi-MAI/Z-Image-Turbo" \
      "f332072aa78be7aecdf3ee76d5c247082da564a6" \
      "Tongyi-MAI/Z-Image-Turbo"
  fi
fi

wait_for_endpoint() {
  local service="$1"
  local label="$2"
  local url="$3"
  local timeout_seconds="$4"
  local started_at
  started_at="$(date +%s)"

  printf 'Waiting for %s' "$label"
  while ! curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; do
    if (( $(date +%s) - started_at >= timeout_seconds )); then
      printf '\n%s did not become ready within %s seconds.\n' "$label" "$timeout_seconds" >&2
      "${COMPOSE[@]}" logs --tail 120 "$service" >&2
      exit 1
    fi
    printf '.'
    sleep 5
  done
  printf ' ready\n'
}

start_service() {
  local service="$1"
  local label="$2"
  local url="$3"
  local timeout_seconds="$4"

  printf '\nStarting %s...\n' "$label"
  if [[ "$FORCE_RECREATE" == "true" ]]; then
    "${COMPOSE[@]}" up -d --no-deps --force-recreate "$service"
  else
    "${COMPOSE[@]}" up -d --no-deps "$service"
  fi
  wait_for_endpoint "$service" "$label" "$url" "$timeout_seconds"
}

printf '\nStarting the five models sequentially...\n'
# The two ASR backends share port 8333 and the two OCR backends port 8332: stop the one that is not selected.
if [[ "$ASR_BACKEND" == "parakeet" ]]; then "${COMPOSE[@]}" stop qwen3-asr; else "${COMPOSE[@]}" stop parakeet; fi
start_service "$ASR_SERVICE" "Transcription ($ASR_BACKEND)" "$ASR_READY_URL" 600
if [[ "$OCR_BACKEND" == "paddleocr-vl" ]]; then
  "${COMPOSE[@]}" stop unlimited-ocr
  start_service paddleocr-vlm "OCR vision-language model" "http://127.0.0.1:8342/v1/models" 600
  start_service paddleocr-vl "OCR layout adapter" "http://127.0.0.1:8332/health" 900
else
  "${COMPOSE[@]}" stop paddleocr-vl paddleocr-vlm
  start_service unlimited-ocr "OCR" "http://127.0.0.1:8332/v1/models" 600
fi
start_service hy-mt2 "Translation" "http://127.0.0.1:8334/health" 600
start_service locateanything "Grounding" "http://127.0.0.1:8335/health" 900
start_service z-image "Image generation ($IMAGE_BACKEND)" "http://127.0.0.1:8336/health" 1800
start_service dgx-status "System status" "http://127.0.0.1:8330/health" 120

if [[ "$DEPLOY_APP" == "true" ]]; then
  printf '\nStarting Redis and SparklingKit...\n'
  if [[ "$FORCE_RECREATE" == "true" ]]; then
    "${COMPOSE[@]}" up -d --force-recreate redis app
  else
    "${COMPOSE[@]}" up -d redis app
  fi
  wait_for_endpoint app "SparklingKit" "http://127.0.0.1:54321/api/health" 180
  printf '\nSparklingKit is ready at http://localhost:54321\n\n'
else
  dgx_address="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  printf '\nThe DGX model stack is ready.\n'
  if [[ -n "$dgx_address" ]]; then
    printf 'Use %s as the model host when setting up SparklingKit on another server.\n\n' "$dgx_address"
  else
    printf 'Use this DGX Spark hostname or LAN address when setting up SparklingKit.\n\n'
  fi
fi
show_status
