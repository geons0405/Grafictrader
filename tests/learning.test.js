import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const sorted = new Map();
let failReads = false;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://learning.test')) {
    const [command, key, value, ...args] = JSON.parse(init.body);
    let result = null;
    if (command === 'GET') {
      if (failReads && !String(key).endsWith(':lock')) return new Response('temporary redis error', { status: 503 });
      result = store.get(key) ?? null;
    }
    if (command === 'SET') {
      if (args.includes('NX') && store.has(key)) result = null;
      else { store.set(key, value); result = 'OK'; }
    }
    if (command === 'DEL') { store.delete(key); result = 1; }
    if (command === 'ZADD') {
      const rows = sorted.get(key) || new Map();
      rows.set(args[0], Number(value));
      sorted.set(key, rows);
      result = 1;
    }
    if (command === 'ZREM') {
      const rows = sorted.get(key) || new Map();
      result = rows.delete(value) ? 1 : 0;
    }
    if (command === 'ZRANGEBYSCORE') {
      const rows = [...(sorted.get(key) || new Map()).entries()]
        .filter(([, score]) => score <= Number(value))
        .sort((a, b) => a[1] - b[1]);
      const limitAt = args.indexOf('LIMIT');
      result = limitAt >= 0 ? rows.slice(Number(args[limitAt + 1]), Number(args[limitAt + 1]) + Number(args[limitAt + 2])).map(([member]) => member) : rows.map(([member]) => member);
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  }
  return new Response('offline', { status: 503 });
};
process.env.KV_REST_API_URL = 'http://learning.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const { learnFromObservation, getLearningSummary, wilsonLower, wilsonUpper, settleDueLearning } = await import('../api/_lib/journal.js');

test('learning stores compact predictions and settles them against later observed prices', async () => {
  store.clear(); sorted.clear(); failReads = false;
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

test('skills are frozen from training data and validated only on later out-of-sample trades', async () => {
  store.clear(); sorted.clear(); failReads = false;
  const user = 'skills@example.com';
  const market = 'ETHUSDT|1m';
  let now = 2_000_000;
  async function add(regime, price) {
    await learnFromObservation(user, {
      market, price: 100, at: now,
      prediction: { mode: 'market', direction: 1, confidence: 70, interval: '1m', regime, features: { kalmanZ: regime === 'trend' ? 1.4 : -1.4, flowImbalance: regime === 'trend' ? 0.12 : -0.12, vwapZ: 1.8, entropy: 0.91, volPercentile: 0.4 }, entryPrice: 100, horizonMs: 30_000 }
    });
    await learnFromObservation(user, { market, price, at: now + 30_000 });
    now += 60_000;
  }
  for (let i = 0; i < 100; i++) await add('trend', 101);
  for (let i = 0; i < 100; i++) await add('range', 99);
  let summary = await getLearningSummary(user, market);
  assert.equal(summary.skills.length, 2);
  const support = summary.skills.find(s => s.action === 'support');
  const avoid = summary.skills.find(s => s.action === 'avoid');
  assert.ok(support && avoid);
  assert.equal(support.status, 'validating');
  assert.equal(support.validation.samples, 0);
  assert.equal(support.autoApplied, false);
  for (let i = 0; i < 100; i++) await add('trend', 101);
  for (let i = 0; i < 100; i++) await add('range', 99);
  summary = await getLearningSummary(user, market);
  const validatedSupport = summary.skills.find(s => s.action === 'support');
  const validatedAvoid = summary.skills.find(s => s.action === 'avoid');
  assert.equal(validatedSupport.status, 'validated');
  assert.equal(validatedAvoid.status, 'validated_avoid');
  assert.equal(validatedSupport.validation.samples, 100);
  assert.equal(validatedAvoid.validation.samples, 100);
  assert.equal(validatedSupport.autoApplied, false);
  assert.match(validatedSupport.featureInsight, /deriva de Kalman positiva/);
});

test('scheduled worker settles regular market predictions and excludes unverified binary quotes', async () => {
  store.clear(); sorted.clear(); failReads = false;
  const user = 'worker@example.com';
  const market = 'BTCUSDT|1h';
  await learnFromObservation(user, {
    market, price: 100, at: 4_000_000,
    prediction: { mode: 'market', direction: 1, confidence: 75, interval: '1h', regime: 'trend', entryPrice: 100, horizonMs: 3_600_000 }
  });
  await learnFromObservation(user, {
    market: 'EURUSD|1m', price: 1.1, at: 4_000_000,
    prediction: { mode: 'binary-options', direction: 1, confidence: 80, interval: '1m', regime: 'trend', entryPrice: 1.1, expirySeconds: 60 }
  });
  const result = await settleDueLearning({
    now: 7_700_000,
    getPrice: async () => ({ price: 101, at: 7_700_000 })
  });
  assert.equal(result.settled, 2);
  const regular = await getLearningSummary(user, market);
  assert.equal(regular.wins, 1);
  const binary = await getLearningSummary(user, 'EURUSD|1m');
  assert.equal(binary.unverified, 1);
  assert.equal(binary.wins, 0);
});

test('concurrent updates are serialized and a Redis read failure cannot erase history', async () => {
  store.clear(); sorted.clear(); failReads = false;
  const user = 'concurrent@example.com';
  const market = 'BTCUSDT|5m';
  const make = (direction, at) => ({
    market, price: 100, at,
    prediction: { mode: 'market', direction, confidence: 70, interval: '5m', regime: 'trend', entryPrice: 100, horizonMs: 60_000 }
  });
  await Promise.all([
    learnFromObservation(user, make(1, 3_000_000)),
    learnFromObservation(user, make(-1, 3_000_000))
  ]);
  const before = await getLearningSummary(user, market);
  assert.equal(before.pending, 2);
  failReads = true;
  await assert.rejects(() => learnFromObservation(user, { market, price: 101, at: 3_060_000 }));
  failReads = false;
  const after = await getLearningSummary(user, market);
  assert.equal(after.pending, 2);
});

test('Wilson bounds are conservative', () => {
  assert.ok(wilsonLower(18, 20) < 0.9);
  assert.ok(wilsonUpper(2, 20) > 0.1);
  assert.equal(wilsonLower(0, 0), 0);
  assert.equal(wilsonUpper(0, 0), 1);
});
