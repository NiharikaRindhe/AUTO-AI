"""Real installed-model smoke check, using temporary fictional car data only."""
from dataclasses import replace
from pathlib import Path
import tempfile
import time

from fastapi.testclient import TestClient
from backend.app import create_app
from backend.rag import RagConfig


def main():
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='autoai-rag-check-') as folder:
        app = create_app(rag_config=replace(RagConfig.discover(), database=Path(folder) / 'test.sqlite3'))
        with TestClient(app) as client:
            assert client.get('/api/rag/health').json()['ready'], 'Run npm.cmd run rag:setup first.'
            cars = []
            for model, year, pressure in [('Fictional Alpha', 2024, '31'), ('Fictional Beta', 2025, '38')]:
                result = client.post('/api/rag/cars', json={'make': 'TEST ONLY', 'model': model,
                    'year': year, 'variant': 'Fictional petrol manual', 'market': 'Synthetic test'} )
                assert result.status_code == 201, result.text
                car = result.json(); cars.append(car)
                result = client.post(f'/api/rag/cars/{car["id"]}/documents', params={'name': 'fictional-manual.txt'},
                    content=f'The recommended cold tyre pressure is {pressure} psi. Check the tyres when cold. The front windscreen defogger button is on the centre console. This is fictional test data, never real vehicle advice.'.encode())
                assert result.status_code == 201, result.text
            for car, expected, forbidden in [(cars[0], '31', '38'), (cars[1], '38', '31')]:
                result = client.post('/api/rag/query', json={'car_id': car['id'], 'question': 'What is the recommended cold tyre pressure?'} )
                assert result.status_code == 200, result.text
                answer = result.json()
                assert answer['mode'] == 'generated', answer
                assert expected in answer['text'] and forbidden not in answer['text'], answer
                assert answer['sources'] and answer['car']['id'] == car['id']
                print(f'PASS: {car["model"]} generated an answer citing only its own manual ({answer["processing_ms"]} ms).', flush=True)
            result = client.post('/api/rag/query', json={'car_id': cars[0]['id'], 'question': 'Who composed Beethoven symphonies?'}).json()
            assert result['mode'] == 'insufficient' and not result['sources'], result
            print('PASS: unrelated question declined without inventing an answer.', flush=True)
            if client.get('/api/voice/health').json()['ready']:
                spoken = client.post('/api/voice/synthesize', json={'text': 'Where is the front windscreen defogger button?'})
                spoken.raise_for_status()
                transcript = client.post('/api/voice/transcribe?language=en', content=spoken.content, headers={'Content-Type': 'audio/wav'})
                transcript.raise_for_status()
                answer = client.post('/api/rag/query', json={'car_id': cars[0]['id'], 'question': transcript.json()['text']})
                answer.raise_for_status()
                answer = answer.json()
                assert answer['mode'] == 'generated' and 'centre console' in answer['text'].lower(), answer
                reply = client.post('/api/voice/synthesize', json={'text': answer['text']})
                reply.raise_for_status()
                assert reply.content[:4] == b'RIFF'
                print('PASS: synthetic speech -> Whisper -> car-scoped RAG -> Piper spoken answer.', flush=True)
    print(f'Installed MiniLM + SQLite + Qwen check passed in {time.perf_counter() - started:.1f}s. No production car data was changed.', flush=True)


if __name__ == '__main__':
    main()
