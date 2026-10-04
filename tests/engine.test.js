import test from 'node:test';
import assert from 'node:assert/strict';
import { fPValue, rng, mean } from '../api/_lib/engine/core.js';
import { granger, leadLag, causalityLayer } from '../api/_lib/engine/causality.js';
import { sampleEntropy, permutationEntropy, transferEntropy, shannon } from '../api/_lib/engine/entropy.js';
import { fitHmm, changePoint, classifyRegime } from '../api/_lib/engine/regime.js';
import { dfa, higuchi } from '../api/_lib/engine/fractal.js';
import { mra, haarDwt } from '../api/_lib/engine/wavelet.js';
import { isolationForest, mahalanobis, robustZ, crossAsset } from '../api/_lib/engine/anomaly.js';
import { orderFlow, liquiditySweep, volumeProfile } from '../api/_lib/engine/micro.js';
import { volatilityLayer, estimators } from '../api/_lib/engine/volatility.js';

const rand = rng(42);
const gaussian = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const noise = (n, s = 1) => Array.from({ length: n }, () => gaussian() * s);
const candlesFrom = (returns, start = 100, volume = () => 10) => {
  let p = start;
  return returns.map((r, i) => {
    const open = p; p = p * Math.exp(r);
    const hi = Math.max(open, p) * (1 + Math.abs(r) * 0.3 + 0.0005), lo = Math.min(open, p) * (1 - Math.abs(r) * 0.3 - 0.0005);
    return { time: i * 300, open, high: hi, low: lo, close: p, volume: volume(i) };
  });
};

test('F distribution p-values', () => {
  assert.ok(Math.abs(fPValue(1, 2, 100) - 0.371) < 0.01);
  assert.ok(fPValue(10, 2, 100) < 0.001);
});

test('Granger finds x → y and not y → x', () => {
  const x = noise(400);
  const y = x.map((_, t) => (t ? 0.6 * x[t - 1] : 0) + gaussian() * 0.5);
  assert.ok(granger(x, y, 2).p < 0.001);
  assert.ok(granger(y, x, 2).p > 0.05);
  assert.equal(leadLag(x, y, 3).lag, 1);
  assert.ok(transferEntropy(x, y) > transferEntropy(y, x));
});

test('causality layer builds the influence graph', () => {
  const lead = noise(400, 0.01);
  const follow = lead.map((_, t) => (t ? 0.7 * lead[t - 1] : 0) + gaussian() * 0.004);
  const layer = causalityLayer({ LEADER: candlesFrom(lead), TARGET: candlesFrom(follow) }, 'TARGET');
  assert.ok(layer.metrics.edges.some(e => e.from === 'LEADER' && e.to === 'TARGET'));
});

test('entropy: regular series are less entropic than noise', () => {
  const sine = Array.from({ length: 200 }, (_, i) => Math.sin(i / 3));
  const white = noise(200);
  assert.ok(sampleEntropy(sine) < sampleEntropy(white));
  assert.equal(permutationEntropy(Array.from({ length: 100 }, (_, i) => i)), 0);
  assert.ok(shannon(white) > 0.95);
});

test('HMM finds the turbulent state after a volatility jump', () => {
  const x = [...noise(150, 0.001), ...noise(100, 0.01)];
  const h = fitHmm(x, 2);
  assert.equal(h.state, 1);
  assert.ok(h.variances[1] > h.variances[0] * 10);
});

test('change-point locates a variance break', () => {
  const x = [...noise(100, 0.001), ...noise(50, 0.01)];
  const cp = changePoint(x);
  assert.ok(cp.significant);
  assert.ok(Math.abs(cp.barsAgo - 50) <= 6);
});

test('regime classifier', () => {
  assert.equal(classifyRegime({ compression: true }), 'E');
  assert.equal(classifyRegime({ trendStrength: 2, hurst: 0.6 }), 'A');
  assert.equal(classifyRegime({ recentMove: 0.2, cvdSlope: 0.3, trendStrength: 0.2 }), 'C');
  assert.equal(classifyRegime({ volPercentile: 0.99, recentMove: -4, volumeZ: 3 }), 'G');
});

test('fractal estimators: noise ≈ 0.5, straight line has dimension ≈ 1', () => {
  const a = dfa(noise(512));
  assert.ok(a > 0.35 && a < 0.65, `dfa ${a}`);
  assert.ok(Math.abs(higuchi(Array.from({ length: 200 }, (_, i) => i)) - 1) < 0.05);
  let acc = 0;
  assert.ok(higuchi(noise(300).map(v => (acc += v))) > 1.3);
});

test('wavelet MRA bands add back to the original series', () => {
  const x = noise(64).map((v, i) => v + i * 0.1);
  const { bands, smooth } = mra(x, 3);
  const rebuilt = smooth.map((v, i) => v + bands.reduce((s, b) => s + b[i], 0));
  assert.ok(rebuilt.every((v, i) => Math.abs(v - x[i]) < 1e-9));
  assert.equal(haarDwt(x, 3).details.length, 3);
});

test('anomaly detectors flag an outlier', () => {
  const rows = Array.from({ length: 300 }, () => [gaussian(), gaussian()]);
  const score = isolationForest(rows);
  assert.ok(score([8, 8]) > score([0, 0]) + 0.1);
  assert.ok(mahalanobis(rows, [6, 6]) > mahalanobis(rows, [0.1, 0.1]));
  assert.ok(robustZ(noise(200), 10) > 5);
});

test('cross-asset residual catches a decoupled move', () => {
  const ref = noise(260, 0.01);
  const tgt = ref.map((v, i) => v * 1.2 + gaussian() * 0.002 + (i >= 254 ? 0.03 : 0));
  const c = crossAsset(candlesFrom(tgt), candlesFrom(ref));
  assert.ok(c.z > 3);
  assert.ok(Math.abs(c.beta - 1.2) < 0.1);
  // Regression: the reference has one extra (still open) bar; alignment is by timestamp.
  const extra = candlesFrom([...ref, 0.02]);
  const shifted = crossAsset(candlesFrom(tgt), extra);
  assert.ok(Math.abs(shifted.beta - 1.2) < 0.1, `beta ${shifted.beta}`);
});

test('order flow detects buying absorbed by a flat price', () => {
  const trades = Array.from({ length: 200 }, (_, i) => ({
    time: i, price: i < 140 ? 100 + i * 0.01 : 101.4, quantity: i < 140 ? 1 : 5, side: i < 140 ? (i % 2 ? 'buy' : 'sell') === 'buy' ? 'buy' : 'buy' : 'buy'
  }));
  trades.forEach((t, i) => { if (i < 140 && i % 3 === 0) t.side = 'sell'; });
  const f = orderFlow(trades);
  assert.ok(f.cvd > 0);
  assert.ok(f.absorption > 0.3);
  assert.equal(f.absorbedSide, 'compra');
});

test('liquidity sweep and volume profile', () => {
  const base = candlesFrom(noise(40, 0.001));
  const top = Math.max(...base.map(c => c.high));
  base.push({ time: 99, open: base.at(-1).close, high: top * 1.01, low: base.at(-1).close * 0.999, close: top * 0.995, volume: 50 });
  assert.equal(liquiditySweep(base).type, 'bearish');
  const vp = volumeProfile(candlesFrom(noise(200, 0.002)));
  assert.ok(vp.val <= vp.poc && vp.poc <= vp.vah);
});

test('volatility estimators and compression detection', () => {
  const est = estimators(candlesFrom(noise(60, 0.01)), 20);
  assert.ok(est.parkinson > 0 && est.yangZhang > 0);
  const wide = noise(250, 0.01);
  const tight = noise(60, 0.0008);
  const layer = volatilityLayer(candlesFrom([...wide, ...tight]));
  assert.equal(layer.metrics.compression, true);
  assert.equal(layer.score, 0);
  assert.ok(mean([1, 2, 3]) === 2);
});

test('DFA skips flat windows instead of returning NaN', () => {
  assert.equal(dfa(new Array(300).fill(0)), null);
});

test('cross-asset residual includes the fitted drift (alpha)', () => {
  const ref = noise(400, 0.01);
  const target = ref.map(v => 0.002 + 1.2 * v + gaussian() * 0.0005);
  const res = crossAsset(candlesFrom(target), candlesFrom(ref));
  assert.ok(Math.abs(res.z) < 2.5, `z ${res.z} should be normal when the target follows alpha + beta`);
});

test('order-flow buckets count price moves between buckets', () => {
  const trades = [];
  for (let i = 0; i < 100; i++) trades.push({ time: i, price: 100 + Math.floor(i / 10), quantity: 1, side: i % 2 ? 'buy' : 'sell' });
  const flow = orderFlow(trades, 10);
  assert.ok(flow.priceChange > 0);
});
