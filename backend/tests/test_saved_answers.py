import asyncio
from dataclasses import replace
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock

from fastapi.testclient import TestClient
from backend.app import create_app
from backend.rag import RagConfig


class SavedAnswerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        config = RagConfig(database=root/'test.db', embedding=root/'missing.onnx', tokenizer=root/'missing.json',
                           cli=root/'missing.exe', model=root/'missing.gguf')
        self.app = create_app(rag_config=config)
        self.client = TestClient(self.app)
        self.a = self.car(2024)
        self.b = self.car(2025)
        self.app.state.rag.embedder.encode = Mock(side_effect=AssertionError('Saved mode loaded embeddings'))
        self.app.state.rag.store.retrieve = Mock(side_effect=AssertionError('Saved mode searched manuals'))
        self.app.state.voice.run = AsyncMock(side_effect=AssertionError('Saved mode started a model worker'))

    def tearDown(self):
        self.client.close(); self.folder.cleanup()

    def car(self, year):
        response = self.client.post('/api/rag/cars', json={'make': 'Fictional', 'model': 'Test', 'year': year,
            'variant': 'Test only', 'market': 'Synthetic data'})
        self.assertEqual(response.status_code, 201)
        return response.json()['id']

    def save(self, car, answer='Fictional capacity is 42 test units.', **changes):
        payload = {'question': 'What is the fuel tank capacity?', 'answer': answer,
                   'source': 'Fictional test manual, page 7', 'aliases': ['How much fuel does the tank hold?']}
        payload.update(changes)
        return self.client.post(f'/api/rag/cars/{car}/answers', json=payload)

    def ask(self, car, question='What is the fuel tank capacity?', **options):
        return self.client.post('/api/rag/query', json={'car_id': car, 'question': question, 'answer_mode': 'saved', **options})

    def test_saved_mode_works_without_any_ai_assets_and_preserves_exact_answer(self):
        text = 'Fictional capacity is 42 test units. This is not real car advice.'
        self.assertEqual(self.save(self.a, text).status_code, 201)
        result = self.ask(self.a, generate=True).json()
        self.assertEqual(result['text'], text); self.assertEqual(result['mode'], 'saved')
        self.assertEqual(result['answer_mode'], 'saved'); self.assertEqual(result['sources'][0]['kind'], 'saved_answer')
        self.app.state.rag.embedder.encode.assert_not_called()
        self.app.state.rag.store.retrieve.assert_not_called()
        self.app.state.voice.run.assert_not_called()
        health = self.client.get('/api/rag/health').json()
        self.assertFalse(health['ready']); self.assertTrue(health['saved_answers_ready'])

    def test_questions_are_strictly_isolated_by_car(self):
        self.save(self.a, 'Fictional capacity: 42 test units.')
        self.save(self.b, 'Fictional capacity: 51 test units.')
        self.assertIn('42', self.ask(self.a).json()['text'])
        self.assertNotIn('51', self.ask(self.a).json()['text'])
        self.assertIn('51', self.ask(self.b).json()['text'])

    def test_missing_saved_answer_never_falls_back_to_rag_or_another_car(self):
        self.save(self.b)
        result = self.ask(self.a).json()
        self.assertEqual(result['mode'], 'saved_missing'); self.assertEqual(result['sources'], [])
        self.app.state.rag.store.retrieve.assert_not_called(); self.app.state.voice.run.assert_not_called()

    def test_aliases_case_spacing_and_punctuation_match_without_dropping_negation(self):
        self.save(self.a)
        self.assertEqual(self.ask(self.a, ' HOW MUCH FUEL does the tank hold!!! ').json()['mode'], 'saved')
        self.assertEqual(self.ask(self.a, 'How much fuel does the tank NOT hold?').json()['mode'], 'saved_missing')
        self.assertEqual(self.ask(self.a, 'What is the fuel tank capacity for heavy towing?').json()['mode'], 'saved_missing')

    def test_conflicting_alias_rejected_without_modifying_existing_entry(self):
        self.save(self.a)
        response = self.save(self.a, 'Different answer', question='Another question', aliases=['WHAT is the fuel tank CAPACITY!'])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(self.client.get(f'/api/rag/cars/{self.a}/answers').json()['answers']), 1)

    def test_edit_updates_answer_and_replaces_aliases(self):
        item = self.save(self.a).json()
        data = {key: item[key] for key in ('question', 'answer', 'source', 'aliases')}
        data.update(answer='Updated fictional capacity: 43 test units.', aliases=['Show the tank specification.'])
        response = self.client.put(f'/api/rag/cars/{self.a}/answers/{item["id"]}', json=data)
        self.assertEqual(response.status_code, 200)
        self.assertIn('43', self.ask(self.a, 'Show the tank specification.').json()['text'])
        self.assertEqual(self.ask(self.a, 'How much fuel does the tank hold?').json()['mode'], 'saved_missing')

    def test_cross_car_edit_or_delete_is_rejected(self):
        item = self.save(self.a).json()
        data = {key: item[key] for key in ('question', 'answer', 'source', 'aliases')}
        url = f'/api/rag/cars/{self.b}/answers/{item["id"]}'
        self.assertEqual(self.client.put(url, json=data).status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)
        self.assertEqual(self.ask(self.a).json()['mode'], 'saved')

    def test_delete_removes_lookup_keys(self):
        item = self.save(self.a).json()
        self.assertEqual(self.client.delete(f'/api/rag/cars/{self.a}/answers/{item["id"]}').status_code, 200)
        self.assertEqual(self.ask(self.a).json()['mode'], 'saved_missing')
        self.assertEqual(self.ask(self.a, 'How much fuel does the tank hold?').json()['mode'], 'saved_missing')

    def test_car_deletion_cascades_saved_answers_and_keys(self):
        self.save(self.a)
        self.client.delete(f'/api/rag/cars/{self.a}')
        with self.app.state.rag.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM saved_answers').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM saved_answer_keys').fetchone()[0], 0)

    def test_saved_lookup_remains_available_while_model_worker_is_busy(self):
        self.save(self.a)
        lock = self.app.state.voice.lock; asyncio.run(lock.acquire())
        try: self.assertEqual(self.ask(self.a).json()['mode'], 'saved')
        finally: lock.release()

    def test_invalid_inputs_and_unknown_mode_are_rejected(self):
        for options in [{'source': ' '}, {'answer': ' '}, {'question': '?!'}, {'aliases': ['x'*601]}, {'aliases': ['x']*21}]:
            with self.subTest(options=options): self.assertEqual(self.save(self.a, **options).status_code, 422)
        self.assertEqual(self.ask(self.a, answer_mode='automatic').status_code, 422)
        self.assertEqual(self.ask(self.a, question=' ').status_code, 422)

    def test_export_contains_only_the_selected_cars_predefined_answers(self):
        self.save(self.a); self.save(self.b, 'Different fictional data')
        result = self.client.get(f'/api/rag/cars/{self.a}/export').json()
        self.assertEqual(len(result['saved_answers']), 1)
        self.assertEqual(result['saved_answers'][0]['car_id'], self.a)

    def test_new_tables_preserve_existing_car_records(self):
        path = Path(self.folder.name)/'legacy.db'
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE cars(id TEXT PRIMARY KEY,make TEXT,model TEXT,year INTEGER,variant TEXT,market TEXT,identity TEXT UNIQUE)')
            db.execute('INSERT INTO cars VALUES(?,?,?,?,?,?,?)', ('legacy', 'Test', 'Legacy', 2024, 'Test', 'Test', 'legacy'))
        db.close()
        app = create_app(rag_config=replace(self.app.state.rag.config, database=path))
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/rag/cars').json()['cars'][0]['id'], 'legacy')
            self.assertEqual(client.get('/api/rag/cars/legacy/answers').json()['answers'], [])

    def test_rag_mode_does_not_substitute_a_saved_answer(self):
        self.save(self.a)
        self.app.state.rag.store.retrieve = Mock(return_value=[])
        result = self.ask(self.a, answer_mode='rag').json()
        self.assertEqual(result['mode'], 'insufficient')
        self.assertEqual(result['answer_mode'], 'rag')
        self.assertNotIn('42', result['text'])


if __name__ == '__main__': unittest.main()
