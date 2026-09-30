#!/usr/bin/env bash
# Touch only, no mouse pointer. Run ON the Pi as lutron (setup-pi.sh and
# update.sh run it; safe to re-run):
#
#   ~/lutron-case/scripts/touch-only.sh           apply
#   ~/lutron-case/scripts/touch-only.sh --undo    back to Pi OS's cursor and touch settings
#
# Two parts:
#
# 1. Real touch. QUIRK: Raspberry Pi OS configures labwc's touch input with
#    mouseEmulation="yes", so a finger becomes a mouse: the pointer appears
#    wherever you tap, a finger drag never scrolls (ui/src/dragScroll.js
#    papers over that) and there is no multi-touch. mouseEmulation="no"
#    hands Chromium real touch events, and labwc hides the pointer as soon
#    as touch starts. Pi OS runs labwc with --merge-config, so our
#    ~/.config/labwc/rc.xml only holds the override and is read after
#    /etc/xdg/labwc/rc.xml, which lets it win. Applies right away.
#
# 2. An invisible cursor theme, for everything else: the pointer labwc shows
#    at boot before anyone touches the screen, and touch panels that report
#    as an absolute mouse (no labwc setting turns those into touch). A real
#    mouse plugged in is invisible too; use --undo for that. Takes effect at
#    the next reboot (labwc reads its environment only at startup).
set -euo pipefail

RC="$HOME/.config/labwc/rc.xml"
SYSTEM_RC="/etc/xdg/labwc/rc.xml"
ENV_FILE="$HOME/.config/labwc/environment"
THEME="lutron-invisible"
THEME_DIR="$HOME/.local/share/icons/$THEME"
BACKUP=".before-touch-only"   # first-run copies; an empty one means "didn't exist"

# SIGHUP makes labwc re-read rc.xml (same as `labwc --reconfigure`, which only
# works from inside the session).
reconfigure_labwc() { pkill -HUP -x -u "$(id -u)" labwc 2>/dev/null || true; }

if [[ "${1:-}" == "--undo" ]]; then
  for f in "$RC" "$ENV_FILE"; do
    [[ -f "$f$BACKUP" ]] || continue
    if [[ -s "$f$BACKUP" ]]; then mv "$f$BACKUP" "$f"; else rm -f "$f" "$f$BACKUP"; fi
    echo "restored $f"
  done
  rm -rf "$THEME_DIR"
  reconfigure_labwc
  echo "touch is back to Pi OS's setting now; the normal cursor returns after a reboot"
  exit 0
fi

mkdir -p "$(dirname "$RC")"
for f in "$RC" "$ENV_FILE"; do
  [[ -e "$f$BACKUP" ]] || { if [[ -f "$f" ]]; then cp "$f" "$f$BACKUP"; else : > "$f$BACKUP"; fi; }
done

# ── 1. labwc: touchscreens as touch ─────────────────────────────────────────
# Every <touch> entry we have says mouseEmulation="no", plus a default one for
# any touchscreen without its own entry. Pi OS's per-device entries ask for
# emulation by name, and a named entry beats a default, so each one naming a
# device that is plugged in gets a named override here too.
RC_RESULT="$(python3 - "$RC" "$SYSTEM_RC" <<'PY' || echo failed
import sys, xml.etree.ElementTree as ET
path, system = sys.argv[1], sys.argv[2]

def parse(p):
    return ET.parse(p, ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))

def touches(root):
    return [e for e in root.iter() if isinstance(e.tag, str) and e.tag.rsplit("}", 1)[-1] == "touch"]

try:
    tree = parse(path)
except FileNotFoundError:
    tree = ET.ElementTree(ET.fromstring("<labwc_config>\n</labwc_config>"))
except ET.ParseError as e:
    sys.exit(f"{path} is not valid XML ({e}); leaving it alone")
root = tree.getroot()
ns = root.tag[: root.tag.index("}") + 1] if root.tag.startswith("{") else ""
if ns:
    ET.register_namespace("", ns[1:-1])

changed = False
def add(attrs):
    global changed
    last = root[-1] if len(root) else None
    e = ET.SubElement(root, ns + "touch", attrs)
    e.tail = last.tail if last is not None else "\n"
    if last is not None: last.tail = "\n  "
    else: root.text = "\n  "
    changed = True

ours = touches(root)
for e in ours:
    if e.get("mouseEmulation") != "no":
        e.set("mouseEmulation", "no")
        changed = True
names = {e.get("deviceName") for e in ours}

try:
    present = {l.split("=", 1)[1].strip().strip('"') for l in open("/proc/bus/input/devices") if l.startswith("N: Name=")}
    for e in touches(parse(system).getroot()):
        name = e.get("deviceName")
        if name and name in present and name not in names and e.get("mouseEmulation") != "no":
            add(dict(e.attrib, mouseEmulation="no"))  # keeps its mapToOutput
            names.add(name)
except (OSError, ET.ParseError):
    pass
if None not in names:
    add({"mouseEmulation": "no"})

if changed:
    tree.write(path, encoding="UTF-8", xml_declaration=True)
    with open(path, "a") as f: f.write("\n")
    print("changed")
PY
)"
case "$RC_RESULT" in
  changed) reconfigure_labwc; echo "touch: real touch events (mouseEmulation=\"no\" in $RC), applied now" ;;
  failed)  echo "touch: couldn't update $RC (above); touch unchanged" ;;
  *)       echo "touch: already real touch" ;;
esac

# ── 2. invisible cursor ──────────────────────────────────────────────────────
# One transparent 24x24 Xcursor file, linked under every name labwc, GTK or a
# browser might ask for, so no lookup falls back to a visible theme.
python3 - "$THEME_DIR" <<'PY'
import os, struct, sys
d = sys.argv[1]
cursors = os.path.join(d, "cursors")
os.makedirs(cursors, exist_ok=True)
with open(os.path.join(d, "index.theme"), "w") as f:
    f.write("[Icon Theme]\nName=Lutron invisible\nComment=Transparent cursors: the case is touch only\n")
size, image = 24, 0xFFFD0002
data = (b"Xcur" + struct.pack("<3I", 16, 0x10000, 1)              # header, 1 table entry
        + struct.pack("<3I", image, size, 28)                      # the image starts at byte 28
        + struct.pack("<9I", 36, image, size, 1, size, size, 0, 0, 0)
        + bytes(4 * size * size))                                  # fully transparent ARGB
with open(os.path.join(cursors, "default"), "wb") as f:
    f.write(data)
names = """left_ptr arrow top_left_arrow right_ptr center_ptr pointer hand hand1 hand2
  openhand closedhand grab grabbing text xterm ibeam vertical-text wait watch progress
  left_ptr_watch half-busy help question_arrow whats_this context-menu cell crosshair
  cross tcross plus move fleur all-scroll size_all all-resize alias copy dnd-ask
  dnd-move dnd-copy dnd-link dnd-none dnd-no-drop no-drop not-allowed forbidden
  circle crossed_circle pirate X_cursor pencil draft zoom-in zoom-out col-resize
  row-resize split_h split_v e-resize n-resize ne-resize nw-resize s-resize
  se-resize sw-resize w-resize ew-resize ns-resize nesw-resize nwse-resize
  sb_h_double_arrow sb_v_double_arrow h_double_arrow v_double_arrow size_hor
  size_ver size_bdiag size_fdiag bd_double_arrow fd_double_arrow top_left_corner
  top_right_corner bottom_left_corner bottom_right_corner top_side bottom_side
  left_side right_side ul_angle ur_angle ll_angle lr_angle""".split()
for n in names:
    p = os.path.join(cursors, n)
    if not os.path.islink(p):
        if os.path.exists(p): os.remove(p)
        os.symlink("default", p)
PY

touch "$ENV_FILE"
if grep -qx "XCURSOR_THEME=$THEME" "$ENV_FILE"; then
  echo "cursor: already invisible"
else
  sed -i '/^XCURSOR_THEME=/d' "$ENV_FILE"
  echo "XCURSOR_THEME=$THEME" >> "$ENV_FILE"
  echo "cursor: invisible from the next reboot (sudo reboot)"
fi
