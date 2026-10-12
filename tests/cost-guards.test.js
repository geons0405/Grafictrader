import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
globalThis.fetch = async () => new Response('offline', { status: 503 });

const { default: health, isAdmin } = await import('../api/health.js');
const { default: mechanicsAi } = await import('../api/mechanics-ai.js');

function call(handler, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch(error => resolve({ status: 'threw', error }));
  });
}

test('health tells the public only that the API is up', async () => {
  process.env.ADMIN_TOKEN = 'a'.repeat(32);
  const open = await call(health, { query: { compare: 'groq:x', models: 'groq' } });
  assert.deepEqual(Object.keys(open.body).sort(), ['at', 'ok']);
  assert.equal(isAdmin({ headers: { 'x-admin-token': 'b'.repeat(32) } }), false);
  assert.equal(isAdmin({ headers: { 'x-admin-token': 'a'.repeat(32) } }), true);
  const admin = await call(health, { headers: { 'x-admin-token': 'a'.repeat(32) } });
  assert.ok(admin.body.configured && admin.body.chains);
  delete process.env.ADMIN_TOKEN;
  assert.equal(isAdmin({ headers: { 'x-admin-token': '' } }), false);
});

test('mechanics AI answers instead of crashing on its cache', async () => {
  const result = await call(mechanicsAi, { method: 'POST', body: { symbol: 'BTCUSDT', interval: '5m' } });
  assert.notEqual(result.status, 'threw', String(result.error));
  assert.ok([200, 502, 503].includes(result.status));
});

test('in production paid AI never runs without accounts', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.GROQ_API_KEY = 'g';
  try {
    const result = await call(mechanicsAi, { method: 'POST', body: { symbol: 'BTCUSDT', interval: '5m' } });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /contas/);
  } finally {
    delete process.env.VERCEL_ENV;
    delete process.env.GROQ_API_KEY;
  }
});

test('the deployment stays within the 12 functions Vercel Hobby allows', async () => {
  const { readdirSync } = await import('node:fs');
  const functions = readdirSync(new URL('../api/', import.meta.url)).filter(f => f.endsWith('.js'));
  assert.ok(functions.length <= 12, `${functions.length} functions: ${functions.join(', ')}`);
});
