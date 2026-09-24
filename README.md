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
| `ui/` | Vite + React app. Pure consumer of the WebSocket. |
| `content/items.json` | Products, keyed by tag UID. Media in `content/media/`. |
| `scripts/` | `deploy.sh` (Mac → Pi), `setup-pi.sh` (one-time Pi install). |

## Develop (on the Mac)

```sh
python3 -m pip install websockets      # once, for the mock
python3 hardware/mock.py               # fake hardware on :8765
cd ui && npm install && npm run dev    # http://localhost:5173
```

Mock keys: `n` next item, `1`–`9` a specific item, `u` unknown tag, `r` remove
tag, `s` sleep/wake, `q` quit. `--auto 8` cycles items on a timer. Open a
specific item without the mock: `http://localhost:5173/?tag=<uid>`.

The dev server serves `../content` at `/content`, so edits to `items.json` and
media show up on the next tag read — no rebuild.

## Add a product

1. Put a tag on the pad; the "unrecognised tag" screen shows its UID.
2. Add an entry to `content/items.json` under that UID, media under
   `content/media/<product>/`.
3. `scripts/deploy.sh`.

Section types: `hero`, `text`, `specs`, `gallery`, `video`, `quote`. Unknown
types are skipped. A new type is one file in `ui/src/sections/` plus a line in
`ui/src/sections/index.js`. Media paths are relative to `content/`; remote URLs
are refused (the case is offline). Encode video as H.264 MP4 with
`-movflags +faststart` — the static server doesn't do range requests.

## Deploy

```sh
scripts/deploy.sh                          # build, rsync, relaunch the kiosk browser
scripts/deploy.sh content                  # content/ only: no build, no relaunch
PI=lutron@192.168.1.50 scripts/deploy.sh   # different host
```

Syncs `ui/dist/` → `~/kiosk/ui/`, `content/` → `~/kiosk/ui/content/`, and
`hardware.py` → `~/kiosk/hardware/` (restarting `kiosk-hw` only if it changed),
then relaunches Chromium using the line in `~/.config/labwc/autostart`. The UI
re-reads `items.json` on every tag read, so content-only deploys need no reload.

## First-time Pi setup

With the Pi already running Raspberry Pi OS (Trixie, labwc) as user `lutron`:

```sh
rsync -a scripts hardware lutron@displaycase.local:/tmp/lutron-case/
ssh lutron@displaycase.local 'bash /tmp/lutron-case/scripts/setup-pi.sh'
```

Then `scripts/deploy.sh` from the Mac and reboot. It is safe to re-run.
