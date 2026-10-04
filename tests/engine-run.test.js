import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngine } from '../api/_lib/engine/index.js';
import { rng } from '../api/_lib/engine/core.js';

const rand = rng(3);
const g = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function klines(n, drift, start) {
  let p = start;
  const now = Date.now() - 5 * 60_000 * (n + 1);
  return Array.from({ length: n }, (_, i) => {
    const o = p; p = p * Math.exp(drift + g() * 0.002);
    return [now + i * 300_000, String(o), String(Math.max(o, p) * 1.0008), String(Math.min(o, p) * 0.9992), String(p), String(10 + rand() * 5)];
  });
}

test('the whole engine runs on market-shaped data and returns a full reading', async () => {
  const original = globalThis.fetch;
  const btc = klines(1000, 0.0002, 60000);
  globalThis.fetch = async url => {
    const u = String(url);
    let body;
    if (u.includes('/klines')) body = u.includes('BTCUSDT') ? btc : klines(1000, 0.0001, 3000);
    else if (u.includes('/aggTrades')) body = Array.from({ length: 1000 }, (_, i) => ({ a: i, p: String(60000 + i), q: String(rand()), T: Date.now() - (1000 - i) * 100, m: rand() < 0.4 }));
    else if (u.includes('/depth')) body = { bids: Array.from({ length: 100 }, (_, i) => [String(61000 - i), String(rand() * 3)]), asks: Array.from({ length: 100 }, (_, i) => [String(61001 + i), String(rand() * 2)]) };
    else return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const started = Date.now();
    const r = await runEngine('BTCUSDT', '5m');
    const ms = Date.now() - started;
    assert.equal(r.ok, true);
    assert.equal(r.layers.length, 8);
    assert.ok(['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(r.regime.code));
    assert.ok(r.fusion.structuralBias >= -100 && r.fusion.structuralBias <= 100);
    assert.ok(r.fusion.probabilityUp > 0 && r.fusion.probabilityUp < 1);
    assert.ok(r.validation.validated);
    assert.ok(Object.keys(r.validation.layers).length === 4);
    assert.ok(r.earlyWarning.state);
    assert.ok(r.intent.shares.length > 0);
    assert.equal(r.intent.shares.reduce((s, x) => s + x.pct, 0) >= 98, true);
    console.log('engine ms', ms, 'bias', r.fusion.structuralBias, 'regime', r.regime.code, 'early', r.earlyWarning.state);
    assert.ok(ms < 8000, `engine took ${ms} ms`);
  } finally {
    globalThis.fetch = original;
  }
});
