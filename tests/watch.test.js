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
  assert.equal(s.push('COMPRAR').shown, 'COMPRAR');
  let step = s.push('VENDER');
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
