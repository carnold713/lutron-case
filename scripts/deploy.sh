#!/usr/bin/env bash
# Build the UI on this machine and push it to the case.
#
#   scripts/deploy.sh            build + sync everything + relaunch the kiosk browser
#   scripts/deploy.sh content    sync content/ only (no build, no relaunch — the
#                                UI re-reads items.json on every tag read)
#
#   PI=lutron@192.168.1.50 scripts/deploy.sh    deploy to a different address
set -euo pipefail

PI="${PI:-lutron@displaycase.local}"
REMOTE_DIR="kiosk"                      # relative to the lutron home dir
# One SSH connection shared by every rsync/ssh below: the loop stays in seconds.
SSH_OPTS="-o ControlMaster=auto -o ControlPath=/tmp/lutron-case-ssh-%r@%h:%p -o ControlPersist=60"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-all}"
rsync_() { rsync -az -e "ssh $SSH_OPTS" "$@"; }
ssh_() { ssh $SSH_OPTS "$PI" "$@"; }

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

python3 -m json.tool "$ROOT/content/items.json" >/dev/null \
  || { echo "content/items.json is not valid JSON — not deploying." >&2; exit 1; }

if [[ "$MODE" == "content" ]]; then
  step "content → $PI:~/$REMOTE_DIR/ui/content/"
  rsync_ --delete "$ROOT/content/" "$PI:$REMOTE_DIR/ui/content/"
  echo "done."
  exit 0
fi

step "build ui"
cd "$ROOT/ui"
[[ -d node_modules ]] || npm ci
npm run build --silent

step "sync → $PI:~/$REMOTE_DIR/"
ssh_ "mkdir -p $REMOTE_DIR/ui/content $REMOTE_DIR/hardware"
# The app; leave content/ alone here, it has its own sync below.
rsync_ --delete --exclude 'content/' "$ROOT/ui/dist/" "$PI:$REMOTE_DIR/ui/"
rsync_ --delete "$ROOT/content/" "$PI:$REMOTE_DIR/ui/content/"
HW_CHANGED="$(rsync_ --out-format='%n' "$ROOT/hardware/hardware.py" "$PI:$REMOTE_DIR/hardware/")"

if [[ -n "$HW_CHANGED" ]]; then
  step "hardware.py changed → restart kiosk-hw"
  ssh_ "sudo systemctl restart kiosk-hw"
fi

step "relaunch kiosk browser"
# The static server serves new files immediately; Chromium just needs to
# reload. Relaunch it with the exact line from labwc's autostart so the flags
# live in one place. Kiosk mode has no reload key, hence kill + relaunch.
ssh_ 'bash -s' <<'REMOTE'
set -e
# QUIRK: over SSH there is no desktop session env. Chromium (like wlr-randr in
# kiosk-hw.service) needs these to find the labwc Wayland session.
export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000
LINE="$(grep -m1 '^chromium' ~/.config/labwc/autostart | sed 's/[[:space:]]*&[[:space:]]*$//' || true)"
if [[ -z "$LINE" ]]; then echo "no chromium line in ~/.config/labwc/autostart — skipping relaunch"; exit 0; fi
pkill -x chromium || true
for _ in $(seq 20); do pgrep -x chromium >/dev/null || break; sleep 0.25; done
setsid bash -c "$LINE" >/dev/null 2>&1 < /dev/null &
REMOTE

echo "done."
