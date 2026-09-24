#!/usr/bin/env bash
# True OLED black: make the Pi send full-range RGB (0–255) on the case's HDMI
# output instead of TV "limited" range (16–235).
#
# QUIRK: at 1920x1080 (a TV mode) the Pi's vc4 HDMI driver defaults to limited
# range, so "black" arrives at the panel as 16/255 — a grey haze across the
# whole AMOLED, with every pixel slightly lit (and drawing power). The fix is
# the DRM connector property "Broadcast RGB" = "Full". labwc/wlr-randr have no
# option for it, and only the DRM master may set it, so it has to happen at
# boot BEFORE the desktop starts. The compositor leaves the property alone
# afterwards.
#
#   scripts/hdmi-full-range.sh --status     show the current setting (safe anytime)
#   sudo scripts/hdmi-full-range.sh --install   set it at every boot, from the next boot
#   sudo scripts/hdmi-full-range.sh --uninstall
#   (no argument: apply now — only works with the desktop stopped; used by the unit)
#
# Needs modetest/proptest: sudo apt install libdrm-tests
set -euo pipefail

OUTPUT="HDMI-A-2"
DRIVER="vc4"
UNIT=/etc/systemd/system/kiosk-hdmi-range.service
BIN=/usr/local/sbin/kiosk-hdmi-full-range

# Prints "<connector id> <property id> <value for Full> <current value>" for OUTPUT.
probe() {
  modetest -M "$DRIVER" -c 2>/dev/null | awk -v out="$OUTPUT" '
    /^[0-9]+\t/ { split($0, f, "\t"); inconn = (f[4] == out); if (inconn) cid = f[1]; want = 0; next }
    inconn && /^[\t ]+[0-9]+ Broadcast RGB:/ { match($0, /[0-9]+/); pid = substr($0, RSTART, RLENGTH); want = 1; next }
    inconn && want && /enums:/ { if (match($0, /Full=[0-9]+/)) full = substr($0, RSTART + 5, RLENGTH - 5) }
    inconn && want && /value:/ { match($0, /-?[0-9]+/); cur = substr($0, RSTART, RLENGTH); want = 0 }
    END { if (cid != "" && pid != "" && full != "") print cid, pid, full, cur }'
}

need_tools() {
  command -v modetest >/dev/null && command -v proptest >/dev/null && return
  echo "modetest/proptest not found — install them with: sudo apt install libdrm-tests" >&2
  exit 1
}

case "${1:-apply}" in
  --status)
    need_tools
    read -r cid pid full cur < <(probe) || { echo "no 'Broadcast RGB' property found on $OUTPUT"; exit 1; }
    echo "$OUTPUT: connector $cid, Broadcast RGB (prop $pid) = $cur  (Full = $full; 0 is usually Automatic)"
    [[ "$cur" == "$full" ]] && echo "→ already full range" || echo "→ not full range: blacks will look grey on the OLED"
    ;;

  --install)
    need_tools
    [[ $EUID == 0 ]] || { echo "run with sudo" >&2; exit 1; }
    install -m 755 "$0" "$BIN"
    cat > "$UNIT" <<EOF
[Unit]
Description=Lutron case: full-range RGB on $OUTPUT (true OLED black)
# Must run before the desktop takes the display (only the DRM master may set it).
Before=display-manager.service
After=systemd-udevd.service

[Service]
Type=oneshot
ExecStart=$BIN

[Install]
WantedBy=graphical.target
EOF
    systemctl daemon-reload
    systemctl enable kiosk-hdmi-range.service
    echo "installed; takes effect at the next boot (sudo reboot)"
    ;;

  --uninstall)
    [[ $EUID == 0 ]] || { echo "run with sudo" >&2; exit 1; }
    systemctl disable kiosk-hdmi-range.service 2>/dev/null || true
    rm -f "$UNIT" "$BIN"
    systemctl daemon-reload
    echo "removed; back to the driver default at the next boot"
    ;;

  apply)
    need_tools
    # At boot the DRM device can appear a moment after we start.
    for _ in $(seq 40); do [[ -n "$(probe)" ]] && break; sleep 0.25; done
    read -r cid pid full cur < <(probe) || { echo "no 'Broadcast RGB' property on $OUTPUT; nothing to do"; exit 0; }
    if [[ "$cur" == "$full" ]]; then echo "$OUTPUT already full range"; exit 0; fi
    proptest -M "$DRIVER" "$cid" connector "$pid" "$full"
    echo "$OUTPUT: Broadcast RGB set to Full"
    ;;

  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
