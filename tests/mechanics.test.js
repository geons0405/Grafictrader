import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLiquidityMemory } from '../api/_lib/mechanics/liquidity.js';
import { analyzeMarketMechanics } from '../api/_lib/mechanics/index.js';
import { buildMechanicsMemory } from '../api/_lib/mechanics/memory.js';
import { makeCandles } from './helpers.js';

test('liquidity resistance is not pinned at 100%', () => {
  const values = [1, 2, 3, 4, 5, 6].map(seed => calculateLiquidityMemory(makeCandles(60, { seed })).value);
  assert.ok(values.every(v => v >= 0 && v <= 1));
  assert.ok(values.some(v => v < 1), `expected variation, got ${values}`);
});

test('mechanics returns bounded metrics and a known state', () => {
  const result = analyzeMarketMechanics(makeCandles(120));
  for (const [key, value] of Object.entries(result.metrics)) {
    if (value == null || ['tradeFlow', 'orderBookImbalance', 'spreadBps'].includes(key)) continue;
    assert.ok(value >= 0 && value <= 100, `${key}=${value}`);
  }
  assert.match(result.state, /^[A-Z_]+$/);
});

test('micro absorption only uses trades from the current candle', () => {
  const candles = makeCandles(30);
  const lastOpenMs = candles.at(-1).time * 1000;
  const oldTrades = Array.from({ length: 50 }, (_, i) => ({ price: 100, quantity: 1, side: 'buy', time: lastOpenMs - 10_000 - i }));
  const result = analyzeMarketMechanics(candles, { trades: oldTrades });
  assert.equal(result.evidence.microAbsorption.value, null);
});

test('memory uses 12 windows for 240 candles and family matches never overlap the current pattern', () => {
  for (const seed of [3, 7, 11, 19]) {
    const memory = buildMechanicsMemory(makeCandles(240, { seed }));
    assert.equal(memory.timeline.length, 12);
    for (const match of memory.patternFamily?.matches || []) {
      assert.ok(match.endStep <= memory.timeline.length - 3, `overlap at ${match.endStep}`);
    }
  }
});
