#!/usr/bin/env bash
# Run ON the Pi. Pulls the latest from GitHub, builds the UI, installs it into
# ~/kiosk and relaunches the kiosk browser. GitHub is the source of truth:
# edit on the Mac, git push, then on the Pi:
#
#   ~/lutron-case/scripts/update.sh            pull + install what changed
#   ~/lutron-case/scripts/update.sh --force    rebuild and reinstall everything
#
# Only rebuilds the UI when the installed build doesn't match ui/; a
# content-only change installs in seconds and needs no browser relaunch (the
# UI re-reads items.json on every tag read). Restarts kiosk-hw only when hardware.py or its unit changed.
set -euo pipefail

# Everything lives in main(): `git pull` may rewrite this very file, and bash
# reads scripts as it runs them. A function is parsed whole before it starts.
main() {
  local REPO KIOSK FORCE=0 BEFORE AFTER
  REPO="$(cd "$(dirname "$0")/.." && pwd)"
  KIOSK="$HOME/kiosk"
  [[ "${1:-}" == "--force" ]] && FORCE=1

  step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
  changed() { [[ $FORCE == 1 ]] || ! git diff --quiet "$BEFORE" "$AFTER" -- "$@"; }

  cd "$REPO"
  step "pull from GitHub ($(git rev-parse --abbrev-ref HEAD))"
  BEFORE="$(git rev-parse HEAD)"
  git pull --ff-only
  AFTER="$(git rev-parse HEAD)"
  if [[ "$BEFORE" == "$AFTER" && $FORCE == 0 ]]; then
    echo "already up to date (use --force to reinstall anyway)"
  else
    git --no-pager log --oneline "$BEFORE..$AFTER" 2>/dev/null || true
  fi

  # Never install content that would break the page.
  python3 -m json.tool content/items.json >/dev/null \
    || { echo "content/items.json is not valid JSON — not installing." >&2; exit 1; }

  mkdir -p "$KIOSK/ui/content" "$KIOSK/hardware"
  # Rebuild when the installed build doesn't match ui/ in this checkout. The
  # stamp holds git's hash of the ui/ tree, so an older or foreign install
  # (or a build that failed halfway) is always replaced.
  local UI_BUILT=0 UI_TREE STAMP="$KIOSK/ui/.ui-tree"
  UI_TREE="$(git rev-parse HEAD:ui)"
  if [[ $FORCE == 1 || "$(cat "$STAMP" 2>/dev/null)" != "$UI_TREE" ]]; then
    step "build ui"
    cd "$REPO/ui"
    if changed package-lock.json || [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
    npm run build --silent
    cd "$REPO"
    # The app; content/ has its own sync below.
    rsync -a --delete --exclude 'content/' ui/dist/ "$KIOSK/ui/"
    echo "$UI_TREE" > "$STAMP"
    UI_BUILT=1
  fi

  step "content"
  rsync -a --delete --itemize-changes content/ "$KIOSK/ui/content/"

  local HW_RESTART=0 UI_RESTART=0
  mkdir -p "$KIOSK/server" "$KIOSK/data"
  if ! cmp -s hardware/hardware.py "$KIOSK/hardware/hardware.py"; then
    cp hardware/hardware.py "$KIOSK/hardware/hardware.py"
    HW_RESTART=1
  fi
  # The web server (serves the UI, stores tag assignments in ~/kiosk/data).
  if ! cmp -s server/kiosk_server.py "$KIOSK/server/kiosk_server.py"; then
    cp server/kiosk_server.py "$KIOSK/server/kiosk_server.py"
    UI_RESTART=1
  fi
  local unit
  for unit in kiosk-hw kiosk-ui; do
    if ! cmp -s "hardware/systemd/$unit.service" "/etc/systemd/system/$unit.service"; then
      step "$unit.service changed → reinstall"
      sudo install -m 644 "hardware/systemd/$unit.service" /etc/systemd/system/
      sudo systemctl daemon-reload
      sudo systemctl restart "$unit"
      if [[ $unit == kiosk-hw ]]; then HW_RESTART=0; else UI_RESTART=0; fi
    fi
  done
  if [[ $HW_RESTART == 1 ]]; then
    step "hardware.py changed → restart kiosk-hw"
    sudo systemctl restart kiosk-hw
  fi
  if [[ $UI_RESTART == 1 ]]; then
    step "kiosk_server.py changed → restart kiosk-ui"
    sudo systemctl restart kiosk-ui
  fi
  # A service that is stopped (first install, or it was disabled) would leave
  # Chromium on "This site can't be reached". Make sure both are up.
  for unit in kiosk-ui kiosk-hw; do
    if ! systemctl is-active --quiet "$unit"; then
      step "$unit not running → start"
      sudo systemctl enable "$unit" 2>/dev/null || true
      sudo systemctl restart "$unit"
      UI_BUILT=1 # relaunch the browser so it retries the page
    fi
  done

  if [[ $UI_BUILT == 1 ]]; then
    step "relaunch kiosk browser"
    bash "$REPO/scripts/relaunch-browser.sh"
  fi

  step "done"
}

main "$@"
exit
