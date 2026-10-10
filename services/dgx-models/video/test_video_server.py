"""Unit tests for the video adapter; they run against a fake ComfyUI, so no ComfyUI, model or GPU is needed."""

import asyncio
import base64
import importlib.util
import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi.testclient import TestClient  # noqa: E402

import video_server as server  # noqa: E402
import workflows  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


class FakeComfy(BaseHTTPRequestHandler):
    """Stands in for ComfyUI: queues a graph, "runs" it by writing a video for the save node, and records calls."""

    output_dir: Path = Path()
    input_dir: Path = Path()
    calls: list[tuple[str, dict]] = []
    graphs: list[dict] = []
    inputs_seen: list[list[str]] = []
    history: dict[str, dict] = {}
    down = False
    reject: dict | None = None
    fail_with: str | None = None
    state = threading.Lock()

    @classmethod
    def reset(cls, work_dir: Path) -> None:
        cls.output_dir, cls.input_dir = work_dir / "output", work_dir / "input"
        cls.calls, cls.graphs, cls.inputs_seen, cls.history = [], [], [], {}
        cls.down, cls.reject, cls.fail_with = False, None, None

    def reply(self, status: int, payload: dict | None = None) -> None:
        body = json.dumps(payload or {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/system_stats":
            return self.reply(500 if FakeComfy.down else 200, {"system": {}})
        if self.path.startswith("/history/"):
            prompt_id = self.path.rsplit("/", 1)[1]
            with FakeComfy.state:
                entry = FakeComfy.history.get(prompt_id)
            return self.reply(200, {prompt_id: entry} if entry else {})
        self.reply(404)

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        with FakeComfy.state:
            FakeComfy.calls.append((self.path, body))
        if self.path != "/prompt":
            return self.reply(200)
        if FakeComfy.reject:
            return self.reply(400, FakeComfy.reject)
        graph = body["prompt"]
        prompt_id = f"p{len(FakeComfy.graphs) + 1}"
        with FakeComfy.state:
            FakeComfy.graphs.append(graph)
            FakeComfy.inputs_seen.append(sorted(path.name for path in FakeComfy.input_dir.iterdir()))
        if FakeComfy.fail_with:
            entry = {"status": {"status_str": "error", "completed": False, "messages": [["execution_error", {"node_type": "SamplerCustomAdvanced", "exception_message": FakeComfy.fail_with}]]}}
        else:
            prefix = graph[workflows.SAVE_NODE]["inputs"]["filename_prefix"]
            subfolder, stem = prefix.split("/")
            (FakeComfy.output_dir / subfolder).mkdir(parents=True, exist_ok=True)
            (FakeComfy.output_dir / subfolder / f"{stem}_00001_.mp4").write_bytes(FAKE_MP4)
            entry = {
                "status": {"status_str": "success", "completed": True, "messages": []},
                "outputs": {workflows.SAVE_NODE: {"images": [{"filename": f"{stem}_00001_.mp4", "subfolder": subfolder, "type": "output"}], "animated": [True]}},
            }
        with FakeComfy.state:
            FakeComfy.history[prompt_id] = entry
        self.reply(200, {"prompt_id": prompt_id, "number": 1, "node_errors": {}})

    def log_message(self, format: str, *args: object) -> None:
        pass


class WorkflowTests(unittest.TestCase):
    def test_frames_follow_the_models_17k_plus_5_grid(self):
        self.assertEqual(workflows.frames_for(5), 124)
        self.assertEqual(workflows.frames_for(8), 192)
        for seconds in range(1, 16):
            self.assertEqual(workflows.frames_for(seconds) % 17, 5)
            self.assertGreaterEqual(workflows.frames_for(seconds), seconds * workflows.FPS)

    def test_prompt_goes_into_the_sectioned_format(self):
        self.assertEqual(
            workflows.format_prompt("A paper boat in the rain", "rain on tin", "soft piano"),
            "integrated_multimodal_description: [Shot 1] A paper boat in the rain\n"
            "overall_soundscape: rain on tin\nnon_diegetic_music: soft piano",
        )
        written = "integrated_multimodal_description: [Shot 1] A boat\noverall_soundscape: waves"
        self.assertEqual(workflows.format_prompt(written, "ignored", "drums"), written + "\nnon_diegetic_music: drums")

    def test_first_frame_reference_is_added_once(self):
        prompt = workflows.format_prompt("A boat", first_frame=True)
        self.assertTrue(prompt.startswith(workflows.FIRST_FRAME_REFERENCE + "\n"))
        self.assertEqual(workflows.format_prompt(prompt, first_frame=True), prompt)

    def graph(self, **overrides):
        options = dict(prompt="p", width=864, height=480, frames=124, seed=42, unet="u.safetensors", text_encoder="t", video_vae="v", audio_vae="a", filename_prefix="sparklingkit/job")
        return workflows.build_graph(**{**options, **overrides})

    def test_graph_links_only_to_nodes_it_has(self):
        for graph in (self.graph(), self.graph(first_frame="frame.png")):
            for node in graph.values():
                for value in node["inputs"].values():
                    if isinstance(value, list):
                        self.assertIn(value[0], graph)

    def test_first_frame_is_scaled_to_the_requested_size(self):
        self.assertNotIn("first_frame", self.graph())
        graph = self.graph(first_frame="frame.png", width=1280, height=736)
        self.assertEqual(graph["first_frame"]["inputs"]["image"], "frame.png")
        self.assertEqual(graph["first_frame_scaled"]["inputs"] | {"image": None}, {"image": None, "upscale_method": "lanczos", "width": 1280, "height": 736, "crop": "center"})
        self.assertEqual(graph["conditioning"]["inputs"]["first_frame"], ["first_frame_scaled", 0])

    def test_graph_keeps_the_templates_sampler_settings(self):
        graph = self.graph()
        self.assertEqual(graph["sigmas"]["inputs"]["steps"], 8)
        self.assertEqual(graph["sampler"]["inputs"]["sampler_name"], "res_multistep")
        self.assertEqual(graph["shift"]["inputs"], {"model": ["unet", 0], "shift_video": 10, "shift_audio": 3})
        self.assertEqual(graph["sparse"]["inputs"]["selection"], "vsa")


class AdapterTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work_dir = Path(folder.name)
        FakeComfy.reset(self.work_dir)
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        comfy = server.Comfy(f"http://127.0.0.1:{httpd.server_address[1]}", poll_interval=0.01)
        self.service = server.VideoService(comfy, server.BACKENDS["fasth3"], self.work_dir, idle_unload_seconds=600)
        self.client = TestClient(server.create_app(self.service, "FastH3"))

    def generate(self, **body):
        return self.client.post("/v1/videos/generations", json={"prompt": "A paper boat drifting in the rain", **body})

    def frees(self):
        return [path for path, _ in FakeComfy.calls if path == "/free"]

    def test_capabilities_describe_sizes_durations_variants_and_disclosure(self):
        capabilities = self.client.get("/v1/capabilities").json()
        self.assertEqual([size["value"] for size in capabilities["sizes"]], ["864x480", "1280x736", "1344x768"])
        self.assertEqual(capabilities["durations"], [5, 8])
        self.assertEqual([variant["id"] for variant in capabilities["variants"]], ["fast", "sharp"])
        self.assertEqual(capabilities["defaultVariant"], "fast")
        self.assertEqual(capabilities["disclosure"], "AI-generated with MiniMax H3 (FastH3)")
        self.assertIsNone(capabilities["loaded"])

    def test_returns_the_video_and_what_produced_it(self):
        response = self.generate(size="1280x736", duration=8, seed=7, sound="rain on tin")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertEqual(response.content, FAKE_MP4)
        self.assertEqual((response.headers["x-seed"], response.headers["x-variant"], response.headers["x-frames"], response.headers["x-size"]), ("7", "fast", "192", "1280x736"))
        self.assertEqual(response.headers["x-disclosure"], "AI-generated with MiniMax H3 (FastH3)")
        graph = FakeComfy.graphs[0]
        self.assertEqual(graph["unet"]["inputs"]["unet_name"], "fastvideo_fasth3_trim_8step_nvfp4.safetensors")
        self.assertEqual((graph["conditioning"]["inputs"]["width"], graph["conditioning"]["inputs"]["height"], graph["conditioning"]["inputs"]["length"]), (1280, 736, 192))
        self.assertEqual(graph["noise"]["inputs"]["noise_seed"], 7)
        self.assertIn("overall_soundscape: rain on tin", graph["conditioning"]["inputs"]["prompt"])
        self.assertEqual(self.service.loaded, "fast")
        # The video is removed once it has been sent.
        self.assertEqual(list((self.work_dir / "output" / "sparklingkit").iterdir()), [])

    def test_first_frame_is_handed_to_comfy_and_removed_afterwards(self):
        response = self.generate(first_frame="data:image/png;base64," + base64.b64encode(PNG).decode())
        self.assertEqual(response.status_code, 200)
        graph = FakeComfy.graphs[0]
        image = graph["first_frame"]["inputs"]["image"]
        self.assertEqual(FakeComfy.inputs_seen[0], [image])
        self.assertTrue(graph["conditioning"]["inputs"]["prompt"].startswith(workflows.FIRST_FRAME_REFERENCE))
        self.assertEqual(list((self.work_dir / "input").iterdir()), [])

    def test_switching_variants_frees_the_loaded_one_first(self):
        self.assertEqual(self.generate().status_code, 200)
        self.assertEqual(self.generate().status_code, 200)
        self.assertEqual(self.frees(), [])
        self.assertEqual(self.generate(variant="sharp").status_code, 200)
        self.assertEqual(len(self.frees()), 1)
        self.assertEqual(FakeComfy.graphs[-1]["unet"]["inputs"]["unet_name"], "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors")
        self.assertEqual(self.service.loaded, "sharp")

    def test_frees_the_weights_after_the_idle_timeout_only(self):
        self.assertFalse(asyncio.run(self.service.unload_if_idle()))  # nothing loaded
        self.assertEqual(self.generate().status_code, 200)
        self.assertFalse(asyncio.run(self.service.unload_if_idle()))  # used just now
        self.service.last_used = time.monotonic() - 601
        self.assertTrue(asyncio.run(self.service.unload_if_idle()))
        self.assertEqual(len(self.frees()), 1)
        self.assertIsNone(self.service.loaded)

    def test_unload_route_frees_now(self):
        self.assertEqual(self.client.post("/v1/unload").json(), {"ok": True})
        self.assertEqual(len(self.frees()), 1)

    def test_rejects_requests_the_model_cannot_serve(self):
        for body, message in (
            ({"size": "1024x1024"}, "does not offer 1024x1024"),
            ({"duration": 6}, "Duration must be one of 5 s, 8 s"),
            ({"variant": "turbo"}, "Unknown variant"),
            ({"first_frame": "not base64!"}, "base64"),
            ({"first_frame": base64.b64encode(b"GIF89a").decode()}, "PNG, JPEG or WebP"),
        ):
            response = self.generate(**body)
            self.assertEqual(response.status_code, 400, body)
            self.assertIn(message, response.json()["detail"])
        self.assertEqual(FakeComfy.graphs, [])

    def test_reports_comfys_validation_and_execution_errors(self):
        FakeComfy.reject = {"error": {"message": "Prompt outputs failed validation"}, "node_errors": {"unet": {"class_type": "UNETLoader", "errors": [{"message": "Value not in list", "details": "unet_name: x.safetensors"}]}}}
        response = self.generate()
        self.assertEqual(response.status_code, 502)
        self.assertIn("unet (UNETLoader): Value not in list", response.json()["detail"])
        FakeComfy.reject, FakeComfy.fail_with = None, "CUDA out of memory"
        response = self.generate()
        self.assertEqual(response.status_code, 502)
        self.assertIn("SamplerCustomAdvanced failed: CUDA out of memory", response.json()["detail"])

    def test_health_follows_comfy(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        FakeComfy.down = True
        self.assertEqual(self.client.get("/health").status_code, 503)

    def test_comfy_runs_headless_on_a_private_port(self):
        command = server.comfy_command(Path("/opt/ComfyUI"), 8347, Path("/tmp/work"), "/app/paths.yaml")
        self.assertEqual(command[1:6], ["/opt/ComfyUI/main.py", "--listen", "127.0.0.1", "--port", "8347"])
        self.assertIn("--disable-metadata", command)

    def test_base_directory_has_the_folders_comfy_lists_at_start(self):
        server.prepare_base_directory(self.work_dir / "fresh")
        self.assertEqual(sorted(path.name for path in (self.work_dir / "fresh").iterdir()), ["custom_nodes", "input", "models", "output", "temp", "user"])


@unittest.skipUnless(importlib.util.find_spec("av"), "PyAV is installed in the service image, not in CI")
class TaggingTests(unittest.TestCase):
    def test_copies_the_streams_and_adds_the_comment(self):
        import av

        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "in.mp4", Path(folder) / "out.mp4"
            with av.open(str(source), "w") as writer:
                stream = writer.add_stream("mpeg4", rate=24)
                stream.width, stream.height, stream.pix_fmt = 64, 64, "yuv420p"
                for index in range(3):
                    frame = av.VideoFrame(64, 64, "yuv420p")
                    frame.pts = index
                    for packet in stream.encode(frame):
                        writer.mux(packet)
                for packet in stream.encode():
                    writer.mux(packet)
            server.tag_video(source, target, "AI-generated with MiniMax H3 (FastH3)")
            with av.open(str(target)) as reader:
                self.assertEqual(reader.metadata.get("comment"), "AI-generated with MiniMax H3 (FastH3)")
                self.assertEqual(sum(1 for _ in reader.decode(video=0)), 3)


if __name__ == "__main__":
    unittest.main()
