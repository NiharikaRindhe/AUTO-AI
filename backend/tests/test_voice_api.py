from __future__ import annotations

import asyncio
from dataclasses import replace
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import VoiceConfig, VoiceEngine, create_app, validate_wav


def wav_bytes(seconds=1, sample=1000, channels=1, rate=16000):
    result = io.BytesIO()
    with wave.open(result, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(struct.pack("<h", sample) * int(seconds * rate) * channels)
    return result.getvalue()


class VoiceAPITests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.config = VoiceConfig(root / "whisper.exe", root / "model.bin", root / "voice.onnx")
        for path in (self.config.cli, self.config.model, self.config.voice, Path(str(self.config.voice) + ".json")):
            path.write_bytes(b"test asset")
        self.app = create_app(self.config)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.folder.cleanup()

    def test_health_reports_missing_assets_without_starting_models(self):
        self.config.model.unlink()
        result = self.client.get("/api/voice/health").json()
        self.assertFalse(result["ready"])
        self.assertIn("Whisper model", result["missing"])

    def test_cross_site_request_is_rejected(self):
        result = self.client.post("/api/voice/synthesize", json={"text": "Hello"}, headers={"Origin": "https://unrelated.example"})
        self.assertEqual(result.status_code, 403)

    def test_untrusted_host_is_rejected(self):
        self.assertEqual(self.client.get("/api/voice/health", headers={"Host": "unrelated.example"}).status_code, 400)

    def test_local_ui_origin_is_allowed(self):
        result = self.client.get("/api/voice/health", headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["access-control-allow-origin"], "http://127.0.0.1:5173")
        self.assertEqual(result.headers["cache-control"], "no-store")

    def test_invalid_audio_and_language_do_not_start_inference(self):
        for body, language in ((b"not wav", "en"), (wav_bytes(), "invalid")):
            with self.subTest(language=language):
                result = self.client.post(f"/api/voice/transcribe?language={language}", content=body, headers={"Content-Type": "audio/wav"})
                self.assertEqual(result.status_code, 422)

    def test_compressed_audio_is_rejected(self):
        result = self.client.post("/api/voice/transcribe", content=b"compressed", headers={"Content-Type": "audio/webm"})
        self.assertEqual(result.status_code, 415)

    def test_audio_limits_and_silence(self):
        cases = ((wav_bytes(sample=0), "no_speech"), (wav_bytes(seconds=.1), "audio_duration"), (wav_bytes(seconds=30.1), "audio_duration"), (wav_bytes(channels=2), "unsupported_audio"), (wav_bytes(rate=44100), "unsupported_audio"))
        for data, code in cases:
            with self.subTest(code=code), self.assertRaises(HTTPException) as caught:
                validate_wav(data)
            self.assertEqual(caught.exception.detail["code"], code)

    def test_truncated_wav_is_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            validate_wav(wav_bytes()[:-200])
        self.assertEqual(caught.exception.detail["code"], "invalid_audio")

    def test_upload_limit(self):
        result = self.client.post("/api/voice/transcribe", content=b"x" * 1_100_001, headers={"Content-Type": "audio/wav"})
        self.assertEqual(result.status_code, 413)

    def test_whitespace_and_overlong_speech_text(self):
        for text in ("   ", "a" * 1601):
            self.assertEqual(self.client.post("/api/voice/synthesize", json={"text": text}).status_code, 422)

    def test_concurrent_inference_is_rejected(self):
        with patch.object(self.app.state.voice.lock, "locked", return_value=True):
            result = self.client.post("/api/voice/synthesize", json={"text": "Hello"})
        self.assertEqual(result.status_code, 429)

    def test_transcript_is_returned_and_temporary_audio_deleted(self):
        recorded_paths = []

        async def fake_run(command, request, stdin=None):
            recording = Path(command[command.index("-f") + 1])
            recorded_paths.append(recording)
            self.assertTrue(recording.is_file())
            output = Path(command[command.index("-of") + 1]).with_suffix(".json")
            output.write_text(json.dumps({"transcription": [{"text": "Tell me about my car."}], "result": {"language": "en"}}), encoding="utf-8")

        with patch.object(self.app.state.voice, "run", side_effect=fake_run):
            result = self.client.post("/api/voice/transcribe", content=wav_bytes(), headers={"Content-Type": "audio/wav"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["text"], "Tell me about my car.")
        self.assertFalse(recorded_paths[0].exists())

    def test_temporary_audio_deleted_after_engine_failure(self):
        recorded_paths = []

        async def fail(command, request, stdin=None):
            recorded_paths.append(Path(command[command.index("-f") + 1]))
            raise HTTPException(503, "Engine failed")

        with patch.object(self.app.state.voice, "run", side_effect=fail):
            result = self.client.post("/api/voice/transcribe", content=wav_bytes(), headers={"Content-Type": "audio/wav"})
        self.assertEqual(result.status_code, 503)
        self.assertFalse(recorded_paths[0].exists())


class ProcessLifetimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnected_request_terminates_worker(self):
        class Request:
            async def is_disconnected(self):
                return True

        engine = VoiceEngine(VoiceConfig(Path(sys.executable), Path("unused"), Path("unused")))
        with self.assertRaises(HTTPException) as caught:
            await engine.run([sys.executable, "-c", "import time; time.sleep(60)"], Request())
        self.assertEqual(caught.exception.status_code, 499)

    async def test_timeout_terminates_worker(self):
        class Request:
            async def is_disconnected(self):
                return False

        engine = VoiceEngine(VoiceConfig(Path(sys.executable), Path("unused"), Path("unused"), timeout=.05))
        with self.assertRaises(HTTPException) as caught:
            await engine.run([sys.executable, "-c", "import time; time.sleep(60)"], Request())
        self.assertEqual(caught.exception.status_code, 504)


if __name__ == "__main__":
    unittest.main()
