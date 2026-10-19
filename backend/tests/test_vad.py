from pathlib import Path
import unittest

from fastapi.testclient import TestClient
import numpy as np
from starlette.websockets import WebSocketDisconnect

from backend.app import create_app
from backend.vad import VadService

MODEL = Path(__file__).resolve().parents[2] / "voice-assets" / "vad" / "silero_vad.onnx"


@unittest.skipUnless(MODEL.is_file(), "Run npm run voice:setup for installed-model tests")
class SileroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = VadService(MODEL)

    def test_real_model_rejects_silence(self):
        probabilities = self.service.open_stream().process(np.zeros(2048, dtype="<f4").tobytes())
        self.assertEqual(len(probabilities), 4)
        self.assertLess(max(probabilities), .1)

    def test_each_connection_has_independent_state(self):
        silence = np.zeros(512, dtype="<f4").tobytes()
        first = self.service.open_stream()
        initial = first.process(silence)
        for _ in range(10):
            first.process(silence)
        other = self.service.open_stream().process(silence)
        self.assertEqual(initial, other)

    def test_invalid_binary_frames(self):
        stream = self.service.open_stream()
        for data in (b"", b"bad", np.full(512, np.nan, dtype="<f4").tobytes(), np.full(512, 2, dtype="<f4").tobytes()):
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                stream.process(data)

    def test_websocket_frame_order_and_connection_cleanup(self):
        app = create_app()
        with TestClient(app) as client:
            with client.websocket_connect("/api/voice/vad", headers={"Origin": "http://127.0.0.1:5173"}) as socket:
                self.assertEqual(socket.receive_json()["type"], "ready")
                for sequence in range(2):
                    socket.send_bytes(np.zeros(2048, dtype="<f4").tobytes())
                    result = socket.receive_json()
                    self.assertEqual(result["sequence"], sequence)
                    self.assertEqual(len(result["probabilities"]), 4)
            self.assertEqual(app.state.vad.active_connections, 0)

    def test_bad_frame_closes_stream(self):
        with TestClient(create_app()) as client:
            with client.websocket_connect("/api/voice/vad") as socket:
                socket.receive_json()
                socket.send_bytes(b"invalid")
                self.assertEqual(socket.receive_json()["type"], "error")
                with self.assertRaises(WebSocketDisconnect):
                    socket.receive_json()

    def test_cross_site_stream_is_rejected(self):
        with TestClient(create_app()) as client:
            with self.assertRaises(WebSocketDisconnect) as caught:
                with client.websocket_connect("/api/voice/vad", headers={"Origin": "https://unrelated.example"}):
                    pass
            self.assertEqual(caught.exception.code, 1008)
