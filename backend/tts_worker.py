"""Short-lived Piper worker; model memory is released after each reply."""

import argparse
import json
import os
from pathlib import Path
import sys
import wave

from piper import PiperVoice
from piper.config import PiperConfig
from piper.voice import ESPEAK_DATA_DIR
import onnxruntime

onnxruntime.disable_telemetry_events()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = json.loads(sys.stdin.read())
    text = payload["text"]
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1600:
        raise ValueError("Invalid speech text")
    # Piper's default session uses every CPU core. Bound threads for the 4 GB target.
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = max(1, min(4, int(os.environ.get("OMP_NUM_THREADS", "2"))))
    options.inter_op_num_threads = 1
    with open(args.voice + ".json", encoding="utf-8") as config_file:
        config = PiperConfig.from_dict(json.load(config_file))
    voice = PiperVoice(
        config=config,
        session=onnxruntime.InferenceSession(args.voice, sess_options=options, providers=["CPUExecutionProvider"]),
        espeak_data_dir=ESPEAK_DATA_DIR,
        download_dir=Path(args.voice).parent,
        use_tashkeel=False,
    )
    with wave.open(args.output, "wb") as output:
        voice.synthesize_wav(text, output)


if __name__ == "__main__":
    main()
