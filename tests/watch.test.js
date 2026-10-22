import test from 'node:test';
import assert from 'node:assert/strict';
import { frameSignature, frameDiff, shouldSend, createStabilizer } from '../src/lib/watch-core.js';

test('frame signature and diff detect a changed picture', () => {
  const a = frameSignature(new Uint8ClampedArray(4 * 100).fill(100));
  const b = frameSignature(new Uint8ClampedArray(4 * 100).fill(100));
  const c = frameSignature(new Uint8ClampedArray(4 * 100).fill(140));
  assert.equal(frameDiff(a, b), 0);
  assert.ok(frameDiff(a, c) > 30);
  assert.equal(frameDiff(a, null), 255);
});

test('frames are sent on change after the minimum gap, or as a heartbeat', () => {
  assert.equal(shouldSend({ now: 0, lastSentAt: null, diff: 0 }), true);
  assert.equal(shouldSend({ now: 5000, lastSentAt: 0, diff: 50 }), false, 'too soon');
  assert.equal(shouldSend({ now: 9000, lastSentAt: 0, diff: 0.5 }), false, 'nothing changed');
  assert.equal(shouldSend({ now: 9000, lastSentAt: 0, diff: 4 }), true, 'chart changed');
  assert.equal(shouldSend({ now: 46000, lastSentAt: 0, diff: 0 }), true, 'heartbeat');
});

test('stabilizer confirms a new direction twice but moves to caution at once', () => {
  const s = createStabilizer({ confirmations: 2 });
  let step = s.push('COMPRAR');
  assert.equal(step.shown, 'AGUARDAR', 'even the first trade waits for a second reading');
  assert.equal(step.pending, 'COMPRAR');
  assert.equal(s.push('COMPRAR').shown, 'COMPRAR');
  step = s.push('VENDER');
  assert.equal(step.shown, 'COMPRAR');
  assert.equal(step.pending, 'VENDER');
  step = s.push('VENDER');
  assert.equal(step.shown, 'VENDER');
  assert.equal(step.changed, true);
  step = s.push('AGUARDAR');
  assert.equal(step.shown, 'AGUARDAR', 'caution is immediate');
  step = s.push('COMPRAR', { chartVisible: false });
  assert.equal(step.noChart, true);
  assert.equal(step.shown, 'AGUARDAR', 'frames without a chart never change the advice');
  s.push('COMPRAR');
  assert.equal(s.push('VENDER').shown, 'AGUARDAR', 'mixed signals keep waiting');
});

test('a different market on screen starts the confirmation again', () => {
  const s = createStabilizer({ confirmations: 2 });
  s.push('COMPRAR', { context: 'BTC/USDT|M5' });
  assert.equal(s.push('COMPRAR', { context: 'BTC/USDT|M5' }).shown, 'COMPRAR');
  const step = s.push('VENDER', { context: 'EUR/USD|M1' });
  assert.equal(step.contextChanged, true);
  assert.equal(step.shown, 'AGUARDAR', 'no trade carried over from the previous market');
  assert.equal(step.pending, 'VENDER');
});

test('a strong reading is shown at once; a normal one still waits for its confirmation', async () => {
  const { createStabilizer } = await import('../src/lib/watch-core.js');
  const s = createStabilizer({ confirmations: 2 });
  assert.equal(s.push('AGUARDAR', { context: 'EURUSD|1m' }).shown, 'AGUARDAR');
  assert.equal(s.push('VENDER', { context: 'EURUSD|1m' }).shown, 'AGUARDAR', 'normal: waits');
  assert.equal(s.push('COMPRAR', { context: 'EURUSD|1m', strong: true }).shown, 'COMPRAR', 'strong: at once');
});
