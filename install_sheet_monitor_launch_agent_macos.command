#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$HOME/Documents/ae_plaque_data"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.sheet2comp.sheet-update-monitor.plist"
PYTHON_BIN="$(command -v python3)"

mkdir -p "$DATA_DIR" "$PLIST_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sheet2comp.sheet-update-monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON_BIN</string>
    <string>$SCRIPT_DIR/sheet_update_monitor.py</string>
    <string>--quiet</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SCRIPT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$DATA_DIR/sheet_update_monitor.log</string>
  <key>StandardErrorPath</key>
  <string>$DATA_DIR/sheet_update_monitor.err.log</string>
</dict>
</plist>
PLIST

chmod 644 "$PLIST_PATH"
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load "$PLIST_PATH"

echo "Монитор Google Sheets установлен и запущен."
echo "Лог: $DATA_DIR/sheet_update_monitor.log"
echo "Ошибки: $DATA_DIR/sheet_update_monitor.err.log"
echo "Остановить: launchctl unload \"$PLIST_PATH\""
