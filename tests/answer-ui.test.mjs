import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

test('answer mode controls restore saved preference and keep legacy records compatible', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const previousStorage = globalThis.localStorage;
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx');
    for (const [saved, expected] of [[{ answerMode: 'saved' }, 'saved'], [{ answerMode: 'rag' }, 'rag'], [{ profile: { model: 'Legacy car' } }, 'rag']]) {
      globalThis.localStorage = { getItem: () => JSON.stringify(saved) };
      const markup = renderToString(React.createElement(App));
      assert.match(markup, /Saved car data \(no AI\)/);
      assert.match(markup, /RAG \+ LLM/);
      const selected = [...markup.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(match => match[0]).find(input => input.includes('checked=""'));
      assert.ok(selected?.includes(`value="${expected}"`), `Expected persisted ${expected} mode`);
    }
  } finally {
    globalThis.localStorage = previousStorage;
    await server.close();
  }
});
