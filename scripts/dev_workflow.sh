#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

CONFIG_PATH="${1:-$REPO_ROOT/tools/ha_event_image_generator/config.yaml}"
OUT_DIR="${2:-$REPO_ROOT/out/event-images}"
WHAT="${3:-images,json}"

cd "$REPO_ROOT"

python3 "$REPO_ROOT/tools/ha_event_image_generator/generate_event_images.py" --config "$CONFIG_PATH"
python3 "$REPO_ROOT/scripts/push_to_m4mm.py" --out-dir "$OUT_DIR" --what "$WHAT"

echo "Done. Card should read: /local/scrolling-calendar-card/event-images/event-image-map.json"
