import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
let klines = [];
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
  if (String(url).includes('/klines')) {
    return new Response(JSON.stringify(klines.map(c => [c.time * 1000, String(c.open), String(c.high), String(c.low), String(c.close), '1'])), { status: 200 });
  }
  return new Response('[]', { status: 200 });
};
process.env.KV_REST_API_URL = 'http://kv.test';
process.env.KV_REST_API_TOKEN = 'x';

const { judgeSignal, recordSignal, verifySignals, recentSignals, signalStats } = await import('../api/_lib/signals.js');
const { default: instructorApi } = await import('../api/instructor.js');

const bar = (time, open, high, low, close) => ({ time, open, high, low, close });

test('a signal is judged by what the price did next, stop first when both are hit', () => {
  const buy = { at: 0, side: 1, entry: 100, stop: 97, target: 106 };
  assert.deepEqual(judgeSignal(buy, [bar(60, 100, 107, 99, 106)]), { outcome: 'win', r: 2, bars: 1 });
  assert.equal(judgeSignal(buy, [bar(60, 100, 107, 96, 100)]).outcome, 'loss', 'both touched: counts as the stop');
  assert.equal(judgeSignal(buy, [bar(60, 95, 96, 94, 95)]).r, -1.67, 'a gap fills at the open');
  assert.equal(judgeSignal(buy, [bar(60, 100, 101, 99, 100)]), null, 'still open before the horizon');
  const flatBars = Array.from({ length: 24 }, (_, i) => bar(60 * (i + 1), 100, 100.5, 99.5, 100.6));
  assert.deepEqual(judgeSignal(buy, flatBars), { outcome: 'win', r: 0.2, bars: 24 });
});

test('the live watch records one signal per market and candle, then settles it', async () => {
  const at = Math.floor(Date.now() / 1000) - 3 * 3600;
  assert.equal(await recordSignal({ source: 'corretora', symbol: 'BTCUSDT', interval: '5m', side: 1, price: 100, atr: 2, at }), true);
  assert.equal(await recordSignal({ source: 'corretora', symbol: 'BTCUSDT', interval: '5m', side: 1, price: 100.1, atr: 2, at: at + 5 }), false, 'same candle: counted once');
  assert.equal(await recordSignal({ source: 'foto', symbol: 'BTCUSDT', interval: '5m', side: -1, price: 100, atr: 0, at }), false, 'no ATR: nothing to measure');
  klines = [bar(at + 300, 100, 106.5, 99, 106)];
  assert.equal(await verifySignals(), 1);
  const [signal] = await recentSignals(2);
  assert.equal(signal.outcome, 'win');
  const stats = signalStats(await recentSignals(2));
  assert.equal(stats.total.settled, 1);
  assert.equal(stats['source:corretora'].winRate, 100);
});

test('the public track record lists results without any user data', async () => {
  const result = await new Promise(resolve => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ status: this.code, body: b }); return this; } };
    instructorApi({ method: 'GET', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { signals: '1' } }, res);
  });
  assert.equal(result.status, 200);
  assert.ok(result.body.stats.total);
  assert.deepEqual(Object.keys(result.body.recent[0]).sort(), ['at', 'entry', 'interval', 'outcome', 'r', 'side', 'source', 'symbol']);
});

test('signals recorded at the same time are all kept', async () => {
  const at = Math.floor(Date.now() / 1000) - 7200;
  const symbols = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];
  await Promise.all(symbols.map(symbol => recordSignal({ source: 'foto', symbol, interval: '1h', side: 1, price: 10, atr: 1, at })));
  const kept = (await recentSignals(1)).filter(s => s.at === at && s.source === 'foto');
  assert.equal(kept.length, symbols.length);
});
