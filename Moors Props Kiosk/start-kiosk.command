#!/bin/bash
# Double-click to launch the 3D director kiosk on macOS (serves the folder locally, opens Chrome full-screen).
cd "$(dirname "$0")"
PORT=8765
python3 serve.py $PORT >/dev/null 2>&1 &
SERVER=$!
sleep 1
open -na "Google Chrome" --args \
  --kiosk --app="http://localhost:$PORT/?autostart" \
  --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.moors-kiosk-profile" \
  --no-first-run --disable-translate --overscroll-history-navigation=0
echo "Kiosk running at http://localhost:$PORT  (close this window to stop the server)"
wait $SERVER
