"""Demo-only proxy for the DGX status service: same data, but the host is reported as "dgx-spark"."""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The app only reads this route. It is fetched from a fixed URL, so nothing in a request can steer the proxy.
STATUS_PATH = "/v1/status"
UPSTREAM_STATUS = "http://127.0.0.1:8330/v1/status"


class Proxy(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != STATUS_PATH:
            self.send_error(404)
            return
        with urllib.request.urlopen(UPSTREAM_STATUS, timeout=10) as upstream:
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
