#!/usr/bin/env bash
# Restart the kiosk Chromium on the Pi so it loads a freshly installed UI.
# Kiosk mode has no reload key, hence kill + relaunch. Uses the exact line in
# labwc's autostart so the Chromium flags live in one place.
# Runs on the Pi: directly (update.sh) or piped over SSH (deploy.sh).
set -e
# QUIRK: from a terminal or SSH there is no desktop session env. Chromium (like
# wlr-randr in kiosk-hw.service) needs these to find the labwc Wayland session.
export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000
LINE="$(grep -m1 '^chromium' ~/.config/labwc/autostart 2>/dev/null | sed 's/[[:space:]]*&[[:space:]]*$//' || true)"
if [[ -z "$LINE" ]]; then
  echo "no chromium line in ~/.config/labwc/autostart — skipping relaunch"
  exit 0
fi
# Don't open the page before the server answers: Chromium shows "This site
# can't be reached" and never retries. Right after a (re)start of kiosk-ui,
# or at boot, it can take a moment.
for _ in $(seq 40); do
  python3 -c 'import urllib.request as u; u.urlopen("http://localhost:8080/", timeout=1)' 2>/dev/null && break
  sleep 0.25
done
pkill -x chromium || true
for _ in $(seq 20); do pgrep -x chromium >/dev/null || break; sleep 0.25; done
setsid bash -c "$LINE" >/dev/null 2>&1 < /dev/null &
echo "chromium relaunched"
