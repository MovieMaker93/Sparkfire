#!/usr/bin/env bash
# Fills the demo app (port 54400) with real jobs on the real models, so the recordings show genuine results.
set -euo pipefail
cd "$(dirname "$0")/work"
api="${DEMO_URL:-http://127.0.0.1:54400}/api"

wait_for() {
  local id="$1" status
  until status=$(curl -s "$api/jobs/$id" | jq -r .status); [[ "$status" =~ ^(done|done_with_warnings|failed|cancelled)$ ]]; do sleep 4; done
  printf '%-14s %s %s\n' "$2" "$status" "$id"
}
image() {
  jq -n --arg p "$1" --arg s "${2:-1024x1024}" '{prompt: $p, size: $s, seed: 7}' \
    | curl -s -H 'Content-Type: application/json' --data-binary @- "$api/modules/text-to-image/jobs" | jq -r .id
}

ocr=$(curl -s -F files=@harbor-point-feasibility.pdf -F moduleId=ocr "$api/jobs" | jq -r .id)
asr=$(curl -s -F files=@reading.wav -F moduleId=transcription "$api/jobs" | jq -r .id)
wind=$(image "Aerial photo of an offshore wind farm at golden hour, twelve white turbines in a calm sea, a small harbor town with a lighthouse in the distance")
books=$(image "A cozy bookshop window at dusk with a hand-painted sign that reads SPARKLING BOOKS")
island=$(image "Isometric illustration of a tiny research station on a floating island, with a red lighthouse, three wind turbines and a wooden dock")
cup=$(image "Studio photo of a ceramic coffee cup with latte art on a walnut table, soft window light, shallow depth of field")
wait_for "$ocr" ocr; wait_for "$asr" transcription
wait_for "$wind" image; wait_for "$books" image; wait_for "$island" image; wait_for "$cup" image

# Grounding on the wind farm picture.
artifact=$(curl -s "$api/jobs/$wind" | jq -r '[.artifacts[] | select(.kind == "generated-image")][0].path')
curl -s "$api/jobs/$wind/files/${artifact#output/}" -o wind-farm.png
grounding=$(curl -s -F files=@wind-farm.png -F 'queries=["wind turbine","lighthouse"]' "$api/modules/grounding/jobs" | jq -r .id)

# Translation and a mind map from the OCR'd report.
text=$(curl -s "$api/jobs/$ocr/files/document.md")
translation=$(jq -n --arg t "$(printf '%s' "$text" | head -c 1500)" '{text: $t, targetLanguage: "Italian"}' \
  | curl -s -H 'Content-Type: application/json' --data-binary @- "$api/modules/translation/text" | jq -r .id)
mindmap=$(jq -n --arg t "$text" '{subject: $t, depth: 3, breadth: 5}' \
  | curl -s -H 'Content-Type: application/json' --data-binary @- "$api/modules/mindmap/jobs" | jq -r .id)
wait_for "$grounding" grounding; wait_for "$translation" translation; wait_for "$mindmap" mindmap
jq -n --arg ocr "$ocr" --arg asr "$asr" --arg wind "$wind" --arg books "$books" --arg island "$island" --arg cup "$cup" \
  --arg grounding "$grounding" --arg translation "$translation" --arg mindmap "$mindmap" '$ARGS.named' > jobs.json
cat jobs.json
