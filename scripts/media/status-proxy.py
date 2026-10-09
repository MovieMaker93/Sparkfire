"""Demo-only proxy for the DGX status service: same data, but the host is reported as "dgx-spark"."""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "http://127.0.0.1:8330"


class Proxy(BaseHTTPRequestHandler):
    def do_GET(self):
        with urllib.request.urlopen(UPSTREAM + self.path, timeout=10) as upstream:
            body = upstream.read()
            status = upstream.status
        try:
            payload = json.loads(body)
            if isinstance(payload.get("host"), dict):
                payload["host"]["hostname"] = "dgx-spark"
            body = json.dumps(payload).encode()
        except (ValueError, AttributeError):
            pass
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", 8399), Proxy).serve_forever()
