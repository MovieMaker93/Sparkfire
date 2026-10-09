"""Runs status-proxy.py the way the demo does and checks that it only ever forwards the status route.

  python -m unittest test_status_proxy      (from scripts/media, in a container: it binds ports 8330 and 8399)
"""
import http.server
import json
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

PROXY = Path(__file__).with_name("status-proxy.py")
BASE = "http://127.0.0.1:8399"


class FakeStatusService(http.server.BaseHTTPRequestHandler):
    """Stands in for the DGX status service on 8330 and records every path it is asked for."""

    seen: list[str] = []

    def do_GET(self):
        FakeStatusService.seen.append(self.path)
        body = json.dumps({"ok": True, "host": {"hostname": "real-host-name"}, "services": []}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class StatusProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 8330), FakeStatusService)
        threading.Thread(target=cls.upstream.serve_forever, daemon=True).start()
        cls.proxy = subprocess.Popen([sys.executable, str(PROXY)])
        for _ in range(100):
            try:
                urllib.request.urlopen(f"{BASE}/v1/status", timeout=1).close()
                break
            except (urllib.error.URLError, ConnectionError):
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proxy.terminate()
        cls.proxy.wait()
        cls.upstream.shutdown()

    def setUp(self):
        FakeStatusService.seen.clear()

    def test_status_is_forwarded_with_a_neutral_host_name(self):
        with urllib.request.urlopen(f"{BASE}/v1/status", timeout=5) as response:
            body = json.load(response)
        self.assertEqual(body["host"]["hostname"], "dgx-spark")
        self.assertEqual(FakeStatusService.seen, ["/v1/status"])

    def test_any_other_path_is_refused_without_reaching_the_service(self):
        for path in ["/admin", "/v1/status/../../admin", "//evil.example/x", "/v1/status?next=//evil.example"]:
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(BASE + path, timeout=5)
                self.assertEqual(caught.exception.code, 404)
        self.assertEqual(FakeStatusService.seen, [])


if __name__ == "__main__":
    unittest.main()
