import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBinaryOptions, wilsonLowerBound } from '../api/_lib/quant/binary-options.js';

const base = {
  vision: { direction: 1 },
  verdict: { direction: 1, decision: 'COMPRAR' },
  reading: {
    symbol: 'BTCUSDT',
    interval: '1m',
    snapshot: { regime: 'trend' },
    signal: { direction: 1 },
    context: {}
  },
  expirySeconds: 60,
  payoutPercent: 80
};

test('binary options never invents a win probability without exact out-of-sample calibration', () => {
  const result = evaluateBinaryOptions(base);
  assert.equal(result.status, 'WAIT');
  assert.equal(result.validated, false);
  assert.equal(result.probability, null);
});

test('binary options blocks a direction mismatch between visual and quantitative engines', () => {
  const result = evaluateBinaryOptions({
    ...base,
    reading: { ...base.reading, signal: { direction: -1 } }
  });
  assert.equal(result.status, 'WAIT');
  assert.equal(result.decision, 'AGUARDAR');
});

test('binary options rejects expiry shorter than the candle timeframe', () => {
  const result = evaluateBinaryOptions({ ...base, expirySeconds: 30 });
  assert.equal(result.status, 'WAIT');
});

test('binary options requires a sufficiently large independent sample', () => {
  const result = evaluateBinaryOptions({
    ...base,
    calibration: { outOfSample: true, market: 'BTCUSDT', interval: '1m', expirySeconds: 60, settled: 80, wins: 75 }
  });
  assert.equal(result.status, 'WAIT');
  assert.equal(result.sampleSize, undefined);
});

test('binary options validates only when the exact calibration clears payout break-even plus edge', () => {
  const result = evaluateBinaryOptions({
    ...base,
    calibration: { outOfSample: true, market: 'BTCUSDT', interval: '1m', expirySeconds: 60, settled: 1000, wins: 900 }
  });
  assert.equal(result.status, 'VALIDATED_SETUP');
  assert.equal(result.decision, 'CALL');
  assert.equal(result.validated, true);
  assert.ok(result.calibratedLowerBound > result.breakEvenProbability + 0.03);
});

test('Wilson lower bound is below the observed win rate', () => {
  assert.ok(wilsonLowerBound(90, 100) < 0.9);
});
