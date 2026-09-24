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
| `scripts/` | `update.sh` (on the Pi: GitHub → case), `setup-pi.sh` (one-time Pi install), `deploy.sh` (Mac → Pi over SSH). |

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
