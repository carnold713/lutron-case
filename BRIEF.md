# Lutron Case — Project Brief

A brief for Claude Code. Read this first, then scaffold the repo as described.
Repo: `https://github.com/carnold713/lutron-case`.

## What this is

A portable demo case. Someone opens the lid, sets a physical Lutron product on
a pad, and a screen shows content about that product. The case runs entirely
offline on a Raspberry Pi 5.

Working today, on the bench:

- Raspberry Pi 5 (4GB), Raspberry Pi OS 64-bit (Trixie, labwc/Wayland), hostname `displaycase`, user `lutron`
- 7" Wisecoco AMOLED, 1920×1080, mounted portrait, on HDMI output `HDMI-A-2`
- PN532 NFC reader on `/dev/ttyAMA0` (UART/HSU mode), reads NTAG215 stickers
- CQRobot TCS34725 light sensor on I²C `0x29` — reports colour temperature and lux, and doubles as the wake sensor
- A Python service that reads both and broadcasts JSON over a local WebSocket
- Chromium in kiosk mode, full screen at boot

Not wired yet: an SHT41 humidity sensor at I²C `0x44`. Leave a hook for it but
do not depend on it.

The hardware side is done and should stay stable. This project is about the app
that renders content when a tag is read.

## Hardware contract

The Python service (`hardware/hardware.py`) is the only thing that touches
hardware. It serves a WebSocket on `ws://localhost:8765` and pushes JSON. The UI
is a pure consumer — it never talks to hardware directly.

### Messages the UI receives

```jsonc
// every 250ms
{ "type": "light", "kelvin": 4812, "lux": 214, "brightness": 857 }

// a tag arrives (fires once per arrival, not repeatedly)
{ "type": "tag", "uid": "04a1b2c3d4e5f6", "at": "14:32:07" }

// the tag has been taken away
{ "type": "tag-gone" }

// the screen woke or slept (light sensor or a tag caused it)
{ "type": "wake" }
{ "type": "sleep" }
```

### Messages the UI may send

```jsonc
{ "type": "shutdown" }   // clean poweroff, for a hidden admin control
```

`uid` is lowercase hex, no separators. Treat it as an opaque key.

Keep this contract stable. If the UI needs something new, add a message type
rather than changing an existing one.

## Content model

Content lives in `content/items.json`, outside the app bundle, so adding a
product is a data edit and not a rebuild. The UI fetches it at runtime.

```jsonc
{
  "04a1b2c3d4e5f6": {
    "title": "Caséta Smart Dimmer",
    "subtitle": "PD-6WCL-WH",
    "accent": "#F5B335",
    "sections": [
      { "type": "hero",  "image": "media/caseta/hero.jpg", "caption": "..." },
      { "type": "text",  "heading": "Why it matters", "body": "..." },
      { "type": "specs", "rows": [["Load", "150W LED"], ["Neutral", "Not required"]] },
      { "type": "gallery", "images": ["media/caseta/1.jpg", "media/caseta/2.jpg"] },
      { "type": "video", "src": "media/caseta/demo.mp4", "poster": "media/caseta/hero.jpg" },
      { "type": "quote", "body": "...", "attribution": "..." }
    ]
  }
}
```

Media sits in `content/media/…` and is referenced by path relative to the
content root.

Build the UI as a renderer for section types. Adding a product should mean a
JSON entry plus files. Adding a kind of content means one new section
component. Unknown section types must be skipped silently, never crash the page.

## Repo layout

```
lutron-case/
├── README.md                     # setup + deploy, short
├── BRIEF.md                      # this file
├── .gitignore
├── hardware/
│   ├── hardware.py               # the service (provided below — use verbatim)
│   ├── mock.py                   # fake WebSocket server for Mac development
│   └── systemd/
│       ├── kiosk-hw.service
│       └── kiosk-ui.service
├── ui/                           # Vite + React app
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── useHardware.js        # WebSocket hook, auto-reconnect
│       ├── sections/             # one component per section type
│       └── styles.css
├── content/
│   ├── items.json
│   └── media/
└── scripts/
    ├── deploy.sh                 # build + rsync to the Pi
    └── setup-pi.sh               # one-time Pi install
```

## How development works

Write the app on the Mac, not the Pi. The Pi is slow to iterate on and the app
doesn't need real hardware to build.

- `cd ui && npm run dev` — Vite dev server with hot reload
- `python3 hardware/mock.py` — fakes the WebSocket on port 8765

`mock.py` should emit plausible `light` messages on a timer and let the
developer trigger tags. Make it easy: cycle through the UIDs in `items.json`
with a keypress, or fire one every N seconds. Also expose tag UIDs as URL params
(`?tag=04a1…`) so a specific item can be opened directly in a browser.

Deploy with `scripts/deploy.sh`, which builds the UI, rsyncs `ui/dist/` and
`content/` to `lutron@displaycase.local:~/kiosk/`, and restarts the service.
Typical loop should be seconds, not minutes.

## Constraints that shape the app

- Portrait, 1080×1920. Design for a tall column. Assume 2× scale, so a logical viewport of roughly 540×960 CSS pixels.
- Touch only. No keyboard, no mouse, no cursor. Targets ≥ 44px. `cursor: none` on the body.
- Fully offline. No CDNs, no web fonts, no analytics, no external anything. Bundle every asset. This is a hard requirement — the case has no network at a demo.
- OLED. Dark backgrounds — black pixels are switched off, which saves real battery. Avoid large white fields.
- Battery powered, roughly 8 hours. Avoid busy animation loops and always-running video.
- Chromium on a Pi 5. Modern JS and CSS are fine. Heavy 3D is not.
- It must never look broken in public. Unknown tag, missing image, service down, malformed JSON — every one of these needs a graceful state, not a blank screen or a stack trace.

## Behaviour to implement

1. **Idle** — no tag present. Shows an invitation to set an object down, plus the live colour temperature and lux as an ambient readout. This is the default and it should look intentional, not like an error state.
2. **Tag read** — the matching item takes over the screen. A scrolling experience: hero, then sections, touch-scrollable.
3. **Tag removed** — do not snap away instantly. Hold the content so someone can keep reading, and return to idle after a timeout (start at 60s, make it a constant) or when a different tag arrives.
4. **Different tag while one is showing** — switch to the new item, reset scroll to the top.
5. **Unknown UID** — a clean "unrecognised tag" state that displays the UID, so it doubles as the tool for registering new objects.
6. **Service disconnected** — reconnect silently in the background, with a small unobtrusive indicator. Never a modal or an error page.

## Pi runtime facts

- User `lutron`, home `/home/lutron`, deploy target `~/kiosk/`
- Python venv at `~/kiosk/.venv` with `adafruit-blinka`, `adafruit-circuitpython-tcs34725`, `adafruit-circuitpython-pn532`, `websockets`
- `hardware.py` needs `WAYLAND_DISPLAY=wayland-0` and `XDG_RUNTIME_DIR=/run/user/1000` in its unit, or `wlr-randr` can't reach the session and screen control silently fails
- UI is served from `~/kiosk/ui` on port 8080; `content/` deploys to `~/kiosk/ui/content/` so the app can fetch `content/items.json`
- Kiosk launch line lives in `~/.config/labwc/autostart`:
  `chromium --kiosk --password-store=basic --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble http://localhost:8080 &`
- The `--password-store=basic` flag matters — without it Chromium prompts for a keyring password at boot

## Conventions

- Plain CSS or CSS modules. No Tailwind, no component library — every dependency has to be bundled offline and this UI is small and bespoke.
- Keep `useHardware.js` the single place that knows about WebSockets.
- No TypeScript unless asked; keep the barrier to quick edits low.
- Constants like timeouts and thresholds go at the top of their file, named.
- Comment the non-obvious hardware quirks (the PN532 preamble flush, the `WAYLAND_DISPLAY` requirement). They cost hours to rediscover.
