#!/usr/bin/env python3
"""Fake hardware service for developing the UI without a Pi.

Speaks the same WebSocket contract as hardware.py on ws://localhost:8765:
plausible `light` readings every 250ms, plus tags you trigger by hand.

    python3 hardware/mock.py              # interactive
    python3 hardware/mock.py --auto 8     # cycle items, one every 8s
    python3 hardware/mock.py --climate    # also emit SHT41-style readings

Keys:  n next item   1-9 item N   u unknown tag   b blank new tag   d two tags at once
       r remove tag
       s sleep/wake  l list items q quit

Needs: pip install websockets
"""

import argparse, asyncio, json, math, os, random, re, sys, threading, time
from pathlib import Path

try:
    import websockets
except ImportError:
    sys.exit("mock.py needs websockets:  python3 -m pip install websockets")

HOST, PORT = "localhost", 8765
LIGHT_INTERVAL_S = 0.25
CLIMATE_INTERVAL_S = 5.0
UNKNOWN_UID = "04deadbeef0042"
HEX_UID = re.compile(r"^[0-9a-f]{8,20}$")
ROOT = Path(__file__).resolve().parent.parent
ITEMS_PATH = ROOT / "content" / "items.json"
TAGS_PATHS = [ROOT / "content" / "tags.json",      # tags that ship with the repo
              ROOT / ".dev-data" / "tags.json"]    # tags programmed in the dev UI
UI_DEV_URL = "http://localhost:5173"

clients = set()
state = {"tag": None, "awake": True, "index": -1}


def load_items():
    """Tag UIDs with the title they open, as (uid, title) pairs.

    Re-read every time so edits (and tags programmed in the UI) show up
    without a restart. Items keyed directly by a UID count as tags too.
    """
    try:
        items = json.loads(ITEMS_PATH.read_text())
    except Exception as e:  # malformed JSON is a thing the UI must survive too
        print(f"  (couldn't read {ITEMS_PATH.name}: {e})")
        items = {}
    tags = {}
    for path in TAGS_PATHS:
        try:
            tags.update(json.loads(path.read_text()))
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"  (couldn't read {path}: {e})")
    title = lambda cid: ((items.get(cid) or {}).get("title") or f"({cid} — not in items.json)") if cid else "(unassigned)"
    pairs = [(uid, title(cid)) for uid, cid in tags.items()]
    pairs += [(k, title(k)) for k in items if HEX_UID.match(k) and k not in tags]
    return pairs


async def send(msg):
    raw = json.dumps(msg)
    for ws in list(clients):
        try:
            await ws.send(raw)
        except Exception:
            clients.discard(ws)


async def handler(ws):
    clients.add(ws)
    print(f"  ui connected ({len(clients)})")
    # Same as hardware.py: tell a new client the current screen state.
    await ws.send(json.dumps({"type": "wake" if state["awake"] else "sleep"}))
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if msg.get("type") == "shutdown":
                print("  << shutdown requested (the real service would power off)")
    finally:
        clients.discard(ws)
        print(f"  ui disconnected ({len(clients)})")


async def light_loop():
    """Slow drift around a warm-white room, with a little sensor jitter."""
    t0 = time.time()
    while True:
        t = time.time() - t0
        if state["awake"]:
            kelvin = 4200 + 900 * math.sin(t / 40) + random.uniform(-25, 25)
            lux = 220 + 60 * math.sin(t / 17) + random.uniform(-3, 3)
            brightness = int(lux * 4)
        else:  # lid closed
            kelvin, lux, brightness = 0, 0.0, random.randint(0, 20)
        await send({"type": "light", "kelvin": int(kelvin), "lux": round(lux, 1),
                    "brightness": brightness})
        await asyncio.sleep(LIGHT_INTERVAL_S)


async def climate_loop():
    # Reserved message for the SHT41 (I2C 0x44), not in hardware.py yet.
    while True:
        await send({"type": "climate", "celsius": round(22 + random.uniform(-0.3, 0.3), 1),
                    "humidity": round(41 + random.uniform(-1, 1), 1)})
        await asyncio.sleep(CLIMATE_INTERVAL_S)


async def set_awake(on):
    if on == state["awake"]:
        return
    state["awake"] = on
    print(f"  -> {'wake' if on else 'sleep'}")
    await send({"type": "wake" if on else "sleep"})


async def place(uid, title=""):
    # Like the real reader: a new tag replaces the old without a tag-gone.
    if uid == state["tag"]:
        return
    state["tag"] = uid
    await set_awake(True)
    print(f"  -> tag {uid}  {title}")
    await send({"type": "tag", "uid": uid, "at": time.strftime("%H:%M:%S")})


async def remove():
    if state["tag"] is None:
        return
    state["tag"] = None
    print("  -> tag-gone")
    await send({"type": "tag-gone"})


async def double_read(known, stray="64fa8b8e", flips=6):
    """Replays what the PN532 does with two tags in its field (seen on the case:
    an NTAG sticker plus a 4-byte card on the same product): it reports them
    alternately, about once a second, and only sends tag-gone when both leave."""
    print(f"  -> two tags in range: {known} and {stray}")
    for i in range(flips):
        uid = known if i % 2 == 0 else stray
        state["tag"] = uid
        await send({"type": "tag", "uid": uid, "at": time.strftime("%H:%M:%S")})
        await asyncio.sleep(1.1)


def print_items(items):
    if not items:
        print("  no items in content/items.json")
    for i, (uid, title) in enumerate(items, 1):
        print(f"  {i}  {uid}  {title:<32} {UI_DEV_URL}/?tag={uid}")


async def command(key):
    items = load_items()
    if key == "n" and items:
        state["index"] = (state["index"] + 1) % len(items)
        await place(*items[state["index"]])
    elif key.isdigit() and 0 < int(key) <= len(items):
        state["index"] = int(key) - 1
        await place(*items[state["index"]])
    elif key == "u":
        await place(UNKNOWN_UID, "(unassigned)")
    elif key == "d":  # two tags in range at once: the real reader alternates between them
        if items:
            asyncio.ensure_future(double_read(items[0][0]))
    elif key == "b":  # a brand-new sticker, for trying out tag programming
        await place("04" + os.urandom(6).hex(), "(blank tag)")
    elif key == "r":
        await remove()
    elif key == "s":
        await set_awake(not state["awake"])
    elif key == "l":
        print_items(items)
    elif key == "q":  # line mode; the keypress reader handles q itself
        os._exit(0)


def read_keys(loop):
    """Single keypresses on a terminal; falls back to line input otherwise."""
    def dispatch(ch):
        asyncio.run_coroutine_threadsafe(command(ch.lower()), loop)

    if sys.stdin.isatty():
        try:
            import atexit, termios, tty
            fd = sys.stdin.fileno()
            old = termios.tcgetattr(fd)
            # Put the terminal back however we exit (q, Ctrl-C, crash).
            atexit.register(termios.tcsetattr, fd, termios.TCSADRAIN, old)
            tty.setcbreak(fd)
            while True:
                ch = sys.stdin.read(1)
                if not ch or ch in "qQ":
                    termios.tcsetattr(fd, termios.TCSADRAIN, old)
                    os._exit(0)
                dispatch(ch)
        except ImportError:  # no termios (Windows): line mode below
            pass
    for line in sys.stdin:
        for ch in line.strip():
            dispatch(ch)


async def auto_loop(every):
    """Cycle through items: place, hold, lift, pause, next."""
    while True:
        await command("n")
        await asyncio.sleep(every * 0.7)
        await remove()
        await asyncio.sleep(every * 0.3)


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--auto", type=float, metavar="SECONDS", help="cycle through items on a timer")
    ap.add_argument("--climate", action="store_true", help="emit reserved SHT41 climate messages")
    args = ap.parse_args()

    tasks = [light_loop()]
    if args.climate:
        tasks.append(climate_loop())
    if args.auto:
        tasks.append(auto_loop(args.auto))

    async with websockets.serve(handler, HOST, PORT):
        print(f"mock hardware on ws://{HOST}:{PORT}")
        print("keys: n next · 1-9 item · u unknown · b blank tag · d two tags · r remove · s sleep/wake · l list · q quit")
        print_items(load_items())
        threading.Thread(target=read_keys, args=(asyncio.get_running_loop(),), daemon=True).start()
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
