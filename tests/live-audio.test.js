import test from 'node:test';
import assert from 'node:assert/strict';
import { downsampleTo16k, floatToPcm16, pcm16ToFloat } from '../src/lib/live-audio.js';

test('resamples 48 kHz mono input to 16 kHz', () => {
  const input = new Float32Array(48000).fill(0.25);
  const output = downsampleTo16k(input, 48000);
  assert.equal(output.length, 16000);
  assert.ok(output.every(value => Math.abs(value - 0.25) < 1e-6));
});

test('converts float audio to signed little-endian PCM16 and back', () => {
  const pcm = floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));
  assert.equal(pcm.length, 10);
  const decoded = pcm16ToFloat(pcm);
  assert.equal(decoded.length, 5);
  assert.ok(Math.abs(decoded[0] + 1) < 1e-5);
  assert.ok(Math.abs(decoded[3] - 0.5) < 1e-4);
  assert.ok(decoded[4] > 0.99);
});
