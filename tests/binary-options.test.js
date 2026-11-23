import test from 'node:test';
import assert from 'node:assert/strict';
import { binaryBreakEvenRate, wilsonLowerBound, evaluateBinaryOpportunity } from '../api/_lib/quant/binary-options.js';

test('binary break-even rate reflects broker net payout', () => {
  assert.ok(Math.abs(binaryBreakEvenRate(80) - 0.5555556) < 1e-6);
  assert.equal(binaryBreakEvenRate(0), null);
});

test('Wilson lower bound is below the observed win rate', () => {
  assert.ok(wilsonLowerBound(80, 100) < 0.8);
  assert.equal(wilsonLowerBound(0, 0), null);
});

test('binary gate waits for independent samples matching the exact expiry', () => {
  const result = evaluateBinaryOpportunity({
    direction: 1, payoutPercent: 80, wins: 90, samples: 40,
    expirySeconds: 60, calibratedExpirySeconds: 60, quoteAgeMs: 100
  });
  assert.equal(result.action, 'AGUARDAR');
  assert.match(result.reason, /amostra histórica/i);
});

test('binary gate refuses OTC quotes without the broker-specific feed', () => {
  const result = evaluateBinaryOpportunity({
    direction: -1, payoutPercent: 85, wins: 950, samples: 1000,
    expirySeconds: 60, calibratedExpirySeconds: 60, quoteAgeMs: 100, isOtc: true
  });
  assert.equal(result.action, 'AGUARDAR');
  assert.match(result.reason, /OTC/i);
});

test('binary gate rejects stale quotes and mismatched expiry horizons', () => {
  const base = {
    direction: 1, payoutPercent: 80, wins: 900, samples: 1000,
    expirySeconds: 60, calibratedExpirySeconds: 300, quoteAgeMs: 100
  };
  assert.equal(evaluateBinaryOpportunity(base).action, 'AGUARDAR');
  assert.equal(evaluateBinaryOpportunity({ ...base, calibratedExpirySeconds: 60, quoteAgeMs: 9000 }).action, 'AGUARDAR');
});

test('binary gate does not treat a high observed win rate as enough if conservative edge is weak', () => {
  const result = evaluateBinaryOpportunity({
    direction: 1, payoutPercent: 90, wins: 620, samples: 1000,
    expirySeconds: 60, calibratedExpirySeconds: 60, quoteAgeMs: 100
  });
  assert.equal(result.action, 'AGUARDAR');
});

test('binary gate only emits CALL/PUT when conservative edge clears break-even', () => {
  const result = evaluateBinaryOpportunity({
    direction: 1, payoutPercent: 80, wins: 800, samples: 1000,
    expirySeconds: 60, calibratedExpirySeconds: 60, quoteAgeMs: 100
  });
  assert.equal(result.action, 'CALL');
  assert.ok(result.lowerWinRate > result.breakEvenRate);
});
