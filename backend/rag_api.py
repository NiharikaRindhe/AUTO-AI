"""Vehicle library API and bounded, cancellable local RAG generation."""
import asyncio
import json
from pathlib import Path
import tempfile
import time
from typing import Literal

from fastapi import HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from backend.rag import (LocalEmbedder, MAX_DOCUMENT_BYTES, RagConfig, RagError,
                         RagStore, make_prompt, validate_answer)
from backend.saved_answers import SavedAnswerStore


class CarInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    make: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=80)
    year: int = Field(ge=1900, le=2100)
    variant: str = Field(min_length=1, max_length=120)
    market: str = Field(min_length=1, max_length=80)


class QuestionInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    car_id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=1, max_length=600)
    generate: bool = True
    answer_mode: Literal['rag', 'saved'] = 'rag'


class SavedAnswerInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    question: str = Field(min_length=1, max_length=600)
    answer: str = Field(min_length=1, max_length=1400)
    aliases: list[str] = Field(default_factory=list, max_length=20)
    source: str = Field(min_length=1, max_length=300)


class RagService:
    def __init__(self, config):
        self.config = config
        self.store = RagStore(config.database)
        self.embedder = LocalEmbedder(config)
        self.saved = SavedAnswerStore(self.store)

    def status(self):
        semantic = self.config.embedding.is_file() and self.config.tokenizer.is_file()
        generation = self.config.cli.is_file() and self.config.model.is_file()
        cars = self.store.cars()
        return {'ready': semantic and generation, 'retrieval_ready': semantic,
                'generation_ready': generation, 'local_only': True,
                'embedding': 'all-MiniLM-L6-v2 / INT8 ONNX CPU',
                'retrieval': 'SQLite FTS5 BM25 + cosine / reciprocal rank fusion',
                'generator': 'Qwen3-0.6B Q4_0 / llama.cpp CPU',
                'cars': len(cars), 'documents': sum(car['documents'] for car in cars),
                'saved_answers_ready': True, 'saved_answers': sum(car['saved_answers'] for car in cars),
                'max_upload_bytes': MAX_DOCUMENT_BYTES}

    async def answer(self, payload, request, engine):
        started = time.perf_counter()
        car = await asyncio.to_thread(self.store.car, payload.car_id)
        sources = await asyncio.to_thread(self.store.retrieve, payload.car_id, payload.question, self.embedder)
        result = {'car': car, 'sources': sources, 'source': 'Selected car manual library', 'mode': 'insufficient', 'answer_mode': 'rag'}
        if not sources:
            return {**result, 'text': 'I do not have matching evidence for this car. Import a manual for this exact year, variant, and market, or rephrase your question.', 'processing_ms': round((time.perf_counter() - started) * 1000)}
        reason = None
        if payload.generate and self.config.cli.is_file() and self.config.model.is_file():
            with tempfile.TemporaryDirectory(prefix='autoai-rag-') as folder:
                prompt = Path(folder) / 'prompt.txt'
                schema = Path(folder) / 'response.json'
                prompt.write_text(make_prompt(car, payload.question, sources), encoding='utf-8')
                schema.write_text(json.dumps({'type': 'object', 'properties': {
                    'answer': {'type': 'string'}, 'citations': {'type': 'array', 'items': {'type': 'integer', 'enum': [source['citation'] for source in sources]}}},
                    'required': ['answer', 'citations'], 'additionalProperties': False}), encoding='utf-8')
                try:
                    output = await engine.run([str(self.config.cli), '-m', str(self.config.model),
                        '-f', str(prompt), '-jf', str(schema), '--no-conversation', '--no-display-prompt',
                        '--simple-io', '--no-warmup', '--no-escape', '-ngl', '0',
                        '-c', '2048', '-n', '256', '-b', '128', '-ub', '128',
                        '-t', str(engine.config.threads), '--temp', '0', '--seed', '42'], request)
                    answer = validate_answer(output.decode('utf-8', errors='replace'), sources)
                    if answer:
                        return {**result, 'mode': 'generated', 'text': answer['text'],
                                'sources': [source for source in sources if source['citation'] in answer['citations']],
                                'processing_ms': round((time.perf_counter() - started) * 1000)}
                    reason = 'The model output did not pass evidence checks; showing source excerpts.'
                except HTTPException as error:
                    if error.status_code == 499:
                        raise
                    reason = 'The local model could not finish; showing source excerpts.'
        else:
            reason = 'Showing retrieved excerpts. Local generation is disabled or its model needs setup.'
        # Transparent fallback, never present retrieval-only output as generated reasoning.
        text = 'Matching manual excerpts:\n\n' + '\n\n'.join(f'[{source["citation"]}] {source["text"]}' for source in sources)
        return {**result, 'mode': 'excerpts', 'text': text, 'notice': reason,
                'processing_ms': round((time.perf_counter() - started) * 1000)}


def install_rag(app, engine, config=None):
    service = RagService(config or RagConfig.discover())
    app.state.rag = service

    @app.exception_handler(RagError)
    async def rag_error(request, error):
        return JSONResponse(status_code=error.status, content={'detail': {'code': 'rag_error', 'message': str(error)}})

    @app.get('/api/rag/health')
    async def health():
        return await asyncio.to_thread(service.status)

    @app.get('/api/rag/cars')
    async def cars():
        return {'cars': await asyncio.to_thread(service.store.cars)}

    @app.post('/api/rag/cars', status_code=201)
    async def add_car(payload: CarInput):
        return await asyncio.to_thread(service.store.add_car, payload.model_dump())

    @app.delete('/api/rag/cars/{car_id}')
    async def delete_car(car_id: str):
        if engine.lock.locked():
            raise RagError('Wait for local processing to finish before deleting a car.', 409)
        async with engine.lock:
            await asyncio.to_thread(service.store.delete_car, car_id)
        return {'deleted': True}

    @app.get('/api/rag/cars/{car_id}/documents')
    async def documents(car_id: str):
        return {'documents': await asyncio.to_thread(service.store.documents, car_id)}

    @app.get('/api/rag/cars/{car_id}/export')
    async def export_car(car_id: str):
        def snapshot():
            car = service.store.car(car_id)
            documents = service.store.documents(car_id)
            return {'car': car, 'documents': [service.store.document(car_id, doc['id']) for doc in documents],
                    'saved_answers': service.saved.entries(car_id)}
        return await asyncio.to_thread(snapshot)

    @app.get('/api/rag/cars/{car_id}/documents/{doc_id}')
    async def document(car_id: str, doc_id: str):
        return await asyncio.to_thread(service.store.document, car_id, doc_id)

    @app.delete('/api/rag/cars/{car_id}/documents/{doc_id}')
    async def delete_document(car_id: str, doc_id: str):
        if engine.lock.locked():
            raise RagError('Wait for local processing to finish before removing a source.', 409)
        async with engine.lock:
            await asyncio.to_thread(service.store.delete_document, car_id, doc_id)
        return {'deleted': True}

    @app.post('/api/rag/cars/{car_id}/documents', status_code=201)
    async def upload(car_id: str, request: Request, name: str = Query(min_length=1, max_length=180)):
        # Name is display metadata only, never a filesystem path.
        name = name.replace('\\', '/').split('/')[-1].strip()
        if not name:
            raise RagError('Give this document a filename.')
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_DOCUMENT_BYTES:
                raise RagError('Keep each file below 8 MB.', 413)
        if not body:
            raise RagError('The document is empty.')
        if engine.lock.locked():
            raise RagError('The local engine is busy. Wait for the reply or indexing to finish.', 429)
        async with engine.lock:
            return await asyncio.to_thread(service.store.ingest, car_id, name, bytes(body), service.embedder)

    @app.post('/api/rag/query')
    async def query(payload: QuestionInput, request: Request):
        if not payload.question.strip():
            raise RagError('Enter a question.')
        if payload.answer_mode == 'saved':
            # Deterministic lookup bypasses the embedder, generation, and model lock.
            return await asyncio.to_thread(service.saved.answer, payload.car_id, payload.question)
        if engine.lock.locked():
            raise RagError('The local engine is busy. Try again after the current reply or import finishes.', 429)
        # Same lock as Whisper/Piper: large models never run concurrently.
        async with engine.lock:
            return await service.answer(payload, request, engine)

    @app.get('/api/rag/cars/{car_id}/answers')
    async def saved_answers(car_id: str):
        return {'answers': await asyncio.to_thread(service.saved.entries, car_id)}

    @app.post('/api/rag/cars/{car_id}/answers', status_code=201)
    async def add_answer(car_id: str, payload: SavedAnswerInput):
        if any(len(alias) > 600 for alias in payload.aliases):
            raise RagError('Keep each alternative question below 600 characters.')
        return await asyncio.to_thread(service.saved.save, car_id, payload.model_dump())

    @app.put('/api/rag/cars/{car_id}/answers/{answer_id}')
    async def update_answer(car_id: str, answer_id: str, payload: SavedAnswerInput):
        if any(len(alias) > 600 for alias in payload.aliases):
            raise RagError('Keep each alternative question below 600 characters.')
        return await asyncio.to_thread(service.saved.update, car_id, answer_id, payload.model_dump())

    @app.delete('/api/rag/cars/{car_id}/answers/{answer_id}')
    async def delete_answer(car_id: str, answer_id: str):
        await asyncio.to_thread(service.saved.delete, car_id, answer_id)
        return {'deleted': True}
