"""Exercise installed speech models locally using synthetic audio, not a microphone."""

import io
import time
import wave
import numpy as np

from fastapi.testclient import TestClient

from backend.app import create_app


def main():
    with TestClient(create_app()) as client:
        health = client.get("/api/voice/health").json()
        if not health["ready"]:
            raise SystemExit("Voice setup incomplete: " + ", ".join(health["missing"]))
        started = time.perf_counter()
        speech = client.post("/api/voice/synthesize", json={"text": "Tell me about my car."})
        speech.raise_for_status()
        with wave.open(io.BytesIO(speech.content), "rb") as audio:
            assert audio.getframerate() == 16000 and audio.getnchannels() == 1
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768
        samples = np.pad(samples, (0, (-len(samples)) % 2048 + 16000))
        samples = np.pad(samples, (0, (-len(samples)) % 2048))
        probabilities = []
        with client.websocket_connect("/api/voice/vad") as socket:
            assert socket.receive_json()["type"] == "ready"
            for offset in range(0, len(samples), 2048):
                socket.send_bytes(samples[offset:offset + 2048].astype("<f4").tobytes())
                probabilities.extend(socket.receive_json()["probabilities"])
        streak = longest = 0
        for probability in probabilities:
            streak = streak + 1 if probability >= .85 else 0
            longest = max(longest, streak)
        assert longest >= 7, "Synthetic speech did not meet the interruption threshold"
        assert max(probabilities[-10:]) < .35, "Silero did not detect the trailing silence"
        transcript = client.post("/api/voice/transcribe?language=en", content=speech.content, headers={"Content-Type": "audio/wav"})
        transcript.raise_for_status()
        text = transcript.json()["text"]
        assert "car" in text.lower(), f"Unexpected synthetic transcript: {text}"
        reply = client.post("/api/voice/synthesize", json={"text": "Your car profile is saved locally. No internet connection is needed."})
        reply.raise_for_status()
        assert reply.content[:4] == b"RIFF"
        print("PASS: Piper audio -> real Silero streaming detection -> Whisper transcript -> Piper reply")
        print("Silero peak speech probability:", round(max(probabilities), 3))
        print("Synthetic transcript:", text)
        print("Total local processing time:", round(time.perf_counter() - started, 2), "seconds")
        print("This is a synthetic engine check, not a real-microphone or road-noise accuracy benchmark.")


if __name__ == "__main__":
    main()
