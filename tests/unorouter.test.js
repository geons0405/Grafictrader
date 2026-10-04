import test from 'node:test';
import assert from 'node:assert/strict';
import { runVision } from '../api/_lib/vision.js';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

test('UnoRouter is used first and falls back to the next model when one is missing', async () => {
  const original = globalThis.fetch;
  const saved = { ...process.env };
  process.env.UNOROUTER_API_KEY = 'test-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KAY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.UNOROUTER_MODEL;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, model: body.model, auth: init.headers.Authorization, content: body.messages[0].content });
    if (body.model === 'gemini-3.6-flash:free') {
      return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
    }
    if (body.model === 'gpt-4o:free') {
      return new Response(JSON.stringify({ error: { message: 'Your balance is empty, so this paid model cannot run.' } }), { status: 403 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"decisao":"COMPRAR"}\n```' } }] }), { status: 200 });
  };
  try {
    const result = await runVision(IMAGE, 'analisa');
    assert.equal(result.raw.decisao, 'COMPRAR');
    assert.equal(result.provider, 'UnoRouter (gemini-3.5-flash-lite:free)');
    assert.equal(calls[0].url, 'https://api.unorouter.com/v1/chat/completions');
    assert.equal(calls[0].auth, 'Bearer test-key');
    assert.equal(calls[2].content[1].image_url.url, IMAGE);
  } finally {
    globalThis.fetch = original;
    process.env = saved;
  }
});

test('without any AI key the vision call reports setup required', async () => {
  const saved = { ...process.env };
  for (const k of ['UNOROUTER_API_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KAY', 'OPENAI_API_KEY']) delete process.env[k];
  try {
    await assert.rejects(runVision(IMAGE, 'x'), e => e.setupRequired === true && e.status === 503);
  } finally {
    process.env = saved;
  }
});
