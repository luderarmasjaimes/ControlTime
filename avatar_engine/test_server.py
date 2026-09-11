"""Pruebas del contrato HTTP y del límite real de cola de avatar_engine."""

import io
import threading
import time
import unittest
from unittest import mock

import numpy as np

import server


def _png_bytes() -> bytes:
    import cv2

    image = np.full((64, 64, 3), 220, dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


class AvatarEngineHttpTests(unittest.TestCase):
    def setUp(self):
        server._ready = True
        server._pipe = object()
        server._device = "cuda"
        server.MAX_QUEUE_DEPTH = 3
        server.INFERENCE_TIMEOUT_SECONDS = 1.0
        with server._queue_lock:
            server._queue_depth = 0
        with server._stats_lock:
            for key in server._stats:
                server._stats[key] = 0
        self.client = server.app.test_client()

    def tearDown(self):
        deadline = time.monotonic() + 2
        while server._queue_depth and time.monotonic() < deadline:
            time.sleep(0.01)

    def _post(self):
        return self.client.post(
            "/stylize",
            data={"image": (io.BytesIO(_png_bytes()), "input.png")},
            content_type="multipart/form-data",
        )

    def test_inference_error_is_json_and_counted(self):
        with mock.patch.object(
            server.diffusion,
            "stylize_portrait",
            side_effect=RuntimeError("synthetic failure"),
        ):
            response = self._post()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["error"], "inference_failed")
        self.assertEqual(server._stats["error"], 1)
        self.assertEqual(server._queue_depth, 0)

    def test_timeout_keeps_slot_until_gpu_work_finishes(self):
        release = threading.Event()
        server.MAX_QUEUE_DEPTH = 1
        server.INFERENCE_TIMEOUT_SECONDS = 0.02

        def slow_stylize(*_args):
            release.wait(timeout=1)
            return np.zeros((64, 64, 3), dtype=np.uint8)

        with mock.patch.object(server.diffusion, "stylize_portrait", side_effect=slow_stylize):
            first = self._post()
            self.assertEqual(first.status_code, 504)
            self.assertEqual(server._queue_depth, 1)

            second = self._post()
            self.assertEqual(second.status_code, 503)
            self.assertEqual(second.get_json()["error"], "busy")

            release.set()
            deadline = time.monotonic() + 1
            while server._queue_depth and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(server._queue_depth, 0)

    def test_rejects_oversized_input_before_decode(self):
        original = server.MAX_IMAGE_BYTES
        server.MAX_IMAGE_BYTES = 1024
        try:
            response = self.client.post(
                "/stylize",
                data={"image": (io.BytesIO(b"x" * 1025), "large.bin")},
                content_type="multipart/form-data",
            )
        finally:
            server.MAX_IMAGE_BYTES = original

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.get_json()["error"], "image_too_large")


if __name__ == "__main__":
    unittest.main()
