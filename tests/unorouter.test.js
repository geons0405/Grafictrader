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
    if (body.model === 'gpt-4o:free') {
      return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
    }
    if (body.model === 'qwen2.5-vl-7b-instruct-awq:free') {
      return new Response(JSON.stringify({ error: { message: 'Your balance is empty, so this paid model cannot run.' } }), { status: 403 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"decisao":"COMPRAR"}\n```' } }] }), { status: 200 });
  };
  try {
    const result = await runVision(IMAGE, 'analisa');
    assert.equal(result.raw.decisao, 'COMPRAR');
    assert.equal(result.provider, 'UnoRouter (llama-4-maverick-17b-128e-instruct:free)');
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

test('a model that answers with non-JSON text is skipped for the next one', async () => {
  const original = globalThis.fetch;
  const saved = { ...process.env };
  process.env.UNOROUTER_API_KEY = 'test-key';
  delete process.env.UNOROUTER_MODEL;
  globalThis.fetch = async (url, init) => {
    const { model } = JSON.parse(init.body);
    const content = model === 'gpt-4o:free' ? 'Desculpa, não consigo.' : '{"tendencia":"alta"}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  try {
    const result = await runVision(IMAGE, 'x');
    assert.equal(result.raw.tendencia, 'alta');
    assert.equal(result.provider, 'UnoRouter (qwen2.5-vl-7b-instruct-awq:free)');
  } finally {
    globalThis.fetch = original;
    process.env = saved;
  }
});
