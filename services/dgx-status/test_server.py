import tempfile
import unittest
from pathlib import Path

import server


class StatusReporterTests(unittest.TestCase):
    def test_parse_meminfo_uses_binary_kibibytes(self):
        result = server.parse_meminfo("MemTotal: 1024 kB\nMemAvailable: 256 kB\n")
        self.assertEqual(result["MemTotal"], 1024 * 1024)
        self.assertEqual(result["MemAvailable"], 256 * 1024)

    def test_flag_value_supports_split_and_equals_forms(self):
        self.assertEqual(server.flag_value(["vllm", "--port", "8331"], "--port"), "8331")
        self.assertEqual(server.flag_value(["vllm", "--port=8331"], "--port"), "8331")

    def test_optional_number_handles_unavailable_values(self):
        self.assertIsNone(server.optional_number("N/A"))
        self.assertEqual(server.optional_number("42", int), 42)


class ProcessServiceTests(unittest.TestCase):
    def setUp(self):
        self.original_proc_root = server.PROC_ROOT
        self.proc = tempfile.TemporaryDirectory()
        server.PROC_ROOT = Path(self.proc.name)

    def tearDown(self):
        server.PROC_ROOT = self.original_proc_root
        self.proc.cleanup()

    def write_process(self, pid, args, environment):
        directory = Path(self.proc.name) / str(pid)
        directory.mkdir()
        (directory / "cmdline").write_bytes(b"\0".join(part.encode() for part in args) + b"\0")
        (directory / "environ").write_bytes(b"\0".join(f"{key}={value}".encode() for key, value in environment.items()) + b"\0")

    def test_names_the_parakeet_engine_as_asr(self):
        # The engine is a child of the adapter and inherits its environment; no status file, so no parent to walk to.
        self.write_process(
            4242,
            ["parakeet-server", "--model", "/models/x.gguf", "--host", "127.0.0.1", "--port", "8343"],
            {"MODEL_NAME": "Parakeet-TDT-0.6B-v3", "PORT": "8333"},
        )
        self.assertEqual(
            server.resolve_process_service(4242),
            {"service": "asr", "serviceLabel": "ASR", "port": 8343, "model": "Parakeet-TDT-0.6B-v3"},
        )


if __name__ == "__main__":
    unittest.main()
