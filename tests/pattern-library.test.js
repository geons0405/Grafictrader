import test from 'node:test';
import assert from 'node:assert/strict';
import { updateLibrary, closedCandles, familyFingerprint, normalizeStored } from '../api/_lib/mechanics/pattern-library.js';
import { makeCandles } from './helpers.js';

const family = {
  id: 'LOW_INFORMATION_LOW_INFORMATION_ABSORPTION',
  label: 'LOW INFORMATION → LOW INFORMATION → ABSORPTION',
  occurrences: 2,
  avgSimilarity: 80,
  bestSimilarity: 85,
  basis: 'OHLCV_SIGNATURE_FAMILY',
  currentSignature: {},
  familySignature: { priceEfficiency: 20, movementEnergy: 50, structuralPressure: 70 },
  matches: [{ sequence: ['LOW_INFORMATION', 'LOW_INFORMATION', 'ABSORPTION'] }]
};

test('closedCandles drops the candle that is still forming', () => {
  const nowMs = Date.UTC(2026, 0, 1, 12, 2, 0);
  const candles = makeCandles(5, { endTime: Date.UTC(2026, 0, 1, 12, 0, 0) / 1000 });
  assert.equal(closedCandles(candles, '5m', nowMs).length, 4);
});

test('fingerprint is stable for small metric changes', () => {
  const a = familyFingerprint(family);
  const b = familyFingerprint({ ...family, familySignature: { priceEfficiency: 24, movementEnergy: 53, structuralPressure: 69 } });
  assert.equal(a, b);
});

test('observations persist across updates and outcomes resolve (regression: Math.max(array) = NaN)', () => {
  const interval = '5m';
  const step = 300;
  const t0 = Date.UTC(2026, 0, 1, 12, 0, 0) / 1000;
  let library = normalizeStored(null, 'BTCUSDT', interval);

  // First poll: record an observation on the last closed candle.
  const first = makeCandles(50, { endTime: t0 });
  library = updateLibrary(library, { family, candles: first, interval, nowMs: (t0 + step) * 1000 + 1000 }).library;
  assert.equal(library.observations.length, 1);
  assert.equal(library.patterns[0].occurrences, 1);

  // Second poll 13 candles later: the observation must still be there and resolve all horizons.
  const later = makeCandles(80, { endTime: t0 + 13 * step });
  const nowMs = (t0 + 14 * step) * 1000 + 1000;
  library = updateLibrary(library, { family, candles: later, interval, nowMs }).library;
  const original = library.observations.find(o => o.entryTime === t0);
  assert.ok(original, 'observation was dropped');
  assert.deepEqual(Object.keys(original.outcomes).sort(), ['12', '3', '6']);
  assert.equal(library.patterns[0].outcomes[12].samples, 1);
  assert.equal(library.patterns[0].occurrences, 2);
});

test('repeated polls on the same closed candle do not inflate occurrences', () => {
  const t0 = Date.UTC(2026, 0, 1, 12, 0, 0) / 1000;
  const candles = makeCandles(50, { endTime: t0 });
  const nowMs = (t0 + 300) * 1000 + 1000;
  let library = normalizeStored(null, 'BTCUSDT', '5m');
  for (let i = 0; i < 5; i++) library = updateLibrary(library, { family, candles, interval: '5m', nowMs }).library;
  assert.equal(library.observations.length, 1);
  assert.equal(library.patterns[0].occurrences, 1);
});
