import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, parseCookies, validEmail, normalizeEmail } from '../api/_lib/auth.js';
import { parseMarketQuery } from '../api/_lib/validate.js';

test('password hashing verifies the right password only', async () => {
  const { salt, hash } = await hashPassword('segredo123');
  assert.equal(await verifyPassword('segredo123', salt, hash), true);
  assert.equal(await verifyPassword('segredo124', salt, hash), false);
  assert.notEqual(hash, 'segredo123');
});

test('cookie parsing and email validation', () => {
  assert.deepEqual(parseCookies('a=1; gt_session=abc%2B; b=2'), { a: '1', gt_session: 'abc+', b: '2' });
  assert.equal(validEmail(normalizeEmail('  Ana@Example.COM ')), true);
  assert.equal(validEmail('not-an-email'), false);
});

test('market query only accepts supported symbols and intervals', () => {
  assert.deepEqual(parseMarketQuery({ symbol: 'ethusdt', interval: '1h' }), { symbol: 'ETHUSDT', interval: '1h' });
  assert.equal(parseMarketQuery({ symbol: 'FOOUSDT', interval: '1h' }), null);
  assert.equal(parseMarketQuery({ symbol: 'BTCUSDT', interval: '1d' }), null);
});
