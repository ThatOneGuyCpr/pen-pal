#!/bin/bash
# Screenshots of each screen in the iPhone simulator, from a demo copy of Pen Pal data.
# Usage: screenshots.sh <simulator udid> <path to PenPal.app>
set -euo pipefail
DEV="$1"; APP="$2"; BID=com.thatoneguycpr.penpal
OUT="$(pwd)/screens"; mkdir -p "$OUT"
xcrun simctl boot "$DEV" 2>/dev/null || true
xcrun simctl bootstatus "$DEV" -b
xcrun simctl ui "$DEV" appearance dark
xcrun simctl status_bar "$DEV" override --time 9:41 --batteryState charged --batteryLevel 100 || true
xcrun simctl install "$DEV" "$APP"
DATA=$(xcrun simctl get_app_container "$DEV" "$BID" data)
mkdir -p "$DATA/Documents/Demo"
cp ../tests/fixtures/ios-demo.json "$DATA/Documents/Demo/tracker.json"
for screen in desk journals journal:rm send:pl poems sent settings connect budget insights editsub:s5 find filters dir:copper-nickel poem:p2 quickadd; do
  name=$(echo "$screen" | tr ':' '-')
  SIMCTL_CHILD_PENPAL_FOLDER="$DATA/Documents/Demo" SIMCTL_CHILD_PENPAL_SCREEN="$screen" \
    xcrun simctl launch --terminate-running-process "$DEV" "$BID" >/dev/null
  sleep 6
  xcrun simctl io "$DEV" screenshot "$OUT/$name.png" >/dev/null
  echo "screenshot: $name"
done
xcrun simctl terminate "$DEV" "$BID" || true
# The app saves to the demo folder only when something changes; nothing should have.
cmp -s ../tests/fixtures/ios-demo.json "$DATA/Documents/Demo/tracker.json" && echo "demo data untouched"
