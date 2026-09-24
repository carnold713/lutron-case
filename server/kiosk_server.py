#!/usr/bin/env python3
"""Local web server for the case UI (replaces `python3 -m http.server`).

Serves the built app from --root, plus one small API so tags can be assigned
from the case's own screen:

    GET  /api/tags                      -> {"<uid>": "<content id>" | null, ...}
    POST /api/tags  {"uid": "...", "target": "<content id>" | null}

Assignments made on the case are stored in --data/tags.json, OUTSIDE the
deployed content/ folder: update.sh re-syncs content/ from GitHub with
--delete, and would otherwise wipe them. The UI merges them over the repo's
content/tags.json (local wins; null means "explicitly unassigned").

Stdlib only. Bound to localhost: only the kiosk browser talks to it.
"""

import argparse, json, os, re, tempfile, threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_ROOT = os.path.expanduser("~/kiosk/ui")
DEFAULT_DATA = os.path.expanduser("~/kiosk/data")
HOST, DEFAULT_PORT = "127.0.0.1", 8080
UID_RE = re.compile(r"^[0-9a-f]{4,32}$")          # lowercase hex, as hardware.py sends
TARGET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_BODY = 4096

_lock = threading.Lock()


def load_tags(path):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def save_tags(path, tags):
    # Write-then-rename so a power cut mid-write can't leave half a file.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tags-")
    with os.fdopen(fd, "w") as f:
        json.dump(tags, f, indent=2, sort_keys=True)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class Handler(SimpleHTTPRequestHandler):
    tags_path = None

    def end_headers(self):
        # Always revalidate: after a deploy the browser must pick up the new
        # index.html / items.json, not a heuristically-cached old copy.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the journal quiet: API calls only
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/tags":
            with _lock:
                return self._json(200, load_tags(self.tags_path))
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/tags":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ValueError("too large")
            msg = json.loads(self.rfile.read(length) or b"{}")
            uid, target = str(msg.get("uid", "")).lower(), msg.get("target")
            if not UID_RE.match(uid):
                raise ValueError("bad uid")
            if target is not None and not (isinstance(target, str) and TARGET_RE.match(target)):
                raise ValueError("bad target")
        except (ValueError, TypeError) as e:
            return self._json(400, {"error": str(e)})
        with _lock:
            tags = load_tags(self.tags_path)
            tags[uid] = target
            save_tags(self.tags_path, tags)
        self.log_message("tag %s -> %s", uid, target)
        return self._json(200, {"uid": uid, "target": target})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=DEFAULT_ROOT, help="built UI directory")
    ap.add_argument("--data", default=DEFAULT_DATA, help="where case-local tags.json lives")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = ap.parse_args()

    Handler.tags_path = os.path.join(args.data, "tags.json")
    server = ThreadingHTTPServer((HOST, args.port), partial(Handler, directory=args.root))
    print(f"kiosk server on http://{HOST}:{args.port}  root={args.root}  tags={Handler.tags_path}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
