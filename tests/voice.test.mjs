import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/voice/audio.js';
import { answerQuestion } from '../src/assistant.js';

const context = { profile: { model: 'Test Car', year: '2022', mileage: '10000', variant: 'Petrol', sample: false }, documents: [], notes: [] };

test('browser audio is encoded as mono PCM16 WAV at 16 kHz', async () => {
  for (const rate of [16000, 44100, 48000]) {
    const blob = encodeWav([new Float32Array(rate).fill(.25)], rate);
    const data = new DataView(await blob.arrayBuffer());
    assert.equal(blob.type, 'audio/wav');
    assert.equal(blob.size, 32044);
    assert.equal(data.getUint32(24, true), 16000);
    assert.equal(data.getUint16(22, true), 1);
    assert.equal(data.getUint16(34, true), 16);
    assert.ok(Math.abs(data.getInt16(44, true) - 8192) <= 1);
  }
});

test('out-of-range microphone samples are clipped rather than wrapping', async () => {
  const data = new DataView(await encodeWav([new Float32Array([-2, 2])], 16000).arrayBuffer());
  assert.equal(data.getInt16(44, true), -32768);
  assert.equal(data.getInt16(46, true), 32767);
});

test('voice and text commands return explicit actions without claiming phone access', () => {
  assert.equal(answerQuestion('Please pause music', context).action, 'music_pause');
  assert.equal(answerQuestion('Play music', context).action, 'open_music');
  assert.equal(answerQuestion('Play next song', { ...context, hasMusic: true }).action, 'music_next');
  assert.match(answerQuestion('Call Mum', context).text, /cannot place calls/);
  assert.match(answerQuestion('Tell me about my car', context).text, /Test Car/);
});

test('car answers retain evidence and decline unsupported questions', () => {
  const answer = answerQuestion('Where is the defogger?', { ...context, documents: [{ name: 'Example manual', text: 'The defogger button is on the centre console.' }] });
  assert.equal(answer.source, 'Example manual');
  assert.match(answer.text, /centre console/);
  assert.match(answerQuestion('What is the engine torque?', context).text, /don’t have verified/);
});

