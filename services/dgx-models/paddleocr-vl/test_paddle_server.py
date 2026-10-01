"""Unit tests for the PaddleOCR-VL adapter's response mapping; they need neither PaddleOCR nor a GPU."""

import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import paddle_server as server  # noqa: E402


class AdapterTests(unittest.TestCase):
    def test_maps_parsing_blocks_and_skips_invalid_boxes(self):
        result = {"res": {"width": 1240, "height": 1754, "parsing_res_list": [
            {"block_label": "doc_title", "block_bbox": [80, 60, 600, 110], "block_content": "Quarterly report"},
            {"block_label": "table", "block_bbox": [80, 140, "x", 900], "block_content": "<table>"},
            {"block_bbox": [1, 2, 3, 4]},
        ]}}
        payload = server.result_to_payload(result, "# Quarterly report\n\n\n\n![](imgs/fig_1.jpg)\n\nBody", None, None)
        self.assertEqual(payload["markdown"], "# Quarterly report\n\nBody")
        self.assertEqual((payload["width"], payload["height"]), (1240, 1754))
        self.assertEqual(payload["blocks"], [
            {"label": "doc_title", "bbox": [80.0, 60.0, 600.0, 110.0], "text": "Quarterly report"},
            {"label": "text", "bbox": [1.0, 2.0, 3.0, 4.0], "text": ""},
        ])

    def test_falls_back_to_measured_image_size(self):
        payload = server.result_to_payload({"parsing_res_list": []}, "text", 800, 600)
        self.assertEqual((payload["width"], payload["height"]), (800, 600))

    def test_extracts_the_page_from_a_chat_request(self):
        encoded = base64.b64encode(b"jpeg bytes").decode()
        messages = [{"role": "user", "content": [{"type": "text", "text": "document parsing."}, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}}]}]
        self.assertEqual(server.first_image(messages), (b"jpeg bytes", ".jpg"))
        with self.assertRaises(server.HTTPException):
            server.first_image([{"role": "user", "content": "no image"}])


if __name__ == "__main__":
    unittest.main()
