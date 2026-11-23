import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://learning.test')) {
    const [command, key, value] = JSON.parse(init.body);
    let result = null;
    if (command === 'GET') result = store.get(key) ?? null;
    if (command === 'SET') { store.set(key, value); result = 'OK'; }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.KV_REST_API_URL = 'http://learning.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const { learnFromObservation, getLearningSummary, wilsonLower } = await import('../api/_lib/learning.js');

test('learning stores compact predictions and settles them against later observed prices', async () => {
  store.clear();
  const first = await learnFromObservation('user@example.com', {
    market: 'BTCUSDT|5m', price: 100, at: 1_000_000,
    prediction: { mode: 'market', direction: 1, confidence: 75, interval: '5m', regime: 'trend', entryPrice: 100, horizonMs: 30_000 }
  });
  assert.equal(first.recorded, true);
  const next = await learnFromObservation('user@example.com', {
    market: 'BTCUSDT|5m', price: 101, at: 1_030_000
  });
  assert.equal(next.settled, 1);
  const summary = await getLearningSummary('user@example.com', 'BTCUSDT|5m');
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 0);
  assert.equal(summary.pending, 0);
});

test('learning identifies losing predictions and creates a skill proposal only after enough evidence', async () => {
  store.clear();
  const user = 'skills@example.com';
  const market = 'ETHUSDT|1m';
  let now = 2_000_000;
  for (let i = 0; i < 20; i++) {
    await learnFromObservation(user, {
      market, price: 100, at: now,
      prediction: { mode: 'market', direction: 1, confidence: 65, interval: '1m', regime: 'range', entryPrice: 100, horizonMs: 30_000 }
    });
    const result = await learnFromObservation(user, { market, price: 99, at: now + 30_000 });
    assert.equal(result.settled, 1);
    now += 60_000;
  }
  const summary = await getLearningSummary(user, market);
  assert.equal(summary.losses, 20);
  assert.equal(summary.skills.length, 1);
  assert.equal(summary.skills[0].autoApplied, false);
  assert.equal(summary.skills[0].status, 'learning');
});

test('Wilson lower bound is conservative and invalid samples are rejected', () => {
  assert.ok(wilsonLower(18, 20) < 0.9);
  assert.equal(wilsonLower(0, 0), 0);
});
