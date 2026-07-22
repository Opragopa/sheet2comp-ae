#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
JSX="Sheets-to-AE-Comp-Generator.jsx"
PERSON_JSX="person_plates_from_sheet.jsx"
TOPICS_JSX="session_topics_from_sheet.jsx"
SHORTEN_JSX="shorten_render_queue_names.jsx"
CONTENT_PLAN_JSX="content_plan_from_sheet.jsx"
RECORDING_JSX="recording_plates_from_sheet.jsx"
TOPICS_EXAMPLE="session_topics_example.tsv"
PY="download_data.py"
PERSON_PY="download_person_plate_data.py"
PREPARE_PERSON_PY="prepare_person_plate_photos.py"
EXTRACT_PY="extract_session_topics.py"
CONTENT_PLAN_PY="extract_content_plan.py"
RECORDING_PY="extract_recording_plan.py"

if [[ ! -f "$SCRIPT_DIR/$JSX" || ! -f "$SCRIPT_DIR/$PERSON_JSX" || ! -f "$SCRIPT_DIR/$TOPICS_JSX" || ! -f "$SCRIPT_DIR/$SHORTEN_JSX" || ! -f "$SCRIPT_DIR/$CONTENT_PLAN_JSX" || ! -f "$SCRIPT_DIR/$RECORDING_JSX" || ! -f "$SCRIPT_DIR/$TOPICS_EXAMPLE" || ! -f "$SCRIPT_DIR/$PY" || ! -f "$SCRIPT_DIR/$PERSON_PY" || ! -f "$SCRIPT_DIR/$PREPARE_PERSON_PY" || ! -f "$SCRIPT_DIR/$EXTRACT_PY" || ! -f "$SCRIPT_DIR/$CONTENT_PLAN_PY" || ! -f "$SCRIPT_DIR/$RECORDING_PY" ]]; then
  echo "Missing one or more script files."
  exit 1
fi

if [[ "${1:-}" != "" ]]; then
  AE_SCRIPTS="$1"
else
  AE_SCRIPTS=""
  for version in 2026 2025 2024; do
    candidate="/Applications/Adobe After Effects $version/Scripts"
    if [[ -d "$candidate" ]]; then
      AE_SCRIPTS="$candidate"
      break
    fi
  done
fi

if [[ "$AE_SCRIPTS" == "" ]]; then
  echo 'After Effects Scripts folder not found.'
  echo 'Usage: ./install_macos.sh "/Applications/Adobe After Effects 2026/Scripts"'
  exit 1
fi

PYTHON_CMD="$(command -v python3 || true)"
if [[ "$PYTHON_CMD" == "" ]]; then
  echo "Python 3 not found. Install Python 3 and rerun."
  exit 1
fi

mkdir -p "$AE_SCRIPTS"
cp "$SCRIPT_DIR/$JSX" "$AE_SCRIPTS/$JSX"
cp "$SCRIPT_DIR/$PERSON_JSX" "$AE_SCRIPTS/$PERSON_JSX"
cp "$SCRIPT_DIR/$TOPICS_JSX" "$AE_SCRIPTS/$TOPICS_JSX"
cp "$SCRIPT_DIR/$SHORTEN_JSX" "$AE_SCRIPTS/$SHORTEN_JSX"
cp "$SCRIPT_DIR/$CONTENT_PLAN_JSX" "$AE_SCRIPTS/$CONTENT_PLAN_JSX"
cp "$SCRIPT_DIR/$RECORDING_JSX" "$AE_SCRIPTS/$RECORDING_JSX"
cp "$SCRIPT_DIR/$TOPICS_EXAMPLE" "$AE_SCRIPTS/$TOPICS_EXAMPLE"
cp "$SCRIPT_DIR/$PY" "$AE_SCRIPTS/$PY"
cp "$SCRIPT_DIR/$PERSON_PY" "$AE_SCRIPTS/$PERSON_PY"
cp "$SCRIPT_DIR/$PREPARE_PERSON_PY" "$AE_SCRIPTS/$PREPARE_PERSON_PY"
cp "$SCRIPT_DIR/$EXTRACT_PY" "$AE_SCRIPTS/$EXTRACT_PY"
cp "$SCRIPT_DIR/$CONTENT_PLAN_PY" "$AE_SCRIPTS/$CONTENT_PLAN_PY"
cp "$SCRIPT_DIR/$RECORDING_PY" "$AE_SCRIPTS/$RECORDING_PY"

python3 - "$AE_SCRIPTS/ae_parser_config.json" "$PYTHON_CMD" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({"pythonCmd": sys.argv[2]}, ensure_ascii=False, indent=2), encoding="utf-8")
PY

echo "Installed to:"
echo "$AE_SCRIPTS"
echo "Python:"
echo "$PYTHON_CMD"
