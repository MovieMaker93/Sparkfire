"""Unit tests for the Parakeet adapter; they run against a fake engine, so no binary, model or GPU is needed."""

import asyncio
import struct
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient  # noqa: E402

import parakeet_server as server  # noqa: E402

# A 44-byte RIFF/WAVE header (16 kHz, mono, 16-bit) followed by 0.1 s of silence.
WAV = (
    b"RIFF" + struct.pack("<I", 36 + 3200) + b"WAVEfmt "
    + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16)
    + b"data" + struct.pack("<I", 3200) + b"\x00" * 3200
)


class FakeEngine(BaseHTTPRequestHandler):
    """Stands in for parakeet-server: records each POST body, answers one at a time slowly enough to expose overlap."""

    bodies: list[bytes] = []
    down = False
    reply_status = 200
    reply_body = b'{"text": "hello"}'
    in_flight = 0
    max_in_flight = 0
    state = threading.Lock()

    @classmethod
    def reset(cls) -> None:
        cls.bodies, cls.down = [], False
        cls.reply_status, cls.reply_body = 200, b'{"text": "hello"}'
        cls.in_flight = cls.max_in_flight = 0

    def do_GET(self) -> None:
        self.send_response(500 if FakeEngine.down else 200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers["Content-Length"]))
        with FakeEngine.state:
            FakeEngine.bodies.append(body)
            FakeEngine.in_flight += 1
            FakeEngine.max_in_flight = max(FakeEngine.max_in_flight, FakeEngine.in_flight)
        time.sleep(0.2)
        with FakeEngine.state:
            FakeEngine.in_flight -= 1
        self.send_response(FakeEngine.reply_status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(FakeEngine.reply_body)))
        self.end_headers()
        self.wfile.write(FakeEngine.reply_body)

    def log_message(self, format: str, *args: object) -> None:
        pass


class AdapterTests(unittest.TestCase):
    def setUp(self):
        FakeEngine.reset()
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeEngine)
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        self.engine_url = f"http://127.0.0.1:{httpd.server_address[1]}"
        self.client = TestClient(server.create_app(server.Engine(self.engine_url), "Parakeet-TDT-0.6B-v3"))

    def transcribe(self, client=None, **data):
        return (client or self.client).post(
            "/v1/audio/transcriptions",
            files={"file": ("chunk.wav", WAV, "audio/wav")},
            data=data,
        )

    def test_health_follows_the_engine(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        FakeEngine.down = True
        self.assertEqual(self.client.get("/health").status_code, 503)

    def test_models_lists_the_configured_name(self):
        self.assertEqual(
            self.client.get("/v1/models").json(),
            {"object": "list", "data": [{"id": "Parakeet-TDT-0.6B-v3", "object": "model"}]},
        )

    def test_forwards_format_and_every_granularity(self):
        response = self.transcribe(
            model="Qwen3-ASR-1.7B",
            temperature="0",
            response_format="verbose_json",
            **{"timestamp_granularities[]": ["word", "segment"]},
        )
        self.assertEqual((response.status_code, response.json()), (200, {"text": "hello"}))
        body = FakeEngine.bodies[-1]
        self.assertIn(b"verbose_json", body)
        self.assertEqual(body.count(b'name="timestamp_granularities[]"'), 2)
        self.assertNotIn(b'name="model"', body)
        self.assertNotIn(b'name="temperature"', body)

    def test_returns_engine_errors_unchanged(self):
        FakeEngine.reply_status, FakeEngine.reply_body = 500, b'{"error": "boom"}'
        response = self.transcribe()
        self.assertEqual((response.status_code, response.json()), (500, {"error": "boom"}))

    def test_refuses_audio_that_is_not_wav(self):
        response = self.client.post("/v1/audio/transcriptions", files={"file": ("a.mp3", b"ID3" + b"\x00" * 64, "audio/mpeg")})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Upload WAV audio; SparklingKit sends 16 kHz WAV chunks")
        self.assertEqual(FakeEngine.bodies, [])

    def test_engine_down_gives_503(self):
        offline = TestClient(server.create_app(server.Engine("http://127.0.0.1:9"), "Parakeet-TDT-0.6B-v3"))
        response = self.transcribe(offline)
        self.assertEqual((response.status_code, response.json()), (503, {"detail": "The Parakeet engine is not reachable"}))

    def test_requests_run_one_at_a_time(self):
        engine = server.Engine(self.engine_url)

        async def both():
            return await asyncio.gather(engine.transcribe(WAV, "a.wav", []), engine.transcribe(WAV, "b.wav", []))

        statuses = [status for status, _, _ in asyncio.run(both())]
        self.assertEqual(statuses, [200, 200])
        self.assertEqual(FakeEngine.max_in_flight, 1)

    def test_watcher_reports_the_engine_exit(self):
        class Process:
            codes = iter([None, None, 7])

            def poll(self):
                return next(self.codes)

        exits = []
        server.watch_engine(Process(), exits.append, interval=0.01).join(timeout=5)
        self.assertEqual(exits, [7])


if __name__ == "__main__":
    unittest.main()
