"""Unit tests for the image adapter's request validation; they do not load a model or need a GPU."""

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.environ["OUTPUT_DIR"] = tempfile.mkdtemp()


def load_server(backend: str):
    os.environ["IMAGE_BACKEND"] = backend
    os.environ.pop("MAX_PIXELS", None)
    os.environ.pop("DEFAULT_STEPS", None)
    if "server" in sys.modules:
        return importlib.reload(sys.modules["server"])
    return importlib.import_module("server")


class ImageAdapterTests(unittest.TestCase):
    def test_z_image_keeps_today_defaults(self):
        server = load_server("z-image")
        caps = server.capabilities()
        self.assertEqual(caps["model"], "Z-Image-Turbo")
        self.assertEqual(caps["defaultSteps"], 9)
        self.assertEqual([size["value"] for size in caps["sizes"]], ["1024x1024", "1536x1024", "1024x1536"])
        self.assertEqual(server.parse_size("1536x1024"), (1536, 1024))

    def test_qwen_image_offers_high_quality_sizes_and_validates_multiples(self):
        server = load_server("qwen-image-2.1")
        caps = server.capabilities()
        self.assertEqual(caps["model"], "Qwen-Image-2.1")
        self.assertEqual(caps["defaultSteps"], 40)
        self.assertIn("2528x1696", [size["value"] for size in caps["sizes"]])
        for size in caps["sizes"]:
            width, height = server.parse_size(size["value"])
            self.assertEqual(width % 32, 0)
            self.assertEqual(height % 32, 0)
        with self.assertRaises(server.HTTPException):
            server.parse_size("1040x1040")
        with self.assertRaises(server.HTTPException):
            server.parse_size("2752x2752")
        with self.assertRaises(server.HTTPException):
            server.validate_steps(80)

    def test_quantization_names_are_checked_before_torchao_loads(self):
        try:
            os.environ["QUANTIZE"] = "none"
            self.assertIsNone(load_server("qwen-image-2.1").quantization_config(None))
            os.environ["QUANTIZE"] = "float8"
            with self.assertRaises(ValueError):
                load_server("qwen-image-2.1").quantization_config(None)
        finally:
            os.environ.pop("QUANTIZE", None)
        self.assertEqual(load_server("qwen-image-2.1").QUANTIZE, "float8wo")
        self.assertIn("float8wo", load_server("z-image").TORCHAO_CONFIGS)

    def test_qwen_turbo_uses_its_own_schedule_and_prompt_cache(self):
        server = load_server("qwen-image-2.1-turbo")
        caps = server.capabilities()
        self.assertEqual(caps["model"], "Qwen-Image-2.1-Turbo")
        self.assertEqual((caps["defaultSteps"], caps["maxSteps"]), (8, 8))
        # The 8-step schedule comes from the model, so a requested step count is ignored.
        self.assertEqual(server.validate_steps(30), 8)
        self.assertEqual(server.QUANTIZE, "float8wo")
        self.assertEqual(server.BACKEND.pipeline_kwargs, {"use_kv_cache": True})
        self.assertEqual(server.ATTENTION_BACKEND, "")

    def test_attention_backend_follows_the_model(self):
        # Qwen-Image passes an attention mask that flash-attn 2 rejects.
        self.assertEqual(load_server("qwen-image-2.1").ATTENTION_BACKEND, "")
        self.assertEqual(load_server("z-image").ATTENTION_BACKEND, "flash")

    def test_unknown_backend_is_rejected(self):
        with self.assertRaises(SystemExit):
            load_server("dall-e")


if __name__ == "__main__":
    unittest.main()
