#!/usr/bin/env bash
# Alternative to scripts/update.sh: build on the Mac and push over SSH,
# without going through GitHub. Useful for quick uncommitted experiments.
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
ssh_ "mkdir -p $REMOTE_DIR/ui/content $REMOTE_DIR/hardware $REMOTE_DIR/server $REMOTE_DIR/data"
# The app; leave content/ alone here, it has its own sync below.
rsync_ --delete --exclude 'content/' "$ROOT/ui/dist/" "$PI:$REMOTE_DIR/ui/"
rsync_ --delete "$ROOT/content/" "$PI:$REMOTE_DIR/ui/content/"
HW_CHANGED="$(rsync_ --out-format='%n' "$ROOT/hardware/hardware.py" "$PI:$REMOTE_DIR/hardware/")"
SRV_CHANGED="$(rsync_ --out-format='%n' "$ROOT/server/kiosk_server.py" "$PI:$REMOTE_DIR/server/")"

if [[ -n "$HW_CHANGED" ]]; then
  step "hardware.py changed → restart kiosk-hw"
  ssh_ "sudo systemctl restart kiosk-hw"
fi

if [[ -n "$SRV_CHANGED" ]]; then
  step "kiosk_server.py changed → restart kiosk-ui"
  ssh_ "sudo systemctl restart kiosk-ui"
fi

step "relaunch kiosk browser"
ssh_ 'bash -s' < "$ROOT/scripts/relaunch-browser.sh"

echo "done."
