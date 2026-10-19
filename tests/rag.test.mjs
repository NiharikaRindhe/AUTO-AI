import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../src/assistant.js';
import { carLabel, queryCar } from '../src/rag/api.js';

const context = { profile: { model: 'Example Alpha' }, documents: [{ name: 'Unassigned', text: 'Tyre pressure is 99 psi.' }], notes: [], useRag: true };

test('car questions use RAG without consulting unassigned browser documents', () => {
  for (const question of ['What tyre pressure should I use?', 'Which oil does my car need?', 'What is the service interval?', 'What does this message on the dashboard mean?', 'Where is the volume button?', 'How do I stop the engine?']) {
    assert.deepEqual(answerQuestion(question, context), { rag: true });
  }
});

test('RAG routing preserves explicit local commands and personal service records', () => {
  assert.equal(answerQuestion('Pause music', context).action, 'music_pause');
  assert.match(answerQuestion('When is my next service?', context).text, /no saved service records/);
  assert.match(answerQuestion('Call Mum', context).text, /cannot place calls/);
});

test('a RAG request carries the exact car ID and cancellation signal', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController(); let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ text: 'Evidence' }) }; };
  try {
    await queryCar('car-a', 'Where is the defogger?', controller.signal);
    assert.equal(request.url, '/api/rag/query');
    assert.deepEqual(JSON.parse(request.options.body), { car_id: 'car-a', question: 'Where is the defogger?', generate: true, answer_mode: 'rag' });
    assert.equal(request.options.signal, controller.signal);
  } finally { globalThis.fetch = originalFetch; }
});

test('saved-data requests explicitly disable generation and keep voice cancellation', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController(); let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ text: 'Saved answer', mode: 'saved' }) }; };
  try {
    const result = await queryCar('car-b', 'What is the fuel tank capacity?', controller.signal, 'saved');
    assert.equal(result.mode, 'saved');
    assert.equal(request.options.signal, controller.signal);
    assert.deepEqual(JSON.parse(request.options.body), { car_id: 'car-b', question: 'What is the fuel tank capacity?', generate: false, answer_mode: 'saved' });
  } finally { globalThis.fetch = originalFetch; }
});

test('missing saved answers and backend errors do not trigger an AI retry', async () => {
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ mode: 'saved_missing', text: 'No saved answer' }) };
  };
  try {
    assert.equal((await queryCar('car-b', 'Unknown question', undefined, 'saved')).mode, 'saved_missing');
    assert.equal(requests.length, 1); assert.equal(requests[0].answer_mode, 'saved');
    globalThis.fetch = async () => { throw new Error('Backend down'); };
    await assert.rejects(queryCar('car-b', 'Unknown question', undefined, 'saved'), /unavailable/);
    assert.equal(requests.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('car labels distinguish year variant and market', () => {
  assert.equal(carLabel({ make: 'Example', model: 'Alpha', year: 2024, variant: 'Petrol manual', market: 'India' }), 'Example Alpha · 2024 · Petrol manual · India');
});
