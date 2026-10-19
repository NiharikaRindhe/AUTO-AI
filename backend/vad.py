"""Streaming Silero ONNX inference, with independent state for each microphone.

The model consumes 512 new 16 kHz samples plus 64 samples of context.
No PyTorch, download-on-inference, audio storage, or speech transcription here.
"""

from pathlib import Path
import threading

import numpy as np
import onnxruntime as ort

ort.disable_telemetry_events()


class SileroStream:
    def __init__(self, session):
        self.session = session
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros((1, 64), dtype=np.float32)

    def process(self, data: bytes) -> list[float]:
        if not data or len(data) > 16384 or len(data) % (512 * 4):
            raise ValueError("Send 512 to 4096 mono float32 samples in multiples of 512.")
        samples = np.frombuffer(data, dtype="<f4")
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) > 1.01:
            raise ValueError("Microphone samples must be finite and between -1 and 1.")
        probabilities = []
        for offset in range(0, len(samples), 512):
            frame = samples[offset:offset + 512].reshape(1, 512)
            window = np.concatenate((self.context, frame), axis=1)
            output, self.state = self.session.run(None, {"input": window, "state": self.state, "sr": np.array(16000, dtype=np.int64)})
            self.context = frame[:, -64:].copy()
            probabilities.append(float(output[0][0]))
        return probabilities


class VadService:
    def __init__(self, path: Path):
        self.path = path
        self._session = None
        self._lock = threading.Lock()
        self.active_connections = 0

    def open_stream(self) -> SileroStream:
        with self._lock:
            if self._session is None:
                if not self.path.is_file():
                    raise FileNotFoundError("Silero model missing. Run npm run voice:setup.")
                options = ort.SessionOptions()
                options.intra_op_num_threads = 1
                options.inter_op_num_threads = 1
                self._session = ort.InferenceSession(str(self.path), sess_options=options, providers=["CPUExecutionProvider"])
        return SileroStream(self._session)
