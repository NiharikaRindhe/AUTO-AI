"""Prewritten car answers. Matching and lookup never invoke an AI model."""
import json
import re
import sqlite3
import unicodedata
import uuid

from backend.rag import RagError


def question_key(text):
    # Normalize spelling layout only; preserve negation, numbers, and word order.
    # Aliases explicitly control which other phrasings are allowed.
    text = unicodedata.normalize('NFKC', text).casefold()
    return ' '.join(re.findall(r'[^\W_]+', text, re.UNICODE))


class SavedAnswerStore:
    def __init__(self, store):
        self.store = store

    def entries(self, car_id):
        self.store.car(car_id)
        with self.store.db() as db:
            return [self.decode(row) for row in db.execute(
                'SELECT id,car_id,question,answer,aliases,source FROM saved_answers WHERE car_id=? ORDER BY rowid DESC', (car_id,))]

    @staticmethod
    def decode(row):
        return {**dict(row), 'aliases': json.loads(row['aliases'])}

    def save(self, car_id, data, entry_id=None):
        self.store.car(car_id)
        question, answer, source = (data[key].strip() for key in ('question', 'answer', 'source'))
        if not question_key(question) or not answer or not source:
            raise RagError('Enter a question, a prewritten answer, and its source reference.')
        aliases = list(dict.fromkeys(alias.strip() for alias in data.get('aliases', []) if alias.strip()))
        keys = list(dict.fromkeys(question_key(item) for item in [question, *aliases]))
        if any(not key for key in keys):
            raise RagError('Alternative questions must contain letters or numbers.')
        entry_id = entry_id or str(uuid.uuid4())
        try:
            with self.store.db() as db:
                existing = db.execute('SELECT car_id FROM saved_answers WHERE id=?', (entry_id,)).fetchone()
                if existing and existing['car_id'] != car_id:
                    raise RagError('Saved answer not found for this car.', 404)
                if not existing and db.execute('SELECT count(*) FROM saved_answers WHERE car_id=?', (car_id,)).fetchone()[0] >= 1000:
                    raise RagError('Keep each car below 1,000 saved answers.')
                for key in keys:
                    found = db.execute('SELECT answer_id FROM saved_answer_keys WHERE car_id=? AND question_key=?', (car_id, key)).fetchone()
                    if found and found['answer_id'] != entry_id:
                        raise RagError('A question or alternative phrasing already belongs to another answer for this car.', 409)
                db.execute('''INSERT INTO saved_answers(id,car_id,question,answer,aliases,source) VALUES(?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET question=excluded.question,answer=excluded.answer,aliases=excluded.aliases,source=excluded.source''',
                    (entry_id, car_id, question, answer, json.dumps(aliases, ensure_ascii=False), source))
                db.execute('DELETE FROM saved_answer_keys WHERE answer_id=?', (entry_id,))
                db.executemany('INSERT INTO saved_answer_keys(car_id,question_key,answer_id) VALUES(?,?,?)', [(car_id, key, entry_id) for key in keys])
        except sqlite3.IntegrityError as exc:
            raise RagError('The car or question changed while saving. Refresh the library and try again.', 409) from exc
        return {'id': entry_id, 'car_id': car_id, 'question': question, 'answer': answer, 'aliases': aliases, 'source': source}

    def update(self, car_id, entry_id, data):
        with self.store.db() as db:
            if not db.execute('SELECT 1 FROM saved_answers WHERE id=? AND car_id=?', (entry_id, car_id)).fetchone():
                raise RagError('Saved answer not found for this car.', 404)
        return self.save(car_id, data, entry_id)

    def delete(self, car_id, entry_id):
        with self.store.db() as db:
            if not db.execute('DELETE FROM saved_answers WHERE id=? AND car_id=?', (entry_id, car_id)).rowcount:
                raise RagError('Saved answer not found for this car.', 404)

    def answer(self, car_id, question):
        car = self.store.car(car_id)
        with self.store.db() as db:
            row = db.execute('''SELECT a.id,a.car_id,a.question,a.answer,a.aliases,a.source FROM saved_answer_keys k
                JOIN saved_answers a ON a.id=k.answer_id AND a.car_id=k.car_id
                WHERE k.car_id=? AND k.question_key=?''', (car_id, question_key(question))).fetchone()
        if row is None:
            return {'car': car, 'answer_mode': 'saved', 'mode': 'saved_missing', 'sources': [],
                    'text': 'There is no saved answer for that question on this car. Add a prewritten answer or an alternative question in Knowledge. Saved car data mode does not search manuals or use the LLM.'}
        item = self.decode(row)
        return {'car': car, 'answer_mode': 'saved', 'mode': 'saved', 'text': item['answer'],
                'source': item['source'], 'sources': [{'kind': 'saved_answer', 'citation': 1,
                    'document_id': item['id'], 'name': item['source'], 'chunk': 1, 'page': None, 'text': item['answer']}],
                'notice': 'Prewritten answer, entered manually. Check the source matches this exact car configuration.'}
