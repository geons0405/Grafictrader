import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCandles } from './helpers.js';

// In-memory Upstash REST emulation behind a fetch stub.
const store = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://kv.test')) {
    const [cmd, key, value, ...opts] = JSON.parse(init.body);
    let result = null;
    if (cmd === 'GET') result = store.get(key) ?? null;
    else if (cmd === 'SET') {
      if (opts.includes('NX') && store.has(key)) result = null;
      else { store.set(key, value); result = 'OK'; }
    } else if (cmd === 'DEL') result = store.delete(key) ? 1 : 0;
    else if (cmd === 'INCR') { const v = Number(store.get(key) || 0) + 1; store.set(key, String(v)); result = v; }
    else if (cmd === 'EXPIRE') result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.KV_REST_API_URL = 'http://kv.test';
process.env.KV_REST_API_TOKEN = 'x';

const { createUser, createSession, rotateBridgeKey } = await import('../api/_lib/auth.js');
const { default: mt5 } = await import('../api/mt5.js');

function call(handler, { method = 'GET', query = {}, body = null, headers = {} }) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; }
    };
    handler({ method, query, body, headers }, res);
  });
}

test('MT5 bridge stores candles from the EA and serves them to the signed-in user', async () => {
  const user = await createUser({ name: 'Ana', email: 'ana@mt5.test', password: 'segredo123' });
  const token = await createSession(user);
  const key = await rotateBridgeKey(user.email);

  const rejected = await call(mt5, { method: 'POST', headers: { 'x-bridge-key': 'gtb_wrongwrongwrongwrongwrong' }, body: {} });
  assert.equal(rejected.status, 401);

  const candles = makeCandles(300, { start: 2650, interval: 300 }).map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  const full = await call(mt5, { method: 'POST', headers: { 'x-bridge-key': key }, body: { symbol: 'XAUUSD', timeframe: 'M5', kind: 'full', candles, bid: 2651.1, ask: 2651.4, digits: 2, broker: 'Demo Broker' } });
  assert.equal(full.status, 200);
  const last = candles.at(-1);
  const tick = await call(mt5, { method: 'POST', headers: { 'x-bridge-key': key }, body: { symbol: 'XAUUSD', timeframe: 'M5', kind: 'tick', candles: [[last[0], last[1], last[2] + 1, last[3], last[4] + 0.5, last[5]]], bid: 2652, ask: 2652.3, digits: 2 } });
  assert.equal(tick.status, 200);

  const cookie = { cookie: 'gt_session=' + encodeURIComponent(token) };
  const list = await call(mt5, { query: { symbols: '1' }, headers: cookie });
  assert.equal(list.body.symbols[0].symbol, 'XAUUSD');

  const read = await call(mt5, { query: { symbol: 'XAUUSD', timeframe: 'M5' }, headers: cookie });
  assert.equal(read.status, 200);
  assert.equal(read.body.candles.length, 300);
  assert.equal(read.body.candles.at(-1).close, last[4] + 0.5, 'live tick merged into the last candle');
  assert.ok(read.body.instructor?.guidance, 'AI guidance on the broker feed');

  const anonymous = await call(mt5, { query: { symbol: 'XAUUSD', timeframe: 'M5' }, headers: {} });
  assert.equal(anonymous.status, 401);

  const rotated = await rotateBridgeKey(user.email);
  const old = await call(mt5, { method: 'POST', headers: { 'x-bridge-key': key }, body: { symbol: 'XAUUSD', timeframe: 'M5', kind: 'tick', candles: [] } });
  assert.equal(old.status, 401, 'previous key revoked');
  assert.notEqual(rotated, key);
});

test.after(() => { globalThis.fetch = realFetch; });
