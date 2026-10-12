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
CHECK_MEMORY=true
VIDEO_BACKEND="${SPARKFIRE_VIDEO_BACKEND:-fasth3}"

usage() {
  cat <<'EOF'
Usage: ./scripts/start-dgx-spark.sh [start|status|stop] [options]

Set up and run Sparkfire's model stack on a 128 GB DGX Spark. Its models are fixed, chosen and measured
to share the Spark's memory: Saluki 27B (chat), PaddleOCR-VL-1.6 (OCR), Parakeet-TDT-0.6B-v3
(transcription), Hy-MT2-1.8B-FP8 (translation), Qwen-Image-2.1-Turbo (images), FastH3 (video) and
YuE2-3B (music), with SearXNG for web search in chat.

Options:
  --accept-model-licenses  Confirm that you reviewed and accept each model's terms
  --skip-build             Reuse existing local container images
  --skip-download          Reuse model files already present under data/dgx-models
  --skip-pull              Reuse existing pulled service images
  --refresh-images         Refresh base images and recreate every service
  --force-recreate         Recreate services after using the selected images
  --models-only            Run the model services and monitor without Sparkfire
  --skip-memory-check      Start even when less memory is free than a fresh start needs
  --video-backend NAME     fasth3 (default) or none; FastH3's license does not cover the EU, the UK,
                           South Korea or the US, so leave video out there
  -h, --help               Show this help

Examples:
  ./scripts/start-dgx-spark.sh --accept-model-licenses
  ./scripts/start-dgx-spark.sh --models-only --accept-model-licenses
  ./scripts/start-dgx-spark.sh status
  ./scripts/start-dgx-spark.sh stop
EOF
}

# The stack's models are fixed. These options stay so that commands written for earlier versions still run when
# they name what the stack uses; any other choice is refused.
check_fixed_backend() {
  local option="$1" value="$2" fixed
  case "$option" in
    --ocr-backend) fixed=paddleocr-vl ;;
    --asr-backend) fixed=parakeet ;;
    --image-backend) fixed=qwen-image-2.1-turbo ;;
    --search-backend) fixed=searxng ;;
    *) fixed=yue2 ;;
  esac
  if [[ "$value" != "$fixed" ]]; then
    printf '%s %s is not available: the stack always uses %s.\n' "$option" "$value" "$fixed" >&2
    exit 2
  fi
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
    --skip-memory-check)
      CHECK_MEMORY=false
      ;;
    --video-backend)
      if (($# < 2)); then printf '%s needs a value\n' "$1" >&2; exit 2; fi
      VIDEO_BACKEND="$2"
      shift
      ;;
    --ocr-backend|--asr-backend|--image-backend|--search-backend|--music-backend)
      if (($# < 2)); then printf '%s needs a value\n' "$1" >&2; exit 2; fi
      check_fixed_backend "$1" "$2"
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

# Without a video service, the app's video endpoint and the monitor's video port stay empty, so neither
# reports the service as missing.
case "$VIDEO_BACKEND" in
  fasth3) export SPARKFIRE_VIDEO_BASE_URL="http://host.docker.internal:8337/v1" SPARKFIRE_VIDEO_PORT="8337" ;;
  none) export SPARKFIRE_VIDEO_BASE_URL="" SPARKFIRE_VIDEO_PORT="" ;;
  *) printf 'Unknown video backend: %s (use fasth3 or none)\n' "$VIDEO_BACKEND" >&2; exit 2 ;;
esac
# SearXNG signs its tokens with a secret that stays on this machine (data/ is never committed).
SEARXNG_SECRET_FILE="data/searxng/secret"
if [[ ! -s "$SEARXNG_SECRET_FILE" ]]; then
  mkdir -p "$(dirname "$SEARXNG_SECRET_FILE")"
  (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$SEARXNG_SECRET_FILE")
fi
SEARXNG_SECRET="$(cat "$SEARXNG_SECRET_FILE")"
export SEARXNG_SECRET

COMPOSE=(
  docker compose
  --project-name sparkfire
  --file compose.yaml
  --file compose.spark.yaml
  --file compose.dgx.yaml
  --file compose.search.yaml
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

# Installs from before the rename to Sparkfire ran under this compose project. Its containers, retired services
# among them, would keep restarting (unless-stopped) beside the new ones and hold the memory the stack's budget
# assumes is free, so they and their network are removed. Its Redis volume held only the job queue and is left
# alone; the app queues unfinished jobs again from data/ when it starts.
LEGACY_PROJECT=sparklingkit

remove_legacy_containers() {
  local containers=()
  mapfile -t containers < <(docker ps -aq --filter "label=com.docker.compose.project=$LEGACY_PROJECT")
  ((${#containers[@]})) || return 0
  docker rm -f "${containers[@]}" >/dev/null
  docker network rm "${LEGACY_PROJECT}_default" >/dev/null 2>&1 || true
  printf 'Removed %s containers left from before the rename to Sparkfire.\n' "${#containers[@]}"
}

if [[ "$ACTION" == "stop" ]]; then
  remove_legacy_containers
  if [[ "$DEPLOY_APP" == "true" ]]; then
    "${COMPOSE[@]}" stop
    printf 'Sparkfire and the DGX model services are stopped. Persistent data was kept.\n'
  else
    "${COMPOSE[@]}" stop saluki parakeet paddleocr-vl paddleocr-vlm hy-mt2 image-generation video-generation music-generation searxng dgx-status
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
  endpoint_status "LLM (Saluki)" "http://127.0.0.1:8331/health"
  endpoint_status "OCR" "http://127.0.0.1:8332/v1/models"
  endpoint_status "Transcription" "http://127.0.0.1:8333/health"
  endpoint_status "Translation" "http://127.0.0.1:8334/health"
  endpoint_status "Image generation" "http://127.0.0.1:8336/health"
  if [[ "$VIDEO_BACKEND" != "none" ]]; then
    endpoint_status "Video generation" "http://127.0.0.1:8337/health"
  fi
  endpoint_status "Music generation" "http://127.0.0.1:8339/health"
  endpoint_status "Web search" "http://127.0.0.1:8338/healthz"
  if [[ "$DEPLOY_APP" == "true" ]]; then
    endpoint_status "Sparkfire" "http://127.0.0.1:54321/api/health"
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

model_root="$PROJECT_DIR/data/dgx-models"
license_marker="$model_root/.model-licenses-accepted"
mkdir -p "$model_root" "$PROJECT_DIR/data/dgx-runtime" "$PROJECT_DIR/data/dgx-outputs/images"

if [[ "$ACCEPT_MODEL_LICENSES" == "true" ]]; then
  touch "$license_marker"
elif [[ ! -f "$license_marker" ]]; then
  cat >&2 <<'EOF'
The model weights are not covered by Sparkfire's Apache 2.0 license.
Review the publishers' model cards before downloading, Underdog Saluki 27B's (the chat model) among them.
In particular, Qwen/Qwen-Image-2.1-Turbo (image generation) uses the Qwen Research License, which is
non-commercial, and FastH3 (video generation) uses the MiniMax H3 Community License, which grants use only
"worldwide, excluding" the European Union, the United Kingdom, South Korea and the United States, and asks
that shared videos be disclosed as machine-generated. Use --video-backend none where it does not apply.
YuE2 (music generation) uses CC BY-NC 4.0 with a creator permission: personal users and creators may
publish and sell their songs, academic use is non-commercial, and companies need a license from m-a-p.
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
  printf '\nBuilding Sparkfire and DGX service images...\n'
  build_targets=(model-downloader saluki parakeet paddleocr-vl hy-mt2 image-generation music-generation dgx-status)
  if [[ "$VIDEO_BACKEND" == "fasth3" ]]; then build_targets+=(video-generation); fi
  if [[ "$DEPLOY_APP" == "true" ]]; then build_targets+=(app); fi
  if [[ "$REFRESH_IMAGES" == "true" ]]; then
    "${COMPOSE[@]}" --profile tools build --pull "${build_targets[@]}"
  else
    "${COMPOSE[@]}" --profile tools build "${build_targets[@]}"
  fi
  pull_targets=(paddleocr-vlm searxng)
  if [[ "$DEPLOY_APP" == "true" ]]; then pull_targets+=(redis); fi
  if [[ "$SKIP_PULL" != "true" ]]; then "${COMPOSE[@]}" pull "${pull_targets[@]}"; fi
fi

download_model() {
  local repository="$1"
  local revision="$2"
  local destination="$3"
  local includes=("${@:4}")
  local completion_marker="$model_root/$destination/.sparkfire-$revision.complete"
  local include_args=()
  local file

  # A marker written before the rename to Sparkfire has another prefix; any marker for this revision counts.
  if compgen -G "$model_root/$destination/.*-$revision.complete" >/dev/null; then
    printf 'Using existing %-34s %s\n' "$repository" "$revision"
    return
  fi

  # A repository that ships several variants (GGUF files, precisions) is fetched for the listed files only.
  if ((${#includes[@]})); then include_args=(--include "${includes[@]}"); fi

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

  if ((${#includes[@]})); then
    for file in "${includes[@]}"; do
      if [[ ! -s "$model_root/$destination/$file" ]]; then
        printf 'Download validation failed for %s: %s is missing\n' "$repository" "$file" >&2
        exit 1
      fi
    done
  elif [[ ! -s "$model_root/$destination/config.json" && ! -s "$model_root/$destination/model_index.json" ]]; then
    printf 'Download validation failed for %s: no model configuration found\n' "$repository" >&2
    exit 1
  fi
  touch "$completion_marker"
}

if [[ "$SKIP_DOWNLOAD" != "true" ]]; then
  printf '\nDownloading pinned model revisions (existing downloads are reused)...\n'
  # The chat model and its vision add-on. Not pinned yet: Hugging Face could not be reached when this was
  # written, so this takes the current revision once and reuses it; pin its commit here.
  download_model \
    "ConwayResearch/Underdog-Saluki-27B-1.0" \
    "main" \
    "ConwayResearch/Underdog-Saluki-27B-1.0" \
    "Underdog-Saluki-27B-1.0-IQ2-mix.gguf" \
    "mmproj-Underdog-Saluki-27B-1.0-F16.gguf"
  download_model \
    "PaddlePaddle/PaddleOCR-VL-1.6" \
    "c5630abae1d940eafe0697512a0325494b02ab42" \
    "PaddlePaddle/PaddleOCR-VL-1.6"
  download_model \
    "mudler/parakeet-cpp-gguf" \
    "741158ae71e64ef5c89385862c18f777d07a97a1" \
    "mudler/parakeet-cpp-gguf" \
    "tdt-0.6b-v3-f16.gguf"
  download_model \
    "tencent/Hy-MT2-1.8B-FP8" \
    "b3f6f590920726d69a5504293bd4f36d50e5f681" \
    "tencent/Hy-MT2-1.8B-FP8"
  download_model \
    "Qwen/Qwen-Image-2.1-Turbo" \
    "d65dbc9a7e8f6b5479e33dee6030eaab2a906509" \
    "Qwen/Qwen-Image-2.1-Turbo"
  if [[ "$VIDEO_BACKEND" == "fasth3" ]]; then
    # FastH3 Trim (Fast) with the text encoder and decoders both variants share, then the V2 model (Sharp).
    download_model \
      "FastVideo/FastVideo-FastH3-Trim-Comfy" \
      "f66c13dc17391dd4da99242a407918b92bf7d5fc" \
      "FastVideo/FastVideo-FastH3-Trim-Comfy" \
      "diffusion_models/fastvideo_fasth3_trim_8step_nvfp4.safetensors" \
      "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \
      "vae/minimax_h3_video_vae_int8_convrot.safetensors" \
      "vae/minimax_h3_audio_vae_fp32.safetensors"
    download_model \
      "FastVideo/FastVideo-FastH3-Comfy" \
      "ec1e3aa374a91c57b0b94a1623b7e657c0498cf2" \
      "FastVideo/FastVideo-FastH3-Comfy" \
      "diffusion_models/fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
  fi
  # The song model (score, semantic and acoustic stages) and the audio decoder, about 7.8 GB together.
  download_model "m-a-p/YuE2-3B" "8f24312f187763b9854adeec87e437e2b03bbff1" "m-a-p/YuE2-3B"
  download_model "m-a-p/YuE2-Vae" "152733a19ad43aa67e367f9b5503ef8075bb5126" "m-a-p/YuE2-Vae"
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

remove_legacy_containers

# The stack peaks around 60 GiB while its models load: about 39 GiB for the services, plus Saluki's 13 to
# 21.5 GiB (docs/validation.md). Next to something that already holds most of the Spark, another LLM for
# instance, it would run the machine out of memory halfway, so a fresh start first checks there is room. With
# the stack's models already running, their memory counts as used, so the check is skipped.
STACK_START_GIB=64
check_memory_for_start() {
  local running available
  running="$(docker ps --filter "label=com.docker.compose.project=sparkfire" --format '{{.Names}}' | grep -cE '^sparkfire-(saluki|parakeet|paddleocr-vlm|hy-mt2|image-generation)$' || true)"
  ((running == 0)) || return 0
  available="$(awk '/^MemAvailable:/ {printf "%d", $2 / 1048576}' /proc/meminfo)"
  ((available >= STACK_START_GIB)) && return 0
  printf '\nOnly %s GiB of memory is free; the stack needs about %s GiB to start.\n' "$available" "$STACK_START_GIB" >&2
  printf 'Processes holding GPU memory now:\n' >&2
  nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader >&2 || true
  printf 'Stop them first (another LLM: ./scripts/spark-switch.sh sparkfire), or pass --skip-memory-check.\n' >&2
  exit 1
}
if [[ "$CHECK_MEMORY" == "true" ]]; then check_memory_for_start; fi

printf '\nStarting the models sequentially...\n'
# Saluki first: it loads in seconds with no peak, and holding its 13 GiB before the others start keeps a restart
# from leaving it without room.
start_service saluki "LLM (Saluki 27B)" "http://127.0.0.1:8331/health" 600
# Parakeet's adapter answers /v1/models before the engine has loaded, so readiness is checked on /health.
start_service parakeet "Transcription" "http://127.0.0.1:8333/health" 600
start_service paddleocr-vlm "OCR vision-language model" "http://127.0.0.1:8342/v1/models" 600
start_service paddleocr-vl "OCR layout adapter" "http://127.0.0.1:8332/health" 900
start_service hy-mt2 "Translation" "http://127.0.0.1:8334/health" 600
start_service image-generation "Image generation (Qwen-Image-2.1-Turbo)" "http://127.0.0.1:8336/health" 1800
# Video loads nothing until its first job, so it adds no loading peak here.
if [[ "$VIDEO_BACKEND" == "fasth3" ]]; then
  start_service video-generation "Video generation (FastH3)" "http://127.0.0.1:8337/health" 600
else
  "${COMPOSE[@]}" stop video-generation
fi
# Music loads nothing until its first song either.
start_service music-generation "Music generation (YuE2)" "http://127.0.0.1:8339/health" 300
# SearXNG holds no model (about 200 MB), so it starts after the models without changing their memory order.
start_service searxng "Web search (SearXNG)" "http://127.0.0.1:8338/healthz" 120
start_service dgx-status "System status" "http://127.0.0.1:8330/health" 120

if [[ "$DEPLOY_APP" == "true" ]]; then
  printf '\nStarting Redis and Sparkfire...\n'
  if [[ "$FORCE_RECREATE" == "true" ]]; then
    "${COMPOSE[@]}" up -d --force-recreate redis app
  else
    "${COMPOSE[@]}" up -d redis app
  fi
  wait_for_endpoint app "Sparkfire" "http://127.0.0.1:54321/api/health" 180
  printf '\nSparkfire is ready at http://localhost:54321\n\n'
else
  dgx_address="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  printf '\nThe DGX model stack is ready.\n'
  if [[ -n "$dgx_address" ]]; then
    printf 'Use %s as the model host when setting up Sparkfire on another server.\n\n' "$dgx_address"
  else
    printf 'Use this DGX Spark hostname or LAN address when setting up Sparkfire.\n\n'
  fi
fi
show_status
