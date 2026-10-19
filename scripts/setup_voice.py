"""Download pinned offline models and the Windows whisper.cpp CPU runtime.

No audio is sent anywhere. Downloads are needed once; inference is local.
Run with the project's Python virtual environment after installing requirements.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "voice-assets"
WHISPER_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1"
VOICE_REVISION = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"
WHISPER_URL = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip"
WHISPER_SHA = "b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732"
MODEL_SHA = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
VOICE_SHA = "a5a91abb7de0f104358a25aded480ddacf1ff0762886325886ec406a2e86aab3"
VAD_REVISION = "1e261b036686cd0017d500ee96acd1c4ba572a9d"
VAD_SHA = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"


def sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def download(url: str, destination: Path, expected: str | None = None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and (expected is None or sha256(destination) == expected):
        print(f"Already present: {destination.name}", flush=True)
        return
    partial = destination.with_suffix(destination.suffix + ".part")
    print(f"Downloading {destination.name}...", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "AutoAI-local-setup/0.2"})
    try:
        with urllib.request.urlopen(request, timeout=90) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        if expected and sha256(partial) != expected:
            raise RuntimeError(f"Checksum mismatch for {destination.name}; download was not installed.")
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def main() -> None:
    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise SystemExit("This setup downloads the Windows x64 runtime. Set AUTOAI_WHISPER_CLI to your platform's whisper-cli instead.")
    model = ASSETS / "models" / "ggml-base-q5_1.bin"
    voice = ASSETS / "voices" / "en_US-amy-low.onnx"
    vad = ASSETS / "vad" / "silero_vad.onnx"
    archive = ASSETS / "downloads" / "whisper-bin-x64-v1.8.2.zip"
    download(WHISPER_URL, archive, WHISPER_SHA)
    runtime = ASSETS / "whisper"
    runtime.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (runtime / member.filename).resolve()
            if not target.is_relative_to(runtime.resolve()):
                raise RuntimeError("Runtime archive contains an invalid path.")
        bundle.extractall(runtime)
    executables = sorted(runtime.rglob("whisper-cli.exe"))
    if not executables:
        raise RuntimeError("The official runtime archive did not include whisper-cli.exe.")
    download(f"https://huggingface.co/ggerganov/whisper.cpp/resolve/{WHISPER_REVISION}/ggml-base-q5_1.bin", model, MODEL_SHA)
    voice_base = f"https://huggingface.co/rhasspy/piper-voices/resolve/{VOICE_REVISION}/en/en_US/amy/low"
    download(f"{voice_base}/en_US-amy-low.onnx", voice, VOICE_SHA)
    download(f"{voice_base}/en_US-amy-low.onnx.json", voice.with_suffix(".onnx.json"))
    download(f"{voice_base}/MODEL_CARD", voice.parent / "MODEL_CARD-amy.md")
    vad_base = f"https://raw.githubusercontent.com/snakers4/silero-vad/{VAD_REVISION}"
    download(f"{vad_base}/src/silero_vad/data/silero_vad.onnx", vad, VAD_SHA)
    download(f"{vad_base}/LICENSE", vad.parent / "LICENSE-silero.txt")
    manifest = {
        "whisper_version": "v1.8.2",
        "whisper_cli": str(executables[0].relative_to(ROOT)),
        "model": str(model.relative_to(ROOT)),
        "voice": str(voice.relative_to(ROOT)),
        "vad": str(vad.relative_to(ROOT)),
        "sources": {"runtime": WHISPER_URL, "whisper_revision": WHISPER_REVISION, "voice_revision": VOICE_REVISION, "vad_revision": VAD_REVISION},
        "sha256": {"runtime_archive": sha256(archive), "model": sha256(model), "voice": sha256(voice), "vad": sha256(vad)},
    }
    (ASSETS / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Offline voice assets are ready. Run: npm.cmd run dev:all", flush=True)


if __name__ == "__main__":
    main()
