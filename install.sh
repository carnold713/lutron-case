#!/usr/bin/env bash
# lutron-case — one-shot Raspberry Pi setup
#
# Turns a fresh Raspberry Pi OS (Bookworm/Trixie, desktop) install into the
# demo case: boot config, sensors, hardware service, UI server, portrait
# kiosk mode. Safe to re-run; each step replaces what it wrote last time.
#
# Usage, from inside the cloned repo, as the normal (non-root) user:
#   ./install.sh
# then reboot.

set -euo pipefail

# ---- Settings -------------------------------------------------------------
SCREEN_OUTPUT="HDMI-A-2"   # the AMOLED's HDMI output
ROTATION="90"              # portrait; use 270 if the screen comes up upside down
UI_PORT="8080"
KIOSK_DIR="$HOME/kiosk"    # runtime location, matches deploy.sh
# ---------------------------------------------------------------------------

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="$(id -un)"
USER_UID="$(id -u)"
BOOT_CFG="/boot/firmware/config.txt"
[ -f "$BOOT_CFG" ] || BOOT_CFG="/boot/config.txt"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$1"; }

if [ "$USER_UID" -eq 0 ]; then
  echo "Run this as your normal user, not with sudo. It asks for sudo itself."
  exit 1
fi

# ---------------------------------------------------------------------------
step "Installing system packages"
sudo apt-get update
sudo apt-get install -y \
  git python3-venv python3-pip python3-dev i2c-tools \
  wlr-randr nodejs npm rsync
# Chromium ships preinstalled on desktop images; install it if missing.
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
fi
CHROMIUM="$(command -v chromium || command -v chromium-browser)"

# ---------------------------------------------------------------------------
step "Enabling I2C and the GPIO serial port"
sudo raspi-config nonint do_i2c 0          # 0 = enable
sudo raspi-config nonint do_serial_hw 0    # hardware UART on
sudo raspi-config nonint do_serial_cons 1  # no login console on it (it'd fight the NFC reader)

# Our boot-config lines live in a marked block so re-runs replace, not duplicate.
sudo sed -i '/# >>> lutron-case >>>/,/# <<< lutron-case <<</d' "$BOOT_CFG"
sudo tee -a "$BOOT_CFG" >/dev/null <<'EOF'
# >>> lutron-case >>>
[all]
# Pi 5: route UART0 to GPIO 14/15 -> /dev/ttyAMA0 (serial0 points at the debug port)
dtoverlay=uart0-pi5
# The screen's single USB-C carries power + touch; let the Pi supply full current
usb_max_current_enable=1
# <<< lutron-case <<<
EOF

sudo usermod -aG dialout,i2c,gpio "$USER_NAME"

# ---------------------------------------------------------------------------
step "Booting to desktop with auto-login"
sudo raspi-config nonint do_boot_behaviour B4

# ---------------------------------------------------------------------------
step "Setting up the hardware service"
mkdir -p "$KIOSK_DIR"
rsync -a --delete "$REPO_DIR/hardware/" "$KIOSK_DIR/hardware/"

python3 -m venv "$KIOSK_DIR/.venv"
"$KIOSK_DIR/.venv/bin/pip" install --upgrade pip
if [ -f "$REPO_DIR/hardware/requirements.txt" ]; then
  "$KIOSK_DIR/.venv/bin/pip" install -r "$REPO_DIR/hardware/requirements.txt"
else
  "$KIOSK_DIR/.venv/bin/pip" install \
    adafruit-blinka adafruit-circuitpython-tcs34725 \
    adafruit-circuitpython-pn532 pyserial websockets
fi

# WAYLAND_DISPLAY + XDG_RUNTIME_DIR let hardware.py call wlr-randr to sleep/wake
# the screen. Without them, screen control fails silently.
sudo tee /etc/systemd/system/kiosk-hw.service >/dev/null <<EOF
[Unit]
Description=Lutron case hardware (NFC + light sensor -> WebSocket)
After=graphical.target

[Service]
User=$USER_NAME
WorkingDirectory=$KIOSK_DIR/hardware
Environment=WAYLAND_DISPLAY=wayland-0
Environment=XDG_RUNTIME_DIR=/run/user/$USER_UID
ExecStart=$KIOSK_DIR/.venv/bin/python $KIOSK_DIR/hardware/hardware.py
Restart=always
RestartSec=2

[Install]
WantedBy=graphical.target
EOF

# Allow the UI's hidden "shut down" control to power off without a password.
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/sbin/poweroff, /usr/bin/systemctl poweroff" \
  | sudo tee /etc/sudoers.d/lutron-case >/dev/null
sudo chmod 440 /etc/sudoers.d/lutron-case

# ---------------------------------------------------------------------------
step "Building and installing the UI"
if [ -f "$REPO_DIR/ui/package.json" ]; then
  (cd "$REPO_DIR/ui" && npm ci && npm run build)
  UI_BUILD="$REPO_DIR/ui/dist"
elif [ -d "$REPO_DIR/ui" ]; then
  UI_BUILD="$REPO_DIR/ui"      # plain HTML, no build step
else
  warn "No ui/ folder found in the repo — skipping UI install."
  UI_BUILD=""
fi

if [ -n "$UI_BUILD" ]; then
  rsync -a --delete --exclude content "$UI_BUILD/" "$KIOSK_DIR/ui/"
fi
if [ -d "$REPO_DIR/content" ]; then
  mkdir -p "$KIOSK_DIR/ui/content"
  rsync -a "$REPO_DIR/content/" "$KIOSK_DIR/ui/content/"
fi

sudo tee /etc/systemd/system/kiosk-ui.service >/dev/null <<EOF
[Unit]
Description=Lutron case UI server
After=network.target

[Service]
User=$USER_NAME
ExecStart=/usr/bin/python3 -m http.server $UI_PORT --bind 127.0.0.1 -d $KIOSK_DIR/ui
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable kiosk-hw kiosk-ui

# ---------------------------------------------------------------------------
step "Configuring portrait kiosk mode"
LABWC_DIR="$HOME/.config/labwc"
AUTOSTART="$LABWC_DIR/autostart"
RCXML="$LABWC_DIR/rc.xml"
mkdir -p "$LABWC_DIR"
touch "$AUTOSTART"

# Replace our block in autostart, leave anything else in there alone.
sed -i '/# >>> lutron-case >>>/,/# <<< lutron-case <<</d' "$AUTOSTART"
cat >>"$AUTOSTART" <<EOF
# >>> lutron-case >>>
wlr-randr --output $SCREEN_OUTPUT --transform $ROTATION
$CHROMIUM --kiosk --password-store=basic --noerrdialogs --disable-infobars \\
  --no-first-run --disable-session-crashed-bubble --check-for-update-interval=31536000 \\
  http://localhost:$UI_PORT &
# <<< lutron-case <<<
EOF

# Map touch to the rotated screen so taps land where you touch.
if [ ! -f "$RCXML" ]; then
  cat >"$RCXML" <<EOF
<?xml version="1.0"?>
<labwc_config>
  <touch mapToOutput="$SCREEN_OUTPUT" />
</labwc_config>
EOF
elif ! grep -q 'mapToOutput' "$RCXML"; then
  sed -i "s#</labwc_config>#  <touch mapToOutput=\"$SCREEN_OUTPUT\" />\n</labwc_config>#" "$RCXML"
else
  warn "rc.xml already has a touch mapping — left it as is."
fi

# ---------------------------------------------------------------------------
step "Done"
cat <<EOF

Setup complete for user '$USER_NAME'.

  Reboot now:   sudo reboot

After reboot the case should come up in portrait, full-screen, with the
sensors running. Useful checks over SSH:

  systemctl status kiosk-hw kiosk-ui
  journalctl -u kiosk-hw -f          # live hardware log
  i2cdetect -y 1                     # light sensor should show at 29
  ls -l /dev/ttyAMA0                 # NFC serial port should exist
  pkill chromium                     # get back to the desktop

If the screen is upside down, set ROTATION="270" at the top of this
script and run it again.
EOF
