import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCandles } from './helpers.js';

const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://kv.test')) {
    const [cmd, key, value, ...opts] = JSON.parse(init.body);
    let result = null;
    if (cmd === 'GET') result = store.get(key) ?? null;
    else if (cmd === 'SET') {
      if (opts.includes('NX') && store.has(key)) result = null;
      else { store.set(key, value); result = 'OK'; }
    } else if (cmd === 'DEL') result = store.delete(key) ? 1 : 0;
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.KV_REST_API_URL = 'http://kv.test';
process.env.KV_REST_API_TOKEN = 'x';

const { advanceStored } = await import('../api/_lib/quant/service.js');
const candles = makeCandles(700, { seed: 21 });

test('the stored robot advances under a lock and releases it', async () => {
  const state = await advanceStored('s1', 'l1', 'BTCUSDT', '5m', candles.slice(0, 600), null);
  assert.equal(JSON.parse(store.get('s1')).lastTime, state.lastTime);
  assert.equal(store.has('l1'), false);
});

test('without the lock the stored state is shown, never overwritten', async () => {
  store.set('l1', 'someone-else');
  const before = store.get('s1');
  const state = await advanceStored('s1', 'l1', 'BTCUSDT', '5m', candles, null);
  assert.equal(store.get('s1'), before);
  assert.equal(state.lastTime, JSON.parse(before).lastTime);
  assert.equal(store.get('l1'), 'someone-else', 'another owner keeps its lock');
  store.delete('l1');
});

test('an older candle window never rewinds the stored robot', async () => {
  await advanceStored('s1', 'l1', 'BTCUSDT', '5m', candles, null);
  const newest = JSON.parse(store.get('s1')).lastTime;
  await advanceStored('s1', 'l1', 'BTCUSDT', '5m', candles.slice(0, 500), null);
  assert.equal(JSON.parse(store.get('s1')).lastTime, newest);
});

test('the balance history sent to phones is small but keeps every change', async () => {
  const { thinEquity } = await import('../api/_lib/quant/service.js');
  const flat = Array.from({ length: 600 }, (_, i) => ({ time: i, value: i === 300 ? 1010 : i > 300 ? 1010 : 1000 }));
  const thin = thinEquity(flat);
  assert.ok(thin.length <= 201);
  assert.ok(thin.some(p => p.value === 1010) && thin.some(p => p.value === 1000));
  assert.equal(thin.at(-1).time, 599);
});
