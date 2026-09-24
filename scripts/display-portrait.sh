#!/usr/bin/env bash
# Rotate the case display to portrait, now and at every boot. Run ON the Pi as
# lutron (setup-pi.sh calls it; safe to re-run):
#
#   ~/lutron-case/scripts/display-portrait.sh
#
# The panel is a 1920x1080 landscape panel mounted on its side; transform 90
# was confirmed right side up on the case.
set -euo pipefail

OUTPUT="HDMI-A-2"
TRANSFORM="90"          # 90 or 270 depending on mounting; 90 is correct for this case
KANSHI="$HOME/.config/kanshi/config"
AUTOSTART="$HOME/.config/labwc/autostart"
ROTATE_LINE="wlr-randr --output $OUTPUT --transform $TRANSFORM"

# QUIRK: from a terminal or SSH there is no desktop session env; wlr-randr
# needs these to reach the labwc Wayland session (same as kiosk-hw.service).
export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000

echo "rotate now: $ROTATE_LINE"
$ROTATE_LINE || echo "  (couldn't reach the desktop session — will apply at next boot)"

# Pi OS restores display settings from kanshi at login; if its config says
# otherwise it would undo the rotation, so set the transform there too.
if [[ -f "$KANSHI" ]] && grep -q "output $OUTPUT" "$KANSHI"; then
  [[ -f "$KANSHI.before-portrait" ]] || cp "$KANSHI" "$KANSHI.before-portrait"
  if grep "output $OUTPUT" "$KANSHI" | grep -q 'transform'; then
    sed -i -E "/output $OUTPUT/ s/transform [^ ]+/transform $TRANSFORM/" "$KANSHI"
  else
    sed -i -E "/output $OUTPUT/ s/\$/ transform $TRANSFORM/" "$KANSHI"
  fi
  echo "kanshi: $(grep "output $OUTPUT" "$KANSHI" | sed 's/^[[:space:]]*//')"
fi

# Belt and braces: rotate at session start, before Chromium opens, so the
# kiosk comes up at the portrait size whatever kanshi does.
mkdir -p "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
sed -i '/^wlr-randr --output .* --transform /d' "$AUTOSTART"
if [[ -s "$AUTOSTART" ]]; then
  sed -i "1i $ROTATE_LINE" "$AUTOSTART"
else
  echo "$ROTATE_LINE" > "$AUTOSTART"   # sed can't insert into an empty file
fi
echo "autostart:"
sed 's/^/  /' "$AUTOSTART"
