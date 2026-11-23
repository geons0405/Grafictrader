import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVision, mergeVerdict } from '../api/_lib/quant/verdict.js';
import { decide } from '../api/_lib/quant/signal.js';

test('a high-confidence visual BUY is blocked when the chart trend is down', () => {
  const vision = normalizeVision({ decisao: 'COMPRAR', confianca: 92, tendencia: 'baixa' });
  const verdict = mergeVerdict(vision, null);
  assert.equal(verdict.decision, 'AGUARDAR');
  assert.ok(verdict.reasons.some(reason => reason.includes('tendência visível é de baixa')));
});

test('a quantitative SELL blocks a visual BUY even when visual confidence is high', () => {
  const vision = normalizeVision({ decisao: 'COMPRAR', confianca: 95, tendencia: 'indefinida' });
  const reading = { signal: { direction: -1, confidence: 80 }, snapshot: { regime: 'trend', kalmanZ: -1.8 }, context: { score: 0 } };
  const verdict = mergeVerdict(vision, reading);
  assert.equal(verdict.decision, 'AGUARDAR');
  assert.equal(verdict.agreement, 'diverge');
  assert.ok(verdict.reasons.some(reason => reason.includes('quantitativos ao vivo')));
});

test('a visual SELL is blocked when the chart trend is up', () => {
  const vision = normalizeVision({ decisao: 'VENDER', confianca: 88, tendencia: 'alta' });
  assert.equal(mergeVerdict(vision, null).decision, 'AGUARDAR');
});

test('mean-reversion BUY waits while Kalman momentum is still strongly down', () => {
  const snap = {
    regime: 'reversion', vwapZ: -2.8, flowImbalanceShort: 0.3,
    kalmanZ: -1.4, hurst: 0.4, movePct: -2.1
  };
  const result = decide(snap);
  assert.equal(result.direction, 0);
  assert.equal(result.action, 'AGUARDAR');
});

test('mean-reversion SELL waits while Kalman momentum is still strongly up', () => {
  const snap = {
    regime: 'reversion', vwapZ: 2.8, flowImbalanceShort: -0.3,
    kalmanZ: 1.4, hurst: 0.4, movePct: 2.1
  };
  const result = decide(snap);
  assert.equal(result.direction, 0);
  assert.equal(result.action, 'AGUARDAR');
});
