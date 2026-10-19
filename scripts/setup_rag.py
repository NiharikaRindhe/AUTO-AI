"""Install pinned, checksummed local RAG models and Windows CPU runtime."""
from pathlib import Path
import json
import platform
import sys
import zipfile
from scripts.setup_voice import download, sha256

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'rag-assets'
LLAMA_TAG = 'b11681'
LLAMA_SHA = '07006066db26ba20863785ec8fdd55028226c8eafcdb8db5a1484e98ebf01676'
EMBED_REV = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
EMBED_SHA = 'b941bf19f1f1283680f449fa6a7336bb5600bdcd5f84d10ddc5cd72218a0fd21'
TOKENIZER_SHA = 'be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037'
QWEN_REV = 'b5f37287796e5be0ea3dab2e7430873fb3f73e49'
QWEN_SHA = 'da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4'


def main():
    if sys.platform != 'win32' or platform.machine().lower() not in {'amd64', 'x86_64'}:
        raise SystemExit('This setup installs Windows x64 CPU assets. See readm.md for local path overrides.')
    archive = ASSETS / 'downloads' / f'llama-{LLAMA_TAG}-bin-win-cpu-x64.zip'
    download(f'https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}/{archive.name}', archive, LLAMA_SHA)
    runtime = ASSETS / 'llama'
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not (runtime / member.filename).resolve().is_relative_to(runtime.resolve()):
                raise RuntimeError('Invalid runtime archive path.')
        bundle.extractall(runtime)
    embed_base = f'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/{EMBED_REV}'
    download(f'{embed_base}/onnx/model_quint8_avx2.onnx', ASSETS / 'embedding/model.onnx', EMBED_SHA)
    download(f'{embed_base}/tokenizer.json', ASSETS / 'embedding/tokenizer.json', TOKENIZER_SHA)
    download(f'{embed_base}/README.md', ASSETS / 'embedding/MODEL_CARD.md')
    download(f'https://raw.githubusercontent.com/ggml-org/llama.cpp/{LLAMA_TAG}/LICENSE', runtime / 'LICENSE-llama.txt')
    qwen_base = f'https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/{QWEN_REV}'
    download(f'{qwen_base}/Qwen3-0.6B-Q4_0.gguf', ASSETS / 'models/Qwen3-0.6B-Q4_0.gguf', QWEN_SHA)
    download('https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/LICENSE', ASSETS / 'models/LICENSE-Qwen.txt')
    manifest = {'llama_version': LLAMA_TAG, 'embedding_revision': EMBED_REV, 'qwen_revision': QWEN_REV,
                'sha256': {'runtime': LLAMA_SHA, 'embedding': EMBED_SHA, 'qwen': QWEN_SHA,
                           'tokenizer': sha256(ASSETS / 'embedding/tokenizer.json')}}
    (ASSETS / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('Offline RAG assets installed. Restart npm.cmd run dev:all.', flush=True)


if __name__ == '__main__':
    main()
