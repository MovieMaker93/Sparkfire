"""Unit tests for the music adapter; they run against a fake engine, so no model, torch or GPU is needed."""

import asyncio
import json
import sys
import tempfile
import threading
import time
import unittest
from email.parser import BytesParser
from email.policy import HTTP
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient  # noqa: E402

import music_server as server  # noqa: E402

FLAC = b"fLaC" + b"\x00" * 64
SCORE = "X:1\nT:\nM:4/4\nL:1/8\nK:C\nV: Vocal\nCDEF GABc|\n"


class FakeEngine:
    def __init__(self) -> None:
        self._loaded = False
        self.calls: list[dict] = []
        self.loads = 0
        self.unloads = 0
        self.gate: threading.Event | None = None
        self.fail: Exception | None = None

    @property
    def loaded(self) -> bool:
        return self._loaded

    def load(self) -> None:
        if not self._loaded:
            self.loads += 1
            self._loaded = True

    def generate(self, style, lyrics, score, seed, cancelled):
        self.load()
        self.calls.append({"style": style, "lyrics": lyrics, "score": score, "seed": seed})
        if self.gate is not None:
            while not self.gate.wait(0.01):
                if cancelled():
                    raise InterruptedError("Cancelled during acoustic flow matching")
        if self.fail is not None:
            raise self.fail
        return server.Song(flac=FLAC, score=score or SCORE, seed=seed, duration_seconds=46.8, elapsed_seconds=44.1,
                           truncated={"abc": False, "semantic": False})

    def unload(self) -> None:
        if self._loaded:
            self.unloads += 1
            self._loaded = False


def parts(response) -> dict:
    """The named parts of a multipart/form-data response."""
    message = BytesParser(policy=HTTP).parsebytes(f"Content-Type: {response.headers['content-type']}\r\n\r\n".encode() + response.content)
    return {part.get_param("name", header="content-disposition"): part for part in message.iter_parts()}


def make(memory=lambda: 80.0, idle=600.0):
    engine = FakeEngine()
    service = server.MusicService(engine, server.BACKENDS["yue2"], idle, memory=memory)
    return engine, service, TestClient(server.create_app(service, "YuE2-3B", idle_check_seconds=3600))


class MusicAdapterTest(unittest.TestCase):
    def test_capabilities_describe_limits_output_and_license(self):
        _, _, client = make()
        with client:
            body = client.get("/v1/capabilities").json()
        self.assertEqual(body["model"], "YuE2-3B")
        self.assertEqual(body["output"], {"mimeType": "audio/flac", "sampleRate": 48000, "channels": 2})
        self.assertTrue(body["acceptsScore"])
        self.assertIn("CC BY-NC 4.0", body["license"])
        self.assertFalse(body["loaded"])
        self.assertEqual(client.get("/v1/models").json()["data"][0]["id"], "YuE2-3B")

    def test_a_song_comes_back_as_audio_score_and_metadata(self):
        engine, _, client = make()
        with client:
            response = client.post("/v1/music/generations", json={"style": "Italian, pop ballad, male tenor", "lyrics": "[Verse]\nCade la sera", "seed": 1234})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.headers["content-type"].startswith("multipart/form-data; boundary="))
        found = parts(response)
        self.assertEqual(found["audio"].get_content_type(), "audio/flac")
        self.assertEqual(found["audio"].get_payload(decode=True), FLAC)
        self.assertEqual(found["score"].get_payload(decode=True).decode(), SCORE)
        metadata = json.loads(found["metadata"].get_payload(decode=True))
        self.assertEqual(metadata | {"license": ""}, {"model": "YuE2-3B", "seed": 1234, "durationSeconds": 46.8, "elapsedSeconds": 44.1,
                                                      "truncated": {"abc": False, "semantic": False}, "license": ""})
        self.assertEqual(engine.calls, [{"style": "Italian, pop ballad, male tenor", "lyrics": "[Verse]\nCade la sera", "score": None, "seed": 1234}])

    def test_a_given_score_is_sung_instead_of_a_new_one(self):
        engine, _, client = make()
        edited = SCORE.replace("CDEF", "EDCD")
        with client:
            response = client.post("/v1/music/generations", json={"style": "jazz", "lyrics": "la la", "score": edited})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(engine.calls[0]["score"], edited)
        self.assertEqual(parts(response)["score"].get_payload(decode=True).decode(), edited)

    def test_a_random_seed_is_chosen_and_reported_when_none_is_given(self):
        engine, _, client = make()
        with client:
            response = client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"})
        seed = json.loads(parts(response)["metadata"].get_payload(decode=True))["seed"]
        self.assertEqual(engine.calls[0]["seed"], seed)
        self.assertTrue(0 <= seed <= server.MAX_SEED)

    def test_refuses_requests_it_cannot_sing(self):
        engine, _, client = make()
        with client:
            for body in ({"style": "pop"}, {"lyrics": "la"}, {"style": "", "lyrics": "la"}, {"style": "  ", "lyrics": "la"},
                         {"style": "pop", "lyrics": "x" * (server.MAX_LYRICS_CHARS + 1)}, {"style": "pop", "lyrics": "la", "seed": -1},
                         {"style": "pop", "lyrics": "la", "seed": server.MAX_SEED + 1}):
                self.assertEqual(client.post("/v1/music/generations", json=body).status_code, 422, body)
        self.assertEqual(engine.calls, [])

    def test_a_score_the_model_rejects_is_a_bad_request(self):
        engine, _, client = make()
        engine.fail = ValueError("External ABC requires nonempty text and cot=melody/full")
        with client:
            response = client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la", "score": "?"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("External ABC", response.json()["detail"])

    def test_does_not_load_when_the_machine_lacks_the_memory(self):
        engine, _, client = make(memory=lambda: 12.4)
        with client:
            response = client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("12 GiB available, 22 GiB needed", response.json()["detail"])
        self.assertEqual(response.headers["retry-after"], "60")
        self.assertEqual(engine.loads, 0)

    def test_a_loaded_model_needs_no_memory_check(self):
        free = [80.0]
        engine, _, client = make(memory=lambda: free[0])
        with client:
            self.assertEqual(client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"}).status_code, 200)
            free[0] = 3.0  # the model itself now takes the memory the check would miss
            self.assertEqual(client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"}).status_code, 200)
        self.assertEqual(engine.loads, 1)

    def test_an_unknown_memory_reading_does_not_block_a_song(self):
        _, _, client = make(memory=lambda: None)
        with client:
            self.assertEqual(client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"}).status_code, 200)

    def test_unload_frees_the_weights_and_the_next_song_loads_again(self):
        engine, _, client = make()
        with client:
            client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"})
            self.assertTrue(client.get("/health").json()["loaded"])
            self.assertEqual(client.post("/v1/unload").json(), {"ok": True})
            self.assertFalse(client.get("/v1/capabilities").json()["loaded"])
            client.post("/v1/music/generations", json={"style": "pop", "lyrics": "la"})
        self.assertEqual((engine.loads, engine.unloads), (2, 1))

    def test_unload_with_nothing_loaded_is_harmless(self):
        engine, _, client = make()
        with client:
            self.assertEqual(client.post("/v1/unload").status_code, 200)
        self.assertEqual(engine.unloads, 0)


class MusicServiceTest(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def test_frees_the_model_after_the_idle_timeout_and_not_before(self):
        engine, service, _ = make(idle=0.05)

        async def scenario():
            never = lambda: asyncio.sleep(0, result=False)  # noqa: E731
            await service.generate(server.MusicRequest(style="pop", lyrics="la"), never)
            self.assertFalse(await service.unload_if_idle())
            await asyncio.sleep(0.08)
            self.assertTrue(await service.unload_if_idle())
            self.assertFalse(await service.unload_if_idle())

        self.run_async(scenario())
        self.assertEqual(engine.unloads, 1)

    def test_never_unloads_during_a_song(self):
        engine, service, _ = make(idle=0)
        engine.gate = threading.Event()

        async def scenario():
            never = lambda: asyncio.sleep(0, result=False)  # noqa: E731
            song = asyncio.create_task(service.generate(server.MusicRequest(style="pop", lyrics="la"), never))
            await asyncio.sleep(0.05)
            self.assertFalse(await service.unload_if_idle())
            engine.gate.set()
            await song

        self.run_async(scenario())
        self.assertEqual(engine.unloads, 0)

    def test_sings_one_song_at_a_time(self):
        engine, service, _ = make()
        engine.gate = threading.Event()
        order = []

        async def scenario():
            never = lambda: asyncio.sleep(0, result=False)  # noqa: E731

            async def sing(name):
                await service.generate(server.MusicRequest(style=name, lyrics="la"), never)
                order.append(name)

            first = asyncio.create_task(sing("first"))
            await asyncio.sleep(0.05)
            second = asyncio.create_task(sing("second"))
            await asyncio.sleep(0.05)
            self.assertEqual([call["style"] for call in engine.calls], ["first"])
            engine.gate.set()
            await asyncio.gather(first, second)

        self.run_async(scenario())
        self.assertEqual(order, ["first", "second"])

    def test_stops_the_song_when_the_caller_goes_away(self):
        engine, service, _ = make()
        engine.gate = threading.Event()
        gone = asyncio.Event()

        async def scenario():
            async def disconnected():
                return gone.is_set()

            song = asyncio.create_task(service.generate(server.MusicRequest(style="pop", lyrics="la"), disconnected))
            await asyncio.sleep(0.05)
            gone.set()
            with self.assertRaises(server.Cancelled):
                await asyncio.wait_for(song, 5)

        started = time.monotonic()
        self.run_async(scenario())
        self.assertLess(time.monotonic() - started, 4)


class MemoryReadingTest(unittest.TestCase):
    def test_reads_available_memory_from_meminfo(self):
        with tempfile.TemporaryDirectory() as folder:
            meminfo = Path(folder) / "meminfo"
            meminfo.write_text("MemTotal:       127535712 kB\nMemFree:         9031880 kB\nMemAvailable:   60817408 kB\n")
            self.assertAlmostEqual(server.available_gib(meminfo), 58.0, places=1)
            meminfo.write_text("MemTotal: 1 kB\n")
            self.assertIsNone(server.available_gib(meminfo))
            self.assertIsNone(server.available_gib(Path(folder) / "missing"))


class MultipartTest(unittest.TestCase):
    def test_writes_named_parts_with_a_boundary_that_cannot_clash(self):
        body, content_type = server.multipart([("a", "text/plain", None, b"one"), ("b", "audio/flac", "x.flac", b"\x00two")])
        boundary = content_type.split("boundary=")[1]
        self.assertTrue(boundary.startswith("sparkfire-"))
        self.assertIn(b'Content-Disposition: form-data; name="b"; filename="x.flac"\r\nContent-Type: audio/flac\r\n\r\n\x00two\r\n', body)
        self.assertTrue(body.endswith(f"--{boundary}--\r\n".encode()))


if __name__ == "__main__":
    unittest.main()
