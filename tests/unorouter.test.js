import test from 'node:test';
import assert from 'node:assert/strict';
import { runVision, runText, chainFor, parseStep, cooldownFor } from '../api/_lib/vision.js';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const AI_KEYS = ['UNOROUTER_API_KEY', 'GROQ_API_KEY', 'NVIDIA_API_KEY', 'GEMINI_API_KEY', 'GEMINI_API_KAY', 'GEMINI_PAI_KEY', 'OPENAI_API_KEY', 'AI_VISION_MODELS', 'AI_JUDGE_MODELS'];

function withEnv(env, fn) {
  return async () => {
    const saved = { ...process.env };
    const original = globalThis.fetch;
    for (const k of AI_KEYS) delete process.env[k];
    Object.assign(process.env, env);
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
      process.env = saved;
    }
  };
}

test('parseStep keeps model ids that contain ":"', () => {
  assert.deepEqual(parseStep('unorouter:gpt-4o:free'), { provider: 'unorouter', model: 'gpt-4o:free' });
  assert.equal(parseStep('nope:model'), null);
});

test('chains only include providers with a key, custom models first', withEnv({ GROQ_API_KEY: 'g', AI_VISION_MODELS: 'groq:my-model' }, async () => {
  const chain = chainFor('vision');
  assert.ok(chain.length > 0);
  assert.ok(chain.every(s => s.provider === 'groq'));
  assert.equal(chain[0].model, 'my-model');
}));

test('vision falls through failing, invalid and empty answers to the next provider', withEnv({ GROQ_API_KEY: 'g', NVIDIA_API_KEY: 'n', UNOROUTER_API_KEY: 'u' }, async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, model: body.model, auth: init.headers.Authorization });
    if (url.includes('groq')) return new Response(JSON.stringify({ error: { message: 'model decommissioned' } }), { status: 404 });
    // Plain text, then JSON without a chart flag or decision: neither counts as an answer.
    if (body.model === 'meta/llama-3.2-90b-vision-instruct') return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"decisao":"COMPRAR"}\n```' } }] }), { status: 200 });
  };
  const result = await runVision(IMAGE, 'analisa');
  assert.equal(result.raw.decisao, 'COMPRAR');
  assert.equal(result.provider, 'NVIDIA (nvidia/nemotron-3-nano-omni-30b-a3b-reasoning)');
  assert.ok(calls[0].url.startsWith('https://api.groq.com/openai/v1/chat/completions'));
  assert.equal(calls[0].auth, 'Bearer g');
  // Images never go to free proxy tiers by default.
  assert.ok(!calls.some(c => String(c.model).endsWith(':free')));
}));

test('models that time out or refuse the key are paused longer than busy ones', () => {
  assert.equal(cooldownFor({ status: 429, message: 'Too many requests' }), 60_000);
  assert.equal(cooldownFor({ name: 'AbortError', message: 'This operation was aborted' }), 120_000);
  assert.equal(cooldownFor({ status: 403, message: 'Your project has been denied access' }), 600_000);
  assert.equal(cooldownFor({ status: 400, message: 'bad request' }), 0);
});

test('a rate-limited model is paused and skipped on the next call', withEnv({ NVIDIA_API_KEY: 'n', AI_JUDGE_MODELS: 'nvidia:limited-model,nvidia:good-model' }, async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const { model } = JSON.parse(init.body);
    seen.push(model);
    if (model === 'limited-model') return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'veredito' } }] }), { status: 200 });
  };
  assert.equal((await runText('x')).text, 'veredito');
  seen.length = 0;
  await runText('y');
  assert.ok(!seen.includes('limited-model'));
}));

test('without any AI key the vision call reports setup required', withEnv({}, async () => {
  await assert.rejects(runVision(IMAGE, 'x'), e => e.setupRequired === true && e.status === 503);
}));
