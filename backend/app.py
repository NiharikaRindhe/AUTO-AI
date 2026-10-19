"""Loopback-only offline speech API. Run one worker to bound model memory."""

from __future__ import annotations

import asyncio
from array import array
from dataclasses import dataclass
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import wave

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from backend.vad import VadService
from backend.rag_api import install_rag
from backend.rag import RagConfig

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "voice-assets"
MAX_AUDIO_BYTES = 1_100_000
MAX_AUDIO_SECONDS = 30
ALLOWED_ORIGINS = {
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (5173, 4173, 8000)
}


@dataclass(frozen=True)
class VoiceConfig:
    cli: Path
    model: Path
    voice: Path
    threads: int = 2
    timeout: float = 120
    vad: Path | None = None

    @classmethod
    def discover(cls) -> "VoiceConfig":
        executables = sorted((ASSETS / "whisper").rglob("whisper-cli.exe"))
        fallback = shutil.which("whisper-cli") or str(ASSETS / "whisper" / "whisper-cli.exe")
        return cls(
            cli=Path(os.environ.get("AUTOAI_WHISPER_CLI", str(executables[0]) if executables else fallback)),
            model=Path(os.environ.get("AUTOAI_WHISPER_MODEL", str(ASSETS / "models" / "ggml-base-q5_1.bin"))),
            voice=Path(os.environ.get("AUTOAI_PIPER_VOICE", str(ASSETS / "voices" / "en_US-amy-low.onnx"))),
            threads=max(1, min(4, int(os.environ.get("AUTOAI_VOICE_THREADS", "2")))),
            vad=Path(os.environ.get("AUTOAI_SILERO_MODEL", str(ASSETS / "vad" / "silero_vad.onnx"))),
        )


def problem(code: str, message: str, status: int = 422) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def validate_wav(data: bytes) -> float:
    """Accept a bounded, non-silent PCM16 mono 16 kHz utterance only."""
    if len(data) > MAX_AUDIO_BYTES:
        raise problem("audio_too_large", "Record an utterance shorter than 30 seconds.", 413)
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, "NONE"):
                raise problem("unsupported_audio", "Audio must be mono PCM16 WAV at 16 kHz.")
            frames = audio.getnframes()
            duration = frames / 16000
            if not 0.25 <= duration <= MAX_AUDIO_SECONDS:
                raise problem("audio_duration", "Speak for between 0.25 and 30 seconds.")
            raw = audio.readframes(frames)
            if len(raw) != frames * 2:
                raise problem("invalid_audio", "The recording was incomplete. Please try again.")
    except (wave.Error, EOFError, ValueError) as exc:
        raise problem("invalid_audio", "Could not read the recording as WAV audio.") from exc
    samples = array("h", raw)
    if sys.byteorder != "little":
        samples.byteswap()
    rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples)) / 32768
    if rms < 0.002:
        raise problem("no_speech", "I could not hear speech. Move closer to the microphone and try again.")
    return duration


class SynthesisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1600)


class VoiceEngine:
    def __init__(self, config: VoiceConfig):
        self.config = config
        self.lock = asyncio.Lock()

    def status(self) -> dict:
        missing = []
        for label, path in (("whisper.cpp runtime", self.config.cli), ("Whisper model", self.config.model), ("Piper voice", self.config.voice), ("Piper voice configuration", Path(str(self.config.voice) + ".json"))):
            if not path.is_file():
                missing.append(label)
        if importlib.util.find_spec("piper") is None:
            missing.append("piper-tts Python package")
        return {"ready": not missing, "missing": missing, "busy": self.lock.locked(), "stt": "whisper.cpp / base Q5_1", "tts": "Piper / English", "input_languages": ["en", "hi", "auto"], "output_language": "en", "max_seconds": MAX_AUDIO_SECONDS, "local_only": True, "vad": {"ready": bool(self.config.vad and self.config.vad.is_file()), "engine": "Silero VAD / ONNX CPU", "frame_samples": 512, "sample_rate": 16000}}

    def require_ready(self) -> None:
        missing = self.status()["missing"]
        if missing:
            raise problem("setup_required", "Missing " + ", ".join(missing) + ". Run the offline voice setup.", 503)

    async def run(self, command: list[str], request: Request, stdin: bytes | None = None) -> bytes:
        """Bound subprocess lifetime, including browser cancellation/disconnect."""
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "OMP_NUM_THREADS": str(self.config.threads)}
        try:
            process = await asyncio.create_subprocess_exec(
                *command, cwd=str(ROOT), env=env,
                stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
        except (OSError, NotImplementedError) as exc:
            raise problem("engine_start_failed", "Could not start the local speech engine. Check its runtime and dependencies.", 503) from exc
        communication = asyncio.create_task(process.communicate(stdin))
        deadline = time.monotonic() + self.config.timeout
        try:
            while not communication.done():
                await asyncio.wait({communication}, timeout=0.2)
                if await request.is_disconnected():
                    raise problem("cancelled", "Voice request cancelled.", 499)
                if time.monotonic() > deadline:
                    raise problem("engine_timeout", "Speech processing took too long. Try a shorter recording.", 504)
            stdout, stderr = await communication
            if process.returncode:
                # Engine diagnostics can contain spoken text: do not log them.
                raise problem("engine_failed", "The local speech engine failed. Check the installed models and Windows runtime.", 503)
            return stdout
        finally:
            if process.returncode is None:
                process.kill()
            await communication

    async def transcribe(self, data: bytes, language: str, request: Request) -> dict:
        self.require_ready()
        duration = validate_wav(data)
        if self.lock.locked():
            raise problem("busy", "The voice engine is busy. Try again in a moment.", 429)
        started = time.perf_counter()
        async with self.lock:
            with tempfile.TemporaryDirectory(prefix="autoai-voice-") as folder:
                path = Path(folder)
                recording = path / "utterance.wav"
                recording.write_bytes(data)
                prefix = path / "transcript"
                await self.run([str(self.config.cli), "-m", str(self.config.model), "-f", str(recording), "-l", language, "-t", str(self.config.threads), "-ng", "-oj", "-of", str(prefix), "-nt", "-np"], request)
                try:
                    result = json.loads(prefix.with_suffix(".json").read_text(encoding="utf-8"))
                    segments = result.get("transcription", [])
                    text = " ".join(str(segment.get("text", "")).strip() for segment in segments).strip()
                    detected_language = result.get("result", {}).get("language", language)
                except (OSError, ValueError, TypeError) as exc:
                    raise problem("invalid_transcript", "The recogniser did not return a usable transcript.", 503) from exc
        if not text or text.strip(" .[]()").lower() in {"blank_audio", "silence", "music", "no speech"}:
            raise problem("no_speech", "I could not recognise speech. Please try again.")
        return {"text": text, "language": detected_language, "audio_seconds": round(duration, 2), "processing_ms": round((time.perf_counter() - started) * 1000)}

    async def synthesize(self, text: str, request: Request) -> bytes:
        self.require_ready()
        text = text.strip()
        if not text:
            raise problem("empty_text", "There is no reply to speak.")
        if self.lock.locked():
            raise problem("busy", "The voice engine is busy. Try again in a moment.", 429)
        async with self.lock:
            with tempfile.TemporaryDirectory(prefix="autoai-speech-") as folder:
                output = Path(folder) / "reply.wav"
                await self.run([sys.executable, "-m", "backend.tts_worker", "--voice", str(self.config.voice), "--output", str(output)], request, json.dumps({"text": text}, ensure_ascii=False).encode("utf-8"))
                if not output.is_file():
                    raise problem("missing_speech", "The speech engine did not produce audio.", 503)
                return output.read_bytes()


def create_app(config: VoiceConfig | None = None, rag_config: RagConfig | None = None) -> FastAPI:
    engine = VoiceEngine(config or VoiceConfig.discover())
    app = FastAPI(title="AutoAI local voice", docs_url=None, redoc_url=None)
    app.state.voice = engine
    vad = VadService(engine.config.vad or ASSETS / "vad" / "silero_vad.onnx")
    app.state.vad = vad
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])
    app.add_middleware(CORSMiddleware, allow_origins=sorted(ALLOWED_ORIGINS), allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type"], expose_headers=["X-Processing-Ms"])

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return Response("This API accepts only the local AutoAI interface.", status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/voice/health")
    async def health():
        return engine.status()

    @app.websocket("/api/voice/vad")
    async def vad_stream(socket: WebSocket):
        origin = socket.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            await socket.close(code=1008)
            return
        if vad.active_connections >= 2:
            await socket.close(code=1013)
            return
        vad.active_connections += 1
        try:
            await socket.accept()
            stream = await asyncio.to_thread(vad.open_stream)
            await socket.send_json({"type": "ready", "engine": "Silero VAD", "sample_rate": 16000, "frame_samples": 512})
            sequence = 0
            while True:
                message = await asyncio.wait_for(socket.receive(), timeout=60)
                if message["type"] == "websocket.disconnect":
                    break
                data = message.get("bytes")
                if data is None:
                    raise ValueError("The speech detector expects binary PCM audio.")
                probabilities = await asyncio.to_thread(stream.process, data)
                await socket.send_json({"type": "vad", "sequence": sequence, "probabilities": probabilities})
                sequence += 1
        except WebSocketDisconnect:
            pass
        except (ValueError, FileNotFoundError) as error:
            await socket.send_json({"type": "error", "message": str(error)})
            await socket.close(code=1003)
        except TimeoutError:
            await socket.close(code=1001)
        except Exception:
            # Do not log microphone bytes or expose filesystem details.
            try:
                await socket.send_json({"type": "error", "message": "The local speech detector failed. Check voice setup."})
                await socket.close(code=1011)
            except (RuntimeError, WebSocketDisconnect):
                pass
        finally:
            vad.active_connections -= 1

    @app.post("/api/voice/transcribe")
    async def transcribe(request: Request, language: str = Query(default="en", pattern="^(en|hi|auto)$")):
        if request.headers.get("content-type", "").split(";")[0] not in {"audio/wav", "audio/x-wav", "application/octet-stream"}:
            raise problem("unsupported_audio", "Send a PCM WAV recording.", 415)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_AUDIO_BYTES:
                raise problem("audio_too_large", "Record an utterance shorter than 30 seconds.", 413)
        return await engine.transcribe(bytes(body), language, request)

    @app.post("/api/voice/synthesize")
    async def synthesize(payload: SynthesisRequest, request: Request):
        started = time.perf_counter()
        data = await engine.synthesize(payload.text, request)
        return Response(data, media_type="audio/wav", headers={"X-Processing-Ms": str(round((time.perf_counter() - started) * 1000))})

    install_rag(app, engine, rag_config)
    return app


app = create_app()
