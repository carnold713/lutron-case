#!/usr/bin/env bash
# One-time (and safe to re-run) install on the case's Pi. Run ON the Pi, as
# user lutron, from a clone of the repo:
#
#   git clone https://github.com/carnold713/lutron-case.git ~/lutron-case
#   bash ~/lutron-case/scripts/setup-pi.sh
#
# Then ~/lutron-case/scripts/update.sh to build and install, and reboot.
set -euo pipefail

KIOSK="$HOME/kiosk"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
USER_UID="$(id -u)"
AUTOSTART="$HOME/.config/labwc/autostart"
KIOSK_LINE='chromium --kiosk --password-store=basic --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble http://localhost:8080 &'

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

[[ "$USER_NAME" == "lutron" && "$USER_UID" == "1000" ]] || {
  echo "Expected to run as lutron (uid 1000); the systemd units hard-code that." >&2
  echo "Running as $USER_NAME (uid $USER_UID). Ctrl-C to stop, Enter to continue anyway."
  read -r
}

step "packages"
# nodejs/npm: update.sh builds the UI on the Pi from what's on GitHub.
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-dev python3-lgpio rsync wlr-randr i2c-tools git nodejs npm libdrm-tests

step "interfaces: I2C on, UART on, serial console off"
# The TCS34725 (0x29) and the future SHT41 (0x44) are on I2C.
sudo raspi-config nonint do_i2c 0
# QUIRK: the PN532 is on the GPIO UART (/dev/ttyAMA0). The UART must be enabled
# AND the Linux serial login console must be off — otherwise a getty owns the
# port and the reader returns garbage or nothing.
sudo raspi-config nonint do_serial_hw 0
sudo raspi-config nonint do_serial_cons 1
# hardware.py owns the screen (wlr-randr on/off from the light sensor); stop
# the desktop's own idle blanking from fighting it.
sudo raspi-config nonint do_blanking 1 || true
sudo usermod -aG dialout,i2c,gpio "$USER_NAME"

step "python venv at $KIOSK/.venv"
mkdir -p "$KIOSK/ui/content" "$KIOSK/hardware"
# --system-site-packages: Blinka on the Pi 5 uses the distro's lgpio.
[[ -x "$KIOSK/.venv/bin/python" ]] || python3 -m venv --system-site-packages "$KIOSK/.venv"
"$KIOSK/.venv/bin/pip" install -q --upgrade pip
"$KIOSK/.venv/bin/pip" install -q \
  adafruit-blinka adafruit-circuitpython-tcs34725 adafruit-circuitpython-pn532 pyserial websockets

mkdir -p "$KIOSK/server" "$KIOSK/data"
cp "$SRC/hardware/hardware.py" "$KIOSK/hardware/hardware.py"
cp "$SRC/server/kiosk_server.py" "$KIOSK/server/kiosk_server.py"

step "systemd units"
sudo install -m 644 "$SRC/hardware/systemd/kiosk-hw.service" /etc/systemd/system/
sudo install -m 644 "$SRC/hardware/systemd/kiosk-ui.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable kiosk-hw kiosk-ui

step "sudoers: poweroff + service restarts without a password"
# hardware.py runs `sudo systemctl poweroff` for the UI's hidden shutdown
# control; deploy.sh restarts kiosk-hw over SSH.
SUDOERS="$(mktemp)"
cat > "$SUDOERS" <<SUDO
$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl restart kiosk-hw, /usr/bin/systemctl restart kiosk-ui
SUDO
sudo visudo -cf "$SUDOERS" >/dev/null
sudo install -m 440 "$SUDOERS" /etc/sudoers.d/kiosk
rm -f "$SUDOERS"

step "labwc autostart → Chromium kiosk"
# --password-store=basic matters: without it Chromium asks for a keyring
# password at boot, on a touch screen with no keyboard.
mkdir -p "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
if grep -q '^chromium' "$AUTOSTART"; then
  echo "chromium line already present, leaving it:"
  grep '^chromium' "$AUTOSTART"
else
  echo "$KIOSK_LINE" >> "$AUTOSTART"
fi

step "display → portrait"
bash "$SRC/scripts/display-portrait.sh"

step "display → full-range RGB (true OLED black)"
sudo bash "$SRC/scripts/hdmi-full-range.sh" --install

step "done"
echo "Now run $SRC/scripts/update.sh, then: sudo reboot"
