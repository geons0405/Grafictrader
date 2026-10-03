import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGdeltDate } from '../api/_lib/sources/gdelt.js';

test('GDELT seendate is parsed instead of falling back to now', () => {
  assert.equal(parseGdeltDate('20261003T120000Z'), '2026-10-03T12:00:00.000Z');
});

test('invalid GDELT dates fall back to a valid ISO string', () => {
  assert.ok(!Number.isNaN(new Date(parseGdeltDate('garbage')).getTime()));
});
