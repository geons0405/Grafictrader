import test from 'node:test';
import assert from 'node:assert/strict';
import { apiKey } from '../api/_lib/env.js';

test('apiKey reads the correct name and the misspelled _KAY name', () => {
  delete process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KAY = 'from-kay';
  assert.equal(apiKey('GEMINI_API_KEY'), 'from-kay');
  process.env.GEMINI_API_KEY = 'from-key';
  assert.equal(apiKey('GEMINI_API_KEY'), 'from-key');
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KAY;
  assert.equal(apiKey('GEMINI_API_KEY'), undefined);
});
