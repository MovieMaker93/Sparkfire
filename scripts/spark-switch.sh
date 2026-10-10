#!/usr/bin/env bash
# Switch a single DGX Spark between another large, always-on LLM container (one that needs most of the
# 121 GiB) and SparklingKit's model stack. The two never fit in memory at the same time.
#
#   ./scripts/spark-switch.sh status
#   ./scripts/spark-switch.sh sparklingkit [--yes] [start-dgx-spark.sh options...]
#   ./scripts/spark-switch.sh llm [--yes]
#
# Settings come from the environment or scripts/spark-switch.env (see spark-switch.env.example).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
if [[ -f scripts/spark-switch.env ]]; then
  # shellcheck disable=SC1091
  source scripts/spark-switch.env
fi

LLM_CONTAINER="${LLM_CONTAINER:-}"
LLM_HEALTH_URL="${LLM_HEALTH_URL:-http://127.0.0.1:8000/v1/models}"
LLM_METRICS_URL="${LLM_METRICS_URL:-http://127.0.0.1:8000/metrics}"
LLM_READY_TIMEOUT="${LLM_READY_TIMEOUT:-1200}"
MIN_FREE_GIB="${MIN_FREE_GIB:-100}"

if [[ -z "$LLM_CONTAINER" ]]; then
  printf 'Set LLM_CONTAINER to the container of your other LLM, in scripts/spark-switch.env (see spark-switch.env.example).\n' >&2
  exit 2
fi

ACTION="${1:-status}"
shift || true
ASSUME_YES=false
FORWARD=()
for argument in "$@"; do
  if [[ "$argument" == "--yes" ]]; then ASSUME_YES=true; else FORWARD+=("$argument"); fi
done

available_gib() { free -g | awk '/^Mem:/ {print $7}'; }
container_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == "true" ]]; }
sparklingkit_running() { docker ps --format '{{.Names}}' | grep -qE '^sparklingkit-(parakeet|unlimited-ocr|paddleocr-vlm|hy-mt2|locateanything|image-generation)$'; }

confirm() {
  [[ "$ASSUME_YES" == "true" ]] && return 0
  if [[ ! -t 0 ]]; then
    printf '%s Re-run with --yes to confirm.\n' "$1" >&2
    exit 1
  fi
  printf '%s [y/N] ' "$1"
  read -r answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

# Refuses to stop the LLM while it is serving requests (vLLM-style /metrics; skipped when not exposed).
llm_idle() {
  local metrics running waiting
  metrics="$(curl --silent --max-time 3 "$LLM_METRICS_URL" 2>/dev/null || true)"
  [[ -z "$metrics" ]] && return 0
  running="$(printf '%s\n' "$metrics" | awk '/^vllm:num_requests_running[{ ]/ {sum += $NF} END {print sum + 0}')"
  waiting="$(printf '%s\n' "$metrics" | awk '/^vllm:num_requests_waiting[{ ]/ {sum += $NF} END {print sum + 0}')"
  if (( ${running%.*} > 0 || ${waiting%.*} > 0 )); then
    printf '%s is busy (%s running, %s waiting). Try again when it is idle.\n' "$LLM_CONTAINER" "$running" "$waiting" >&2
    return 1
  fi
}

wait_for_memory() {
  local deadline=$((SECONDS + 180))
  while (( $(available_gib) < MIN_FREE_GIB )); do
    if (( SECONDS >= deadline )); then
      printf 'Only %s GiB available after stopping %s (need %s).\n' "$(available_gib)" "$LLM_CONTAINER" "$MIN_FREE_GIB" >&2
      exit 1
    fi
    sleep 3
  done
}

wait_for_url() {
  local url="$1" timeout="$2" started=$SECONDS
  printf 'Waiting for %s' "$url"
  until curl --fail --silent --max-time 3 "$url" >/dev/null 2>&1; do
    if (( SECONDS - started >= timeout )); then printf '\nNot ready after %ss.\n' "$timeout" >&2; exit 1; fi
    printf '.'
    sleep 5
  done
  printf ' ready\n'
}

case "$ACTION" in
  status)
    printf 'Memory available: %s GiB\n' "$(available_gib)"
    if container_running "$LLM_CONTAINER"; then printf 'LLM (%s): running\n' "$LLM_CONTAINER"; else printf 'LLM (%s): stopped\n' "$LLM_CONTAINER"; fi
    if sparklingkit_running; then printf 'SparklingKit models: running\n'; else printf 'SparklingKit models: stopped\n'; fi
    ;;
  sparklingkit)
    if container_running "$LLM_CONTAINER"; then
      llm_idle || exit 1
      confirm "Stop $LLM_CONTAINER and start SparklingKit's model stack?" || exit 1
      docker stop -t 30 "$LLM_CONTAINER" >/dev/null
      printf 'Stopped %s.\n' "$LLM_CONTAINER"
    fi
    wait_for_memory
    ./scripts/start-dgx-spark.sh start "${FORWARD[@]}"
    ;;
  llm)
    if sparklingkit_running; then
      confirm "Stop SparklingKit's model stack and start $LLM_CONTAINER?" || exit 1
      ./scripts/start-dgx-spark.sh stop
    fi
    wait_for_memory
    docker start "$LLM_CONTAINER" >/dev/null
    wait_for_url "$LLM_HEALTH_URL" "$LLM_READY_TIMEOUT"
    ;;
  *)
    printf 'Usage: %s status|sparklingkit|llm [--yes] [start-dgx-spark.sh options]\n' "$0" >&2
    exit 2
    ;;
esac
