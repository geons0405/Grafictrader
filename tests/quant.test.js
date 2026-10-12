import test from 'node:test';
import assert from 'node:assert/strict';
import { hurstExponent, varianceRatio, kalmanTrend, permutationEntropy, bulkVolume, normalCdf } from '../api/_lib/quant/stats.js';
import { quantSnapshot, decide } from '../api/_lib/quant/signal.js';
import { emptyState, advance, summarize, START_BALANCE } from '../api/_lib/quant/instructor.js';
import { mapAsset, mapTimeframe, normalizeVision, mergeVerdict } from '../api/_lib/quant/verdict.js';
import { buildContext } from '../api/_lib/quant/context.js';
import { makeCandles } from './helpers.js';

function gaussian(seed) {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
}

function ar1(phi, n, seed) {
  const g = gaussian(seed);
  const out = [];
  let prev = 0;
  for (let i = 0; i < n; i++) { prev = phi * prev + g(); out.push(prev); }
  return out;
}

test('corrected Hurst separates persistent, random and anti-persistent series', () => {
  const avg = phi => [1, 2, 3, 4, 5, 6, 7, 8].map(seed => hurstExponent(ar1(phi, 256, seed))).reduce((a, b) => a + b) / 8;
  const random = avg(0);
  assert.ok(random > 0.4 && random < 0.56, `random walk H=${random}`);
  assert.ok(avg(0.5) > random + 0.05, 'persistent series should read higher');
  assert.ok(avg(-0.5) < random - 0.02, 'anti-persistent series should read lower');
});

test('variance ratio reads momentum above 1 and reversion below 1', () => {
  assert.ok(varianceRatio(ar1(0.4, 400, 3)).value > 1.2);
  assert.ok(varianceRatio(ar1(-0.4, 400, 3)).value < 0.8);
});

test('Kalman drift sign follows the trend', () => {
  const up = Array.from({ length: 150 }, (_, i) => ({ close: 100 * Math.exp(0.002 * i + Math.sin(i) * 0.001) }));
  const down = Array.from({ length: 150 }, (_, i) => ({ close: 100 * Math.exp(-0.002 * i + Math.sin(i) * 0.001) }));
  assert.ok(kalmanTrend(up).z > 1);
  assert.ok(kalmanTrend(down).z < -1);
});

test('permutation entropy is low for monotonic and high for noise', () => {
  assert.ok(permutationEntropy(Array.from({ length: 100 }, (_, i) => i)) < 0.05);
  const g = gaussian(9);
  assert.ok(permutationEntropy(Array.from({ length: 400 }, g)) > 0.95);
});

test('bulk volume classification and normal CDF', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  const rising = Array.from({ length: 60 }, (_, i) => ({ close: 100 + i + (i % 3), volume: 10 }));
  assert.ok(bulkVolume(rising).imbalance > 0.2);
});

test('decision engine waits when there is no structure and respects live context vetoes', () => {
  assert.equal(decide(null).action, 'AGUARDAR');
  const snap = { regime: 'trend', kalmanZ: 3, flowImbalance: 0.3, price: 110, vwap: 100, entropy: 0.9, hurst: 0.62, volPercentile: 0.5 };
  assert.equal(decide(snap).action, 'COMPRAR');
  assert.equal(decide(snap, { score: -0.6 }).action, 'AGUARDAR');
  assert.equal(decide({ ...snap, regime: 'chaotic' }).action, 'AGUARDAR');
});

test('instructor is deterministic, never exits before entering, and balances add up', () => {
  const candles = makeCandles(700, { seed: 21 });
  const a = advance(emptyState('BTCUSDT', '5m'), candles);
  const b = advance(emptyState('BTCUSDT', '5m'), candles);
  assert.deepEqual(a.trades, b.trades);
  for (const t of a.trades) assert.ok(t.closedAt > t.openedAt);
  const sum = a.trades.reduce((s, t) => s + t.pnl, 0);
  assert.ok(Math.abs(START_BALANCE + sum - a.balance) < 0.05);
  assert.ok(quantSnapshot(candles));
});

test('advancing incrementally matches a single replay', () => {
  const candles = makeCandles(700, { seed: 33 });
  const full = advance(emptyState('BTCUSDT', '5m'), candles);
  let step = advance(emptyState('BTCUSDT', '5m'), candles.slice(0, 500));
  step = advance(step, candles.slice(0, 600));
  step = advance(step, candles);
  assert.deepEqual(step.trades, full.trades);
  assert.equal(summarize(step).balance, summarize(full).balance);
});

test('photo verdict merges vision with the live engine', () => {
  assert.equal(mapAsset('BTC/USDT'), 'BTCUSDT');
  assert.equal(mapAsset('ETHUSD perpétuo'), 'ETHUSDT');
  assert.equal(mapAsset('EUR/USD'), null);
  assert.equal(mapTimeframe('M15'), '15m');
  assert.equal(mapTimeframe('4H'), '4h');

  const vision = normalizeVision({ decisao: 'COMPRAR', confianca: 70 });
  const confirm = mergeVerdict(vision, { signal: { direction: 1, confidence: 70, regimeLabel: 'Tendência persistente' }, context: { score: 0.2 }, snapshot: { regime: 'trend' } });
  assert.equal(confirm.decision, 'COMPRAR');
  assert.equal(confirm.agreement, 'confirma');

  const diverge = mergeVerdict(vision, { signal: { direction: -1, confidence: 70, regimeLabel: 'Tendência persistente' }, context: { score: 0 }, snapshot: { regime: 'trend' } });
  assert.equal(diverge.decision, 'AGUARDAR');

  assert.equal(mergeVerdict(normalizeVision({ decisao: 'VENDER', confianca: 30 }), null).decision, 'AGUARDAR');
  assert.equal(mergeVerdict(normalizeVision({ decisao: 'VENDER', confianca: 75 }), null).decision, 'VENDER');
});

test('live context weighs flow, book and news', () => {
  const now = Date.now();
  const trades = Array.from({ length: 50 }, (_, i) => ({ price: 100, quantity: 1, side: i < 40 ? 'buy' : 'sell', time: now }));
  const orderBook = { bids: [{ price: 99, quantity: 5 }], asks: [{ price: 101, quantity: 1 }] };
  const news = [{ sentiment: 'bullish', timestamp: new Date(now).toISOString() }];
  const ctx = buildContext({ trades, orderBook, news });
  assert.ok(ctx.score > 0.5 && ctx.score <= 1);
});

function openTrade(side, entry, stop, target, cost = 0) {
  return { side, entry, stop, initialStop: stop, target, openedAt: 1, bars: 0, setup: 'trend', confidence: 60, reasons: [], cost };
}

test('a candle that opens past the stop fills at the open, not at the stop', () => {
  const state = { ...emptyState('BTCUSDT', '5m'), lastTime: 100, position: openTrade(1, 100, 98, 104) };
  const gap = [{ time: 200, open: 95, high: 96, low: 94, close: 95.5, volume: 1 }];
  const after = advance(state, gap);
  const trade = after.trades.at(-1);
  assert.equal(trade.exit, 95);
  assert.equal(trade.r, -2.5);
  assert.match(trade.exitReason, /salto/);
});

test('every trade pays its round-trip cost in R', () => {
  // Risk 2 (1%) and cost 0.1% of 100 = 0.1 → 0.05R off the result.
  const state = { ...emptyState('BTCUSDT', '5m'), lastTime: 100, position: openTrade(1, 100, 98, 104, 0.001) };
  const after = advance(state, [{ time: 200, open: 101, high: 105, low: 100.5, close: 104.5, volume: 1 }]);
  const trade = after.trades.at(-1);
  assert.equal(trade.r, 1.95);
  assert.equal(trade.costR, 0.05);
});

test('an open position is managed even on candles older than the warm-up window', () => {
  // The saved state is older than every candle fetched now (nobody opened the app for days).
  const candles = makeCandles(300, { seed: 7 });
  // Stop and target far away: only the 24-candle time limit can close it.
  const state = { ...emptyState('BTCUSDT', '5m'), lastTime: candles[0].time - 5000, position: openTrade(1, candles[0].close, -1e9, 1e9) };
  const after = advance(state, candles);
  assert.ok(after.trades.length >= 1, 'closed by time instead of being skipped');
  assert.ok(after.trades[0].closedAt <= candles[30].time);
  assert.ok(after.log.some(l => /Pausa/.test(l.text)));
});

test('summary reports expectancy, drawdown and the cost used', () => {
  const s = summarize(advance(emptyState('BTCUSDT', '5m'), makeCandles(700, { seed: 21 })));
  assert.ok('expectancyR' in s && 'maxDrawdownPct' in s);
  assert.ok(s.maxDrawdownPct >= 0);
  assert.equal(s.costPct, 0.08);
});

test('a flat market is neither extreme volatility nor overbought', async () => {
  const { volatilityRegime } = await import('../api/_lib/quant/stats.js');
  const { rsi } = await import('../api/_lib/council/math.js');
  const flat = Array.from({ length: 100 }, (_, i) => ({ time: i, open: 100, high: 100.1, low: 99.9, close: 100, volume: 1 }));
  assert.equal(volatilityRegime(flat).percentile, 0.5);
  assert.equal(rsi(Array(30).fill(100)), 50);
});
