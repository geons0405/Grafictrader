import test from 'node:test';
import assert from 'node:assert/strict';
import { lastCandlePatterns, patternSentence } from '../api/_lib/quant/patterns.js';
import { explainPlain } from '../api/_lib/quant/explain.js';

const falling = [105, 104, 103, 102, 101, 100].map(c => ({ open: c + 0.8, high: c + 1, low: c - 0.2, close: c }));
const rising = [100, 101, 102, 103, 104, 105].map(c => ({ open: c - 0.8, high: c + 0.2, low: c - 1, close: c }));
const hammer = { open: 99.6, high: 100, low: 96, close: 99.9 };

test('a hammer after a fall is a bullish reversal; the same candle after a rally is not', () => {
  assert.deepEqual(lastCandlePatterns([...falling, hammer]), [{ id: 'hammer', label: 'Martelo', side: 1 }]);
  assert.ok(!lastCandlePatterns([...rising, { ...hammer, open: 105.6, high: 106, low: 102, close: 105.9 }]).some(p => p.id === 'hammer'));
});

test('engulfing at the end of a rally is found only on the last candle', () => {
  const engulf = { open: 105.4, high: 105.6, low: 103.5, close: 103.8 };
  const found = lastCandlePatterns([...rising, { open: 104.9, high: 105.5, low: 104.8, close: 105.3 }, engulf]);
  assert.ok(found.some(p => p.id === 'bearishEngulfing'));
  assert.deepEqual(lastCandlePatterns([...rising, { open: 104.9, high: 105.5, low: 104.8, close: 105.3 }, engulf, ...rising.map(c => ({ ...c, open: c.open + 2, high: c.high + 2, low: c.low + 2, close: c.close + 2 }))]).filter(p => p.id === 'bearishEngulfing'), []);
});

test('the explanation says whether the last candle confirms or contradicts the call', () => {
  const patterns = [{ id: 'hammer', label: 'Martelo', side: 1 }];
  assert.match(patternSentence(patterns, 1), /confirma/);
  assert.match(patternSentence(patterns, -1), /contrário/);
  const wait = explainPlain({ decision: { direction: 0 }, snapshot: {}, context: {}, plan: null, patterns });
  assert.ok(wait.why.some(line => /Martelo/.test(line)));
  assert.equal(patternSentence([], 1), null);
});
