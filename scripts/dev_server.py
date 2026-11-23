"""Local preview server for the WSG site.

Serves the site like GitHub Pages does, and lets edit mode's test mode save
changes into this folder (data/site.json and photos in assets/uploads/).
Only listens on this computer. Run from the site folder:

    python3 scripts/dev_server.py 8765
"""
import base64
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.realpath(os.getcwd())
ALLOWED = ("data/site.json", "data/auth.json")
UPLOADS = "assets/uploads/"


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_PUT(self):
        if self.path != "/__save":
            return self.send_error(404)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n))
            rel = str(body["path"]).lstrip("/")
            if not (rel in ALLOWED or (rel.startswith(UPLOADS) and ".." not in rel)):
                return self.send_error(403, "path not allowed")
            full = os.path.realpath(os.path.join(ROOT, rel))
            if not full.startswith(ROOT + os.sep):
                return self.send_error(403, "path not allowed")
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "wb") as f:
                f.write(base64.b64decode(body["content"]))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:  # noqa: BLE001
            self.send_error(400, str(e))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
