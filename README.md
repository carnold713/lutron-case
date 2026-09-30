# Lutron Case

A portable, fully offline demo case. Set a Lutron product on the pad, the NFC
tag under it is read, and the portrait screen shows content about that product.
Raspberry Pi 5 + PN532 NFC + TCS34725 light sensor + Chromium kiosk.

See [BRIEF.md](BRIEF.md) for the full brief, hardware contract and constraints.

## Layout

| Path | What |
| --- | --- |
| `hardware/hardware.py` | The only thing that touches hardware. Pushes JSON on `ws://localhost:8765`. |
| `hardware/mock.py` | Fake of the above for development without hardware. |
| `server/kiosk_server.py` | Serves the UI on the Pi and saves tag assignments (`/api/tags`). |
| `ui/` | Vite + React app. Pure consumer of the WebSocket. |
| `content/items.json` | Pages (products, materials…), keyed by id. Media in `content/media/`. |
| `content/tags.json` | Tag UID → page id, as shipped in git. |
| `scripts/` | `update.sh` (on the Pi: GitHub → case), `setup-pi.sh` (one-time Pi install), `display-portrait.sh` (rotate the panel) and `touch-only.sh` (real touch, no pointer), both re-applied by every update, `hdmi-full-range.sh` (true black on the OLED, run by setup), `deploy.sh` (Mac → Pi over SSH). |

## Develop (on the Mac)

```sh
python3 -m pip install websockets      # once, for the mock
python3 hardware/mock.py               # fake hardware on :8765
cd ui && npm install && npm run dev    # http://localhost:5173
```

Mock keys: `n` next tag, `1`–`9` a specific tag, `u` unknown tag, `b` a blank
new tag (for trying tag programming), `r` remove tag, `s` sleep/wake, `q` quit.
`--auto 8` cycles on a timer. Open a page directly in a browser with
`http://localhost:5173/?tag=pico` (a content id) or `?tag=<uid>`.

The dev server serves `../content` at `/content`, so edits to `items.json` and
media show up on the next tag read — no rebuild. Tags programmed in the dev UI
are saved to `.dev-data/tags.json` (gitignored).

## Content

`content/items.json` holds every page, keyed by a short id:

```jsonc
{
  "pico":         { "kind": "product",  "title": "Pico Remote", "subtitle": "…", "accent": "#D8B46A", "sections": [ … ] },
  "satin-nickel": { "kind": "material", "title": "Satin Nickel", "sections": [ … ] }
}
```

`kind` groups pages when programming tags (`product`, `material`, or anything
new — it's shown under its own name). Media lives in `content/media/<id>/`.

Section types: `hero`, `text`, `specs`, `gallery`, `video`, `quote`, and
`scrolly` (the scroll-driven story used by the Pico page — see the comment at
the top of `ui/src/sections/Scrolly.jsx`; scene positions are fractions of the
screen, so a 1080×1920 Figma frame converts as `x = px / 1080`, `y = px / 1920`).
Unknown types are skipped. A new type is one file in `ui/src/sections/` plus a
line in `ui/src/sections/index.js`. Remote URLs are refused (the case is
offline). Encode video as H.264 MP4 with `-movflags +faststart`.

## Tags

A tag is linked to a page by its factory UID; nothing is written to the chip,
so any blank NTAG sticker works.

**Program a tag on the case:** hold the colour-temperature / lux readout on the
idle screen for 3 seconds → **Program tags** → put the tag on the pad → tap the
page it should open. Repeat for more tags; **Done** when finished. It saves
immediately and survives updates and reboots.

Where assignments live:

- `content/tags.json` (in git) — `{ "<uid>": "<page id>" }`, ships with the repo.
- `~/kiosk/data/tags.json` (on the Pi) — everything programmed on the case.
  It wins over the repo file and is never touched by `update.sh`.

To make the case's assignments permanent in git, copy them into
`content/tags.json`: `cat ~/kiosk/data/tags.json` on the Pi shows them.

## Add a product or material

1. Add an entry to `content/items.json` with a new id and `kind`, and its media
   under `content/media/<id>/`.
2. Push, then run `update.sh` on the Pi.
3. Program a tag for it on the case (above).

## Deploy (GitHub → Pi)

GitHub is the source of truth. Edit on the Mac, `git push`, then in a
terminal on the Pi:

```sh
~/lutron-case/scripts/update.sh            # pull, build, install, relaunch
~/lutron-case/scripts/update.sh --force    # rebuild and reinstall everything
```

It rebuilds the UI only when `ui/` changed and relaunches Chromium only then.
Content-only changes install in seconds with no relaunch, because the UI
re-reads `items.json` on every tag read. It restarts `kiosk-hw` only when
`hardware.py` or a unit file changed, and refuses to install an invalid
`items.json`.

`scripts/deploy.sh` is the alternative for untested experiments: it builds on
the Mac and rsyncs straight to the Pi over SSH, skipping GitHub.

## Screen: portrait, touch only

The Pi's screen setup lives in the repo, and every `update.sh` run re-applies
it, so a push and an update always put it back:

- **Portrait.** `display-portrait.sh` rotates `HDMI-A-2` (transform 90) now
  and at login. `hardware.py` wakes the screen with the rotation (a bare
  `wlr-randr --on` after a sleep brings it back landscape) and turns it back
  within 10 s if anything else rotates it.
- **Touch only.** `touch-only.sh` has labwc deliver the touchscreen as real
  touch, not an emulated mouse, and installs an invisible cursor so no pointer
  is ever drawn. Touch changes apply at once; the invisible cursor from the
  next reboot. For maintenance with a real mouse: `touch-only.sh --undo`, then
  reboot.

## Wi-Fi

The case needs no network to run a demo. Only `update.sh` (GitHub) and SSH
from the Mac need one, and for SSH the Mac must be on the same network. The
Pi remembers every network it has joined and connects to whichever one is in
range, so add networks ahead of time. Over SSH, while it's on a network it
knows:

```sh
# save a network (it doesn't have to be in range; this doesn't switch to it)
sudo nmcli connection add type wifi con-name "Studio" ifname wlan0 \
  ssid "Studio" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "the-password"
nmcli connection show                     # what it knows
```

Save your phone's hotspot this way once. Then, anywhere, you can turn the
hotspot on, join it from the Mac too, and `ssh lutron@displaycase.local`; add
the local Wi-Fi from there if you want. If the Pi knows no network nearby, a
network cable straight from the Mac to the Pi usually gets you
`ssh lutron@displaycase.local` without a router.

## First-time Pi setup

On the Pi, as `lutron`, with Raspberry Pi OS (Trixie, labwc):

```sh
git clone https://github.com/carnold713/lutron-case.git ~/lutron-case
bash ~/lutron-case/scripts/setup-pi.sh
~/lutron-case/scripts/update.sh
sudo reboot
```

If the repo is private, the Pi needs read access: a GitHub deploy key or a
personal access token. `setup-pi.sh` is safe to re-run. If something else
already starts `hardware.py`, disable it first: two copies fight over the NFC
reader and port 8765.
