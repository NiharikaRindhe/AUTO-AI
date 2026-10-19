# Offline Car Voice Assistant

## Web interface prototype

The local React web interface is implemented in `src/App.jsx` and `src/styles.css`. It includes responsive Overview, Assistant, My vehicle, Knowledge, Music, Maintenance, and Settings screens.

## Implemented multi-car RAG engine

Car questions follow the selected answer mode. Text and voice use the same routing.

### Choose an answer mode

The **Answer mode** selector is available in Overview, Assistant, Knowledge, and Settings:

| Mode | Answer behavior | Required data |
|---|---|---|
| **RAG + LLM** | Search the selected car's manuals with MiniLM/SQLite and generate an explanation with local Qwen. Show cited passages or a labeled excerpt fallback. | Imported manuals and installed RAG models |
| **Saved car data (no AI)** | Return a prewritten answer exactly as entered. Match the saved question or explicitly entered alternative questions. No document retrieval, embeddings, or LLM call. | Saved car answers in SQLite; no RAG model assets required |

The selection persists in this browser. Existing installations default to RAG + LLM. Switching modes cancels an in-flight answer and ends the current voice session; start the microphone again to continue in the new mode. Earlier chat responses retain their original mode/source labels. Music commands, phone capability messages, profile lookup, and personal maintenance-record responses remain deterministic in both modes.

To feed the hardcoded option, select a car in **Knowledge → Saved car answers → Add an answer**. Enter the question, prewritten answer, source reference, and optional alternative phrasings (one per line). You can edit and remove entries. Questions ignore case, punctuation, and extra spaces, but preserve word order, numbers, and negation. Unknown phrasings return **No saved answer**; they never trigger an automatic switch to RAG or use another car's records. Add aliases for likely voice transcriptions. Up to 1,000 answers per car and 20 aliases per answer are supported.

These records are manually entered, not automatically verified. No real-car specifications are invented or preloaded. Use trusted information for the exact year, variant, and market. The selector affects the answer engine; Whisper, Silero, and Piper remain the separate voice pipeline. If MiniLM was already loaded through RAG or indexing, its session can remain resident until backend restart; selecting Saved car data prevents new retrieval/generation work but does not claim to unload every AI dependency.

No answer data is deleted when switching modes. Saved entries are included in the selected-car export and cascade when that car is explicitly removed. The database schema update adds tables without replacing existing car/document records. Restart `npm.cmd run dev:all` after updating to load the new backend routes.

Answer-mode update validation: **58 backend tests and 19 frontend tests passed**, plus the production build. Tests cover no-model saved answers, car isolation, explicit aliases and negation, editing/deletion, existing-database migration, strict mode routing, cancellation signal forwarding, and restoration of the saved mode in rendered controls. No browser was connected for interactive/visual QA in this update.

With **RAG + LLM** selected, car questions use this pipeline:

```text
Choose exact car configuration
  -> import its PDF / TXT / Markdown manual
  -> extract text with page references and overlapping chunks
  -> MiniLM INT8 embeddings + SQLite FTS5 index
  -> filter strictly by selected car ID
  -> combine BM25 and cosine search using reciprocal rank fusion
  -> supply up to three retrieved passages to local Qwen
  -> validate answer structure, citation IDs, and numeric support
  -> show an answer with expandable source passages
  -> Piper speaks it for voice conversations
```

### Use the car library

The RAG assets and dependencies are installed in this workspace. Stop the existing development launcher with **Ctrl+C**, then restart:

```powershell
npm.cmd run dev:all
```

1. Open **Knowledge** and add a car using its make, model, year, exact variant/engine/transmission, and market. Each configuration gets a separate ID; similar models do not share sources automatically.
2. Select that car and use **Import manual** to add PDF, TXT, or Markdown files. The importer accepts multiple files, checks duplicates, and indexes each document locally.
3. Ask a question in **Assistant**, by typing or starting a voice conversation. Answers show the selected configuration and expandable citations. PDF citations include the original page number.
4. Use **Switch / add car** or the page's car selector to change cars. Switching cancels pending answers and ends the current microphone session. Personal mileage/profile settings and newly added service notes stay associated with their selected car.
5. Use **Read source** to inspect indexed passages. Removing a document deletes its text, vectors, and full-text index entries. Removing a car deletes all its indexed documents, after a confirmation in the interface.

Previously imported browser documents are retained as **Previously saved browser documents**. They do not enter RAG answers until you explicitly assign and index them for a selected car. Earlier service notes remain with the original unassigned profile; they are not copied to every new car. Use **Use my original personal profile** in the car selector to return to that profile and its notes.

### Technologies and setup

| Component | Installed implementation |
|---|---|
| API | FastAPI on loopback, with existing local-origin restrictions |
| PDF/text ingestion | pypdf; UTF-8 TXT/Markdown; page-aware overlapping chunks, up to 120 words / about 700 characters |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2`, quantized INT8 ONNX CPU, 384 dimensions; masked mean pooling and normalization |
| Tokenization | Hugging Face `tokenizers`, loaded only from the local tokenizer JSON |
| Storage/retrieval | SQLite with FTS5/BM25, stored float32 vectors, cosine similarity, reciprocal rank fusion |
| Local generation | `ggml-org/Qwen3-0.6B-GGUF`, Q4_0, using pinned llama.cpp `b11681` Windows CPU `llama-completion` |
| Answer display | React source cards, page/passage references, generated/excerpt/insufficient-evidence labels |

For a fresh checkout or another Windows x64 machine, install the existing voice stack and then:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd run rag:setup
npm.cmd run dev:all
```

The one-time RAG setup downloads approximately **472 MB** of models and runtime files. Repository revisions and the runtime tag are pinned; runtime, ONNX, and GGUF binaries have SHA-256 checks. Models, tokenizer, manifest, model card, and Qwen license are under ignored `rag-assets/`. Setup can be repeated to verify or repair model binaries. After setup, imports, retrieval, generation, and spoken answers need no internet. There is no cloud fallback or automatic inference-time download.

Sources: [MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html), [Qwen GGUF model repository](https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF), [pinned llama.cpp release](https://github.com/ggml-org/llama.cpp/releases/tag/b11681).

### Storage, limits, and reliability

- Indexed text, metadata, and vectors persist in `local-data/knowledge.sqlite3`. Original uploaded PDFs/files are not retained by the backend. Browser profiles, personal notes, and old unassigned text files remain in local storage. Neither store is encrypted by this prototype.
- Uploads: **8 MB**, at most **600 PDF pages**, **1 million extracted characters**, and **2,000 chunks per document**. The library supports up to **100 configurations** and **10,000 chunks per car**. Scanned PDFs require external OCR; password-protected PDFs are rejected.
- Documents are assigned manually. The system does not verify a manual's manufacturer, authenticity, model year, or variant. Confirm those details before importing.
- The generator has a **2,048-token context**, up to **256 output tokens**, CPU threads bounded by the voice engine setting, and a timeout. It runs in a short-lived process. Whisper, Qwen, Piper, and indexing share a processing lock; the small embedding/VAD sessions stay resident. This bounds concurrent model use, but **whole-device performance within 4 GB RAM has not been benchmarked**.
- Insufficient retrieval returns an explicit request for more evidence. If generation is unavailable, times out, returns malformed data, cites missing passages, or introduces unsupported numbers, the response is labeled **Retrieved excerpts**. This fallback does not claim to be a generated explanation.
- Citation and number checks do not prove that every statement follows from a manual. The small model can still make mistakes. Use the displayed evidence to review answers; complex diagnosis is not established.
- The current embedding model and answer instructions target **English**. Hindi recognition remains available in the voice stack, but Hindi/mixed-language RAG accuracy has not been validated.
- **Export records** in Settings includes browser records, the car catalog, and the **selected car's indexed passages**. It does not include original PDFs or every car's document text. For a full library backup, stop the backend and copy the `local-data` directory. Resetting browser records does not erase the SQLite library.

### RAG API

| Endpoint | Purpose |
|---|---|
| `GET /api/rag/health` | Model availability, engine names, counts, and upload limit |
| `GET /api/rag/cars` / `POST /api/rag/cars` | List or add exact car configurations |
| `DELETE /api/rag/cars/{car_id}` | Remove a car and its indexed sources |
| `GET /api/rag/cars/{car_id}/documents` | List that car's sources |
| `POST /api/rag/cars/{car_id}/documents?name=manual.pdf` | Raw file bytes; PDF, TXT, or Markdown |
| `GET /api/rag/cars/{car_id}/documents/{doc_id}` | Read indexed source passages |
| `DELETE /api/rag/cars/{car_id}/documents/{doc_id}` | Remove a source and its search entries |
| `GET /api/rag/cars/{car_id}/export` | Export that car's metadata and indexed passages |
| `GET` / `POST /api/rag/cars/{car_id}/answers` | List or add prewritten answers; fields: `question`, `answer`, `source`, `aliases` |
| `PUT` / `DELETE /api/rag/cars/{car_id}/answers/{answer_id}` | Edit or remove that car's saved answer |
| `POST /api/rag/query` | JSON `{ "car_id": "...", "question": "...", "answer_mode": "rag", "generate": true }`; choose `"answer_mode": "saved"` to bypass retrieval and generation. `generate` is ignored in saved mode. |

Questions are limited to 600 characters. Car and document IDs are parameterized SQL values; query terms are escaped for FTS. The UI passes cancellation through to generation, and a browser disconnect terminates its subprocess. The backend does not log questions or model replies. Only selected local sources enter the prompt; documents are treated as untrusted input, never as authorized actions.

Optional local overrides: `AUTOAI_RAG_DB`, `AUTOAI_EMBEDDING_MODEL`, `AUTOAI_EMBEDDING_TOKENIZER`, `AUTOAI_LLAMA_CLI`, and `AUTOAI_LLM_MODEL`. The tokenizer and encoder must match the installed embedding version; changing the encoder requires a new embedding ID and reimport. `AUTOAI_BACKEND_URL` controls the Vite proxy target for separately managed local services.

### RAG verification

```powershell
npm.cmd run test:voice
npm.cmd run test:frontend
.\.venv\Scripts\python.exe -m scripts.check_rag
npm.cmd run build
```

The installed-model check uses a temporary database and fictional cars. It verifies real MiniLM retrieval, different generated answers for the same question against two separate cars, valid citations, and refusal of an unrelated question. It does not measure real-car accuracy or prove road-ready reliability.

Verified in this workspace: **44 backend tests and 16 frontend tests**, production build, installed-model two-car RAG check, and synthetic speech -> Whisper -> selected-car RAG -> Piper. Browser QA verified car selection, the Knowledge screen, and a generated answer with a source citation. Real microphone/car-noise testing and 4 GB device benchmarking remain outstanding.

## Implemented voice-to-voice pipeline

```text
Browser microphone
  -> AudioWorklet PCM capture
  -> local Silero VAD over WebSocket (speech detection and turn boundaries)
  -> 16 kHz mono PCM16 WAV
  -> loopback FastAPI backend
  -> whisper.cpp multilingual base Q5_1 transcription
  -> shared local command handler / selected-car RAG engine
  -> Piper English speech synthesis
  -> browser speaker playback
```

### Start the installed application

```powershell
npm.cmd run dev:all
```

Open `http://127.0.0.1:5173/`, choose **Assistant**, and check that it says **Silero + Whisper + Piper connected**. Click **Start conversation**, allow microphone access when your browser asks, and speak. Pause for approximately 0.8 seconds or click **Finish & reply**. The transcript and response appear in the conversation, followed by a spoken reply. The microphone stays active for your next turn. Speaking during a reply stops playback and starts a new turn. Choose **End conversation** to release the microphone.

If a development server was already running before this update, stop it with **Ctrl+C** and restart `npm.cmd run dev:all` to load the new backend and WebSocket proxy.

Try **“Hello”**, **“Tell me about my car”**, **“When is my next service?”**, or **“Pause music”**. Music playback requires choosing your own local files first. You can also click **Read aloud** on a text reply. English is the default recognition language; Hindi and automatic detection can be selected. Spoken replies are English only.

### First-time setup on another Windows x64 computer

Python 3.10 or later and a Node version compatible with Vite 7 are required. This workspace was verified using Python 3.13 and Node 22.

```powershell
npm.cmd install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd run voice:setup
npm.cmd run dev:all
```

Setup downloads approximately 130 MB of runtime and model assets, in addition to Python dependencies. It pins whisper.cpp **v1.8.2** (an official Windows CPU binary), multilingual **base Q5_1**, the **en_US-amy-low** Piper voice, and **Silero VAD** (approximately 2.3 MB). The runtime archive and all three model binaries are checked against SHA-256 values; model sources use pinned repository revisions. The setup is repeatable and skips already verified downloads. Silero uses the existing ONNX Runtime CPU dependency without PyTorch; its upstream MIT license is saved with the model.

All assets are under the ignored `voice-assets/` directory. `voice-assets/manifest.json` records versions, sources, local paths, and checksums. The voice's upstream model card is saved beside it; engine and voice/data licensing remain separate, and the selected voice's distribution rights require review before shipping a product.

After setup, neither the backend nor the voice UI needs internet for a turn. The implementation does not use browser cloud speech recognition, online TTS, API keys, or a cloud fallback. Piper's optional Arabic model downloader is disabled.

### Controls and boundaries

- User-started continuous conversation with **Silero VAD**. It detects speech and silence, keeps a short pre-roll to preserve first words, and submits each turn after a pause. Wake words are not integrated.
- Each microphone turn is limited to 28 seconds; the backend accepts no more than 30 seconds of mono PCM16 / 16 kHz audio.
- The microphone remains active during replies. Sustained detected speech interrupts playback or cancels pending processing. **Stop reply** leaves listening active; **End conversation** cancels processing and releases the microphone.
- Animated listening, thinking, and speaking states show progress. The microphone waveform and VAD probability show live input; the speaking animation is decorative rather than an audio spectrum.
- Recorded audio and generated reply audio can be replayed locally. If autoplay is blocked, use the reply's play control.
- Recognition and synthesis run sequentially in short-lived processes, releasing model memory between stages. Both engines use bounded CPU threads. Whole-device 4 GB RAM performance has not yet been benchmarked.
- No new command automatically places calls or sends messages. Music actions use only the selected local playlist.
- Explicit music commands, personal profile lookup, and service-record questions use deterministic handlers. Other car questions use the selected-car RAG engine described above. Hindi recognition is selectable, but mixed-language recognition and multilingual RAG have not been validated.
- Browser echo cancellation, noise suppression, and automatic gain control are requested. Interruption detection uses a stricter speech threshold while replies play. VAD cannot identify who is speaking, so speaker echo can still cause false interruptions. Start testing with headphones. Car noise, quiet speech, real microphone devices, and Hindi recognition require on-device testing.

### Backend and API

The backend binds to `127.0.0.1:8000` with one worker. Vite proxies `/api/voice` for development and production preview.

| Endpoint | Request / response |
|---|---|
| `GET /api/voice/health` | Reports runtime/model availability, busy status, languages, and limits. |
| `WS /api/voice/vad` | Streams 16 kHz mono float32 PCM to local Silero; returns speech probabilities for 512-sample frames. Binary messages accept 512 to 4,096 samples in multiples of 512. |
| `POST /api/voice/transcribe?language=en` | Raw `audio/wav` request -> transcript JSON. Languages: `en`, `hi`, `auto`. |
| `POST /api/voice/synthesize` | JSON `{ "text": "Hello" }` -> PCM WAV reply. Text limit: 1,600 characters. |

Missing setup, invalid or silent audio, oversized uploads, busy engines, and timeouts produce explicit errors. Browser cancellation/disconnection terminates active inference. Temporary audio is removed after success and failure. VAD uses separate recurrent state per connection, accepts at most two concurrent connections, and does not store streamed audio. The backend does not log spoken text or retain transcripts. Local-origin checks and trusted-host checks restrict browser access to the local interface.

For separately managed processes:

```powershell
npm.cmd run voice:server
# In another terminal:
npm.cmd run dev
```

Optional trusted local overrides: `AUTOAI_WHISPER_CLI`, `AUTOAI_WHISPER_MODEL`, `AUTOAI_PIPER_VOICE`, and `AUTOAI_VOICE_THREADS` (1–4, default 2). Keep a matching Piper `.onnx.json` beside the voice model.

### Validation commands

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
npm.cmd run test:voice
npm.cmd run test:frontend
.\.venv\Scripts\python.exe -m scripts.check_voice
npm.cmd run build
```

The installed-engine check streams synthetic Piper speech through Silero, verifies sustained speech detection and the silence tail, transcribes it with Whisper, and generates a reply. It does not establish real microphone or road-noise accuracy. Tests cover speech boundaries, pre-roll, interruption thresholds, microphone cleanup, VAD state isolation, WebSocket validation, audio encoding, command/source handling, cancellation, timeouts, request limits, and temporary-file cleanup.

Verified for this update: 21 backend tests, 12 frontend/audio tests, the production build, and an installed Piper -> Silero -> Whisper -> Piper check. Real microphone capture, speaker echo cancellation, and road-noise accuracy still require testing on the intended device. Whole-device operation within 4 GB RAM has not been benchmarked.

### Troubleshooting

- **Backend not running:** use `npm.cmd run dev:all`, rather than the frontend-only `npm.cmd run dev`.
- **Port already in use:** stop your previous AutoAI development server before starting the combined launcher. It does not terminate unrelated processes automatically.
- **Models missing:** run `npm.cmd run voice:setup`; initial downloads require internet.
- **Microphone denied:** grant access yourself using the browser's site controls. Text input remains available.
- **No clear speech:** try closer to the microphone or finish manually with the button. Silero thresholds and pause duration may need tuning against representative car recordings.
- **Reply interrupts itself:** use headphones or lower speaker volume while testing; echo cancellation depends on the browser and microphone/speaker arrangement.
- **Autoplay blocked:** use the play button under **Spoken reply**.
- **English/Hindi mix or names misrecognised:** select the input language explicitly. Recognition accuracy needs representative recordings; no percentage is claimed.
- **Slow first turn:** both models load from disk on demand to avoid keeping their memory resident together. An SSD and a capable CPU help; increasing threads is optional and capped at four.

Implementation files: `backend/app.py`, `backend/tts_worker.py`, `src/voice/`, `public/pcm-worklet.js`, `src/assistant.js`, and `scripts/`.

### Run on Windows

Dependencies have been installed in this workspace. From the project folder, run:

```powershell
npm.cmd run dev:all
```

Open `http://127.0.0.1:5173/` in your browser. For a fresh checkout, follow the voice setup instructions below. `npm.cmd run dev` still starts only the frontend. Initial dependency installation needs internet access; the bundled interface uses local assets and does not need a cloud service to run.

Create and preview a production build with:

```powershell
npm.cmd run build
npm.cmd run preview
```

The production preview opens at `http://127.0.0.1:4173/`. Microphone recording requires permission and a supported browser on localhost or HTTPS.

### Implemented local interactions

- Edit and save a vehicle profile. Initial car details are explicitly marked as a sample profile.
- Ask typed questions using the selected car's local hybrid retrieval and Qwen generation, with expandable sources.
- Import and read PDF, TXT, or Markdown sources up to 8 MB each, assigned to exact car configurations; remove documents or car collections.
- Start a conversation, detect turns locally with Silero, transcribe with whisper.cpp, and hear Piper replies. Interrupt a reply by speaking, or replay your recording and the spoken reply.
- Choose local audio files, play/pause, skip tracks, seek, and change volume. Playlists last for the session.
- Add dated maintenance records with mileage and notes.
- Export or reset saved records.

Profiles and maintenance records use browser local storage; the indexed document library persists in local SQLite. They are not encrypted by the prototype. Recordings and music-file references stay in session memory. Voice recordings are posted only to the loopback backend on this computer, processed locally, and removed from its temporary directory after each request. No cloud speech or AI service is used.

### Integrations still to implement

Offline speech recognition, speech output, multi-car RAG/LLM generation, and text-PDF extraction are implemented through the local backend. Phone actions, live vehicle diagnostics, scanned-PDF OCR, and automatic service scheduling remain unimplemented. No calls or messages are sent. Retrieved evidence and generated summaries are not verified diagnoses.

The existing technology recommendations below describe the planned assistant engines and future deployment, not already-connected functionality in this UI.

---

An offline voice assistant that knows the owner's particular car and supports voice commands, local entertainment, maintenance records, and car-specific guidance.

The recommended starting stack is **whisper.cpp + a rule-based command handler + SQLite + Piper**, with **llama.cpp and a small Qwen model** for optional explanations.

## Design assumptions

- Development environment: **Windows**, using native Windows tools for the first prototype.
- Proposed deployment target: a dedicated device with **4 GB RAM**, running lightweight, 64-bit Linux. The final hardware and operating system remain to be selected.
- Initial languages: **English and Hindi**, subject to testing.
- Lower-memory devices use reduced feature profiles rather than the same full stack.
- Speech models, voices, manuals, and maps are installed before offline operation.
- Actual responsiveness depends on the processor, microphone setup, and software configuration, not RAM alone.
- This document describes a proposed architecture. Hardware performance and accuracy have not yet been measured.

## Recommended open-source stack

| Component | Selected technology | Purpose and reason |
|---|---|---|
| Operating system | Windows for development; minimal Debian Linux, 64-bit, proposed for deployment | Develop on the available PC and validate resource consumption on the eventual device. |
| Main application | C++, with Python for early prototyping | Integrate native speech engines and keep deployment resource use predictable. |
| Microphone processing | WebRTC Audio Processing Module | Echo cancellation, noise suppression, and automatic gain control. |
| Voice activity detection | Silero VAD through ONNX Runtime | Detect speech before running the heavier recognition model. |
| Wake word | sherpa-onnx keyword spotting | Detect a supported English wake phrase locally. |
| Speech recognition | whisper.cpp with multilingual Whisper small, quantised to Q5 | Recognise commands, dictated messages, and car questions offline. |
| Command execution | Custom intent rules and state machine | Handle actions, ambiguity, confirmations, cancellation, and failures predictably. |
| Car information and records | SQLite with FTS5 search | Store and search the car manual, specifications, reminders, and service history locally. |
| Optional conversational explanations | llama.cpp with Qwen3-1.7B Q4_K_M | Explain retrieved, verified information using a compact local model. |
| Spoken replies | Piper for English; eSpeak NG for initial Hindi support | Generate speech locally. eSpeak NG is a lightweight but less natural fallback. |
| Local music playback | GStreamer | Handle playback, playlists, pause, seek, and volume. |

## Development on Windows

The first prototype can run natively on Windows. A Linux installation, dual boot, Docker, and WSL are not required for this stage.

| Development task | Windows approach |
|---|---|
| Editor | VS Code or another preferred editor. |
| Prototype application | Python in a project-local virtual environment. |
| Microphone capture and speech playback | Browser AudioWorklet / Web Audio, PCM WAV capture, and local reply playback. |
| Speech recognition | Native whisper.cpp Windows executable, called from Python initially. |
| Commands and car records | Shared JavaScript intent handler; personal profiles/notes in browser storage; multi-car manual text and vectors in SQLite. |
| Speech synthesis | Piper's Windows package and a separately downloaded, appropriately licensed voice. |
| Optional explanations | Native llama.cpp Windows executable with the selected GGUF model. |
| Building C++ components | Visual Studio Build Tools with Desktop development with C++ and CMake; matching prebuilt binaries can avoid an initial source build. |

Start with push-to-talk and this complete local loop:

```text
Microphone -> whisper.cpp -> command handler / SQLite -> Piper -> speaker
```

After that works, add wake-word detection, optional explanations, music control, audio processing, and phone integration incrementally. Keep microphone, playback, Bluetooth, and vehicle adapters behind separate interfaces so their implementations can change between Windows and the deployment device.

Initial Windows command examples, run from the project directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
```

These commands only create an isolated Python environment; they do not install the full assistant or download models. Package compatibility and native runtime dependencies must be checked when setting up the actual prototype.

Developing on Windows does not establish that the final application fits a **4 GB whole-device RAM budget**. Windows itself consumes part of the PC's RAM. Measure application memory during development, then verify total memory and latency on the intended deployment hardware. If the development PC itself has only 4 GB, start with Whisper base and omit the language model.

Sources: [whisper.cpp Windows support](https://github.com/ggml-org/whisper.cpp), [llama.cpp Windows build instructions](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md), [Piper Windows distribution](https://pypi.org/project/piper-tts/), [sounddevice installation](https://python-sounddevice.readthedocs.io/en/latest/installation.html).

## Speech recognition selection

Start the 4 GB version with **Whisper small Q5** through whisper.cpp. If recognition is too slow on the selected processor, evaluate **Whisper base Q5** and measure the accuracy trade-off.

Use the multilingual model without the `.en` suffix for Hindi support. Multilingual support alone does not establish accuracy for mixed Hindi-English speech or Indian contact names.

The whisper.cpp project publishes these approximate memory figures for its reference models:

| Model | Published approximate memory |
|---|---:|
| Whisper tiny | 273 MB |
| Whisper base | 388 MB |
| Whisper small | 852 MB |

Quantisation can reduce memory further. Actual usage depends on the build, settings, and processing workload; the figures above are not measurements of the proposed application.

Source: [whisper.cpp documentation](https://github.com/ggml-org/whisper.cpp).

## Separate commands from explanations

Essential commands should run through the command handler without depending on the language model.

| User request | Execution path |
|---|---|
| "Pause music." | Recognised intent -> media player. |
| "Call Rahul." | Contact lookup -> resolve ambiguity -> phone integration. |
| "When is my next service?" | Saved maintenance schedule and mileage -> calculated answer. |
| "Explain this warning." | Retrieve verified car information -> optional AI explanation -> spoken reply. |

This keeps essential functions available when the language model is unloaded.

For the explanation model:

- Use **Qwen3-1.7B Q4_K_M** with **llama.cpp**.
- Start with a **2,048-token context**.
- Disable thinking mode to limit computation.
- Keep responses short and retrieve only relevant manual sections.
- Use stored values directly for exact specifications and maintenance calculations.
- Ask for clarification or report missing information when the available material is insufficient.
- Do not use generated text as an authoritative diagnosis or allow it to execute arbitrary commands.

The selected quantised model file is approximately **1.28 GB on disk**. This is **not its total runtime RAM requirement**; inference also uses context caches and working buffers.

Sources: [quantised model](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF), [Qwen model and configuration](https://huggingface.co/Qwen/Qwen3-1.7B), [llama.cpp](https://github.com/ggml-org/llama.cpp).

## Custom car knowledge pack

Supply the appropriate local information during installation:

- Exact make, model, year, variant, engine, transmission, and market.
- Matching owner manual and verified specifications.
- Maintenance schedules, fluid specifications, tyre information, and warning-light explanations.
- Current mileage, saved service history, and relevant modifications.
- Preferred language, emergency contacts, and roadside-assistance details.

Keep manufacturer information, owner-entered records, and live diagnostic readings distinguishable. Answers should identify their source where useful, such as "Your owner's manual says..." or "Your saved service record shows...".

## RAM configurations

| Device RAM | Recommended configuration |
|---|---|
| 4 GB | Whisper small Q5, verified information search, and an on-demand Qwen explanation model. |
| 2 GB | Whisper base Q5, commands, saved answers, and guided troubleshooting; omit the general language model. |
| 1 GB | Evaluate Vosk small with a restricted command vocabulary and fixed answers; reduce open-ended dictation and conversation. |

Vosk documentation puts typical small-model memory around **300 MB**. Small Hindi and Indian-English models are available, but suitability must be assessed against the product's command set.

Source: [Vosk models](https://alphacephei.com/vosk/models).

For the 4 GB build, target **whole-device peak RAM usage below approximately 3.2 GB**, leaving headroom. This is an engineering target, not a measured result.

Memory controls:

- Run a minimal operating system with only necessary services.
- Keep the language model optional and load it only when required.
- Avoid running multiple heavy inference workloads simultaneously.
- If necessary, unload speech recognition before loading the explanation model. Account for the extra switching delay.
- Bound conversation history, context length, audio buffers, and database caches.
- Measure whole-device memory under stress, including music playback and phone integration.

## Voice assets and licensing

Piper's current engine uses **GPL-3.0**. Voice assets have separate licensing considerations; select voices with documented rights suitable for the intended distribution.

The available Hindi **Pratham** voice lists a **CC BY-NC-SA 4.0 dataset licence** in its model card. Exclude it from the commercial baseline until the relevant rights are established. Use eSpeak NG initially and evaluate a properly licensed natural Hindi voice later.

Engine licences do not automatically establish the rights for every downloaded model or voice. Record the licence and provenance of each selected asset.

Sources: [Piper](https://github.com/OHF-Voice/piper1-gpl), [Pratham model card](https://huggingface.co/rhasspy/piper-voices/blob/main/hi/hi_IN/pratham/medium/MODEL_CARD), [eSpeak NG](https://github.com/espeak-ng/espeak-ng).

## Phone and vehicle integration

Calling and messaging require a separate phone integration. Installing the AI components does not automatically grant access to contacts, calls, SMS, or WhatsApp.

- Regular calls and SMS need cellular coverage and supported phone integration, but generally do not require mobile internet.
- WhatsApp and similar internet messaging or calling services require internet access.
- Streaming content that is not already downloaded requires internet access.
- Local music, saved car knowledge, service records, and local voice processing remain available offline.
- Diagnostic readings require a compatible vehicle and adapter. Available data varies by vehicle.
- Navigation requires an offline-capable application and previously downloaded maps; it is a separate integration from this core voice stack.

## Accuracy and reliability validation

Evaluate completed tasks, not only transcription quality.

Test with:

- English, Hindi, and mixed Hindi-English speech.
- Indian names, multiple contacts with similar names, and unfamiliar music titles.
- Road noise, AC, music playback, and different microphone positions.
- Ambiguous commands, partial commands, interruptions, and cancellation.
- Bluetooth disconnection and reconnection.
- Missing or outdated car information and unavailable diagnostic readings.
- Long sessions and repeated transitions between recognition, explanations, and playback.
- Internet disconnected throughout offline feature testing.

Measure:

- Correct intent, contact, and media selection.
- Accuracy of dictated message content.
- Correct retrieval of vehicle information and handling of unanswered questions.
- False wake-ups and missed activations.
- Response delays and model-switching delays.
- Peak whole-device RAM, processor load, and thermal behaviour.
- Recovery from phone, adapter, or playback failures.

Do not claim an accuracy percentage or guaranteed response time until these tests run on the target hardware. Pin software versions and model hashes that pass validation.

## Remaining decisions

1. Exact target device and processor.
2. Required languages for the first release.
3. Supported phone platforms and calling/messaging integration.
4. Initial supported car models and diagnostic adapters.

These details determine whether Whisper small is responsive enough and whether the complete configuration stays within the memory budget.

## Additional project references

- [WebRTC Audio Processing Module](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/g3doc/audio_processing_module.md)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [ONNX Runtime](https://github.com/microsoft/onnxruntime)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [sherpa-onnx keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)
- [SQLite FTS5](https://sqlite.org/fts5.html)
- [GStreamer](https://gstreamer.freedesktop.org/documentation/application-development/introduction/gstreamer.html)
