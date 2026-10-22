import test from 'node:test';
import assert from 'node:assert/strict';
import { runInstructor, marketReading } from '../api/_lib/quant/service.js';
import { runEngine } from '../api/_lib/engine/index.js';
import { buildMechanicsSnapshot } from '../api/_lib/mechanics/snapshot.js';
import { getYahooTicker } from '../api/_lib/sources/yahoo.js';
import { parseMarketQuery } from '../api/_lib/validate.js';
import { formatPrice, marketLabel } from '../api/_lib/markets.js';
import { rng } from '../api/_lib/engine/core.js';

const STEP = { '1m': 60, '5m': 300, '15m': 900, '60m': 3600, '1d': 86400, '1wk': 604800 };

/** Answers Yahoo chart requests with a random walk around `start`; Binance must never be asked. */
function yahooStub(start) {
  const calls = [];
  const fetch = async url => {
    const u = new URL(String(url?.url || url));
    calls.push(u.host + u.pathname);
    // Only the candle requests (period1); index and dollar-index lookups by range are not served.
    if (!u.pathname.includes('/v8/finance/chart/') || !u.searchParams.get('period1')) return new Response('{}', { status: 500 });
    const step = STEP[u.searchParams.get('interval')];
    const from = Number(u.searchParams.get('period1'));
    const now = Math.floor(Date.now() / 1000);
    const rand = rng(7);
    const timestamp = [];
    const close = [];
    let p = start;
    for (let t = Math.ceil(from / step) * step; t <= now; t += step) {
      p *= Math.exp((rand() - 0.5) * 0.002);
      timestamp.push(t);
      close.push(p);
    }
    const open = close.map((c, i) => close[i - 1] ?? c);
    const quote = { open, close, high: close.map((c, i) => Math.max(c, open[i]) * 1.0003), low: close.map((c, i) => Math.min(c, open[i]) * 0.9997), volume: close.map(() => 0) };
    const meta = { symbol: u.pathname.split('/').pop(), currency: 'USD', instrumentType: 'CURRENCY', gmtoffset: 0, timezone: 'GMT', exchangeTimezoneName: 'Europe/London', dataGranularity: u.searchParams.get('interval') };
    return new Response(JSON.stringify({ chart: { result: [{ meta, timestamp, indicators: { quote: [quote] } }], error: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

async function withYahoo(start, run) {
  const original = globalThis.fetch;
  const stub = yahooStub(start);
  globalThis.fetch = stub.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return stub.calls;
}

test('forex and gold are accepted wherever a market is asked for', () => {
  assert.deepEqual(parseMarketQuery({ symbol: 'eurusd', interval: '15m' }), { symbol: 'EURUSD', interval: '15m' });
  assert.deepEqual(parseMarketQuery({ symbol: 'XAUUSD', interval: '1h' }), { symbol: 'XAUUSD', interval: '1h' });
  assert.equal(parseMarketQuery({ symbol: 'AUDCAD', interval: '1h' }), null, 'a pair we do not read');
  assert.equal(parseMarketQuery({ symbol: 'BTCUSDT', interval: '5m' }).symbol, 'BTCUSDT');
});

test('currency pairs are written as rates, gold and crypto in dollars', () => {
  assert.equal(formatPrice('EURUSD', 1.084567), '1.08457');
  assert.equal(formatPrice('USDJPY', 151.2346), '151.235');
  assert.equal(formatPrice('XAUUSD', 2385.5), '$2,385.5');
  assert.equal(formatPrice('BTCUSDT', 64000), '$64,000');
  assert.equal(marketLabel('GBPUSD'), 'GBP/USD');
  assert.equal(marketLabel('XAUUSD'), 'Ouro (XAU/USD)');
  assert.equal(marketLabel('SOLUSDT'), 'SOL/USDT');
});

test('the demo robot, the engine and market mechanics run on forex with Yahoo data only', async () => {
  const calls = await withYahoo(1.08, async () => {
    const view = await runInstructor('EURUSD', '15m');
    assert.equal(view.ok, true);
    assert.ok(view.price > 1 && view.price < 1.2);
    assert.equal(view.orderBook, null, 'forex has no public order book');
    const text = [view.guidance.headline, view.guidance.now, ...view.guidance.why, ...view.guidance.steps].join(' ');
    assert.doesNotMatch(text, /\$/, 'no dollar sign on a currency rate');

    const engine = await runEngine('EURUSD', '15m');
    assert.equal(engine.layers.length, 8);
    assert.ok(engine.fusion.probabilityUp > 0 && engine.fusion.probabilityUp < 1);

    const mechanics = await buildMechanicsSnapshot('EURUSD', '15m');
    assert.equal(mechanics.ok, true);
    assert.equal(mechanics.dataQuality.trades, false);

    const reading = await marketReading('EURUSD', '5m');
    assert.equal(reading.symbol, 'EURUSD');
  });
  assert.ok(calls.some(c => c.includes('finance.yahoo.com')));
  assert.ok(!calls.some(c => /binance|bybit|okx|kraken/.test(c)), 'forex never asks a crypto exchange: ' + calls.filter(c => /binance/.test(c)).slice(0, 2));
});

test('gold and yen pairs keep their price scale; the ticker comes from hourly candles', async () => {
  await withYahoo(2400, async () => {
    const view = await runInstructor('XAUUSD', '1h');
    assert.ok(view.price > 2000);
    const ticker = await getYahooTicker('XAUUSD');
    assert.ok(ticker.price > 2000 && ticker.high24h >= ticker.low24h);
    assert.ok(Number.isFinite(ticker.change24h));
  });
  await withYahoo(151, async () => {
    const view = await runInstructor('USDJPY', '4h');
    assert.ok(view.price > 100);
  });
});
