import test from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let behaviour = {};
globalThis.fetch = async (url, init = {}) => {
  const host = new URL(String(url)).host;
  calls.push(host);
  const { delay = 0, fail = false, text = '{"graficoVisivel":true,"decisao":"AGUARDAR"}' } = behaviour[host] || {};
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    init.signal?.addEventListener('abort', () => { clearTimeout(timer); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  if (fail) return new Response(JSON.stringify({ error: { message: 'down' } }), { status: 500 });
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
};

const { runChain, isVisionAnswer } = await import('../api/_lib/vision.js');
const steps = [{ provider: 'groq', model: 'a' }, { provider: 'nvidia', model: 'b' }];
const run = () => runChain('vision', 'p', 'data:image/png;base64,AA', { steps, accept: isVisionAnswer, hedgeMs: 50 });

test('a slow first model does not hold the answer up: the next one starts alongside and wins', async () => {
  calls.length = 0;
  behaviour = { 'api.groq.com': { delay: 2000 }, 'integrate.api.nvidia.com': { delay: 10 } };
  const started = Date.now();
  const result = await run();
  assert.match(result.provider, /NVIDIA/);
  assert.ok(Date.now() - started < 1000, 'answered without waiting for the slow model');
});

test('a fast first model answers alone', async () => {
  calls.length = 0;
  behaviour = { 'api.groq.com': { delay: 5 }, 'integrate.api.nvidia.com': { delay: 5 } };
  const result = await run();
  assert.match(result.provider, /Groq/);
  assert.deepEqual(calls, ['api.groq.com']);
});

test('a failing model hands over at once, and all failing is an error', async () => {
  behaviour = { 'api.groq.com': { fail: true }, 'integrate.api.nvidia.com': { delay: 5 } };
  assert.match((await run()).provider, /NVIDIA/);
  behaviour = { 'api.groq.com': { fail: true }, 'integrate.api.nvidia.com': { fail: true } };
  await assert.rejects(runChain('vision', 'p', 'data:image/png;base64,AA', { steps: [{ provider: 'groq', model: 'c' }, { provider: 'nvidia', model: 'd' }], accept: isVisionAnswer, hedgeMs: 50 }), /Nenhum modelo/);
});

test('broker OTC charts are never cross-checked against the real market', async () => {
  const { mapAsset } = await import('../api/_lib/quant/verdict.js');
  assert.equal(mapAsset('Bitcoin OTC'), null);
  assert.equal(mapAsset('BTC/USD (OTC)'), null);
  assert.equal(mapAsset('BTCUSD-OTC'), null);
  assert.equal(mapAsset('Bitcoin'), 'BTCUSDT');
});
