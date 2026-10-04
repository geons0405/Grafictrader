import { clamp, mean, variance, round } from './core.js';

// Layer 3 — Regimes: in which "state" is the market working right now.

const gauss = (x, m, v) => Math.exp(-((x - m) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);

/**
 * Gaussian Hidden Markov Model fitted by Baum–Welch (scaled forward–backward).
 * States are sorted by variance: 0 = calm, last = turbulent.
 */
export function fitHmm(x, states = 3, iterations = 25) {
  const n = x.length;
  if (n < 60) return null;
  const sorted = [...x].sort((a, b) => a - b);
  let mu = Array.from({ length: states }, (_, s) => sorted[Math.floor(((s + 0.5) / states) * n)]);
  const v0 = variance(x) || 1e-8;
  let sig = Array.from({ length: states }, (_, s) => v0 * (0.5 + s));
  let pi = new Array(states).fill(1 / states);
  let A = Array.from({ length: states }, (_, i) => Array.from({ length: states }, (_, j) => (i === j ? 0.9 : 0.1 / (states - 1))));
  let gamma = null;
  for (let it = 0; it < iterations; it++) {
    const alpha = [], scale = [];
    for (let t = 0; t < n; t++) {
      const row = new Array(states);
      for (let j = 0; j < states; j++) {
        const prior = t === 0 ? pi[j] : alpha[t - 1].reduce((s, a, i) => s + a * A[i][j], 0);
        row[j] = prior * Math.max(gauss(x[t], mu[j], sig[j]), 1e-300);
      }
      const c = row.reduce((s, v) => s + v, 0) || 1e-300;
      scale.push(c);
      alpha.push(row.map(v => v / c));
    }
    const beta = new Array(n);
    beta[n - 1] = new Array(states).fill(1);
    for (let t = n - 2; t >= 0; t--) {
      beta[t] = new Array(states).fill(0).map((_, i) =>
        A[i].reduce((s, a, j) => s + a * Math.max(gauss(x[t + 1], mu[j], sig[j]), 1e-300) * beta[t + 1][j], 0) / scale[t + 1]);
    }
    gamma = alpha.map((a, t) => {
      const g = a.map((v, i) => v * beta[t][i]);
      const z = g.reduce((s, v) => s + v, 0) || 1e-300;
      return g.map(v => v / z);
    });
    const xi = Array.from({ length: states }, () => new Array(states).fill(0));
    for (let t = 0; t < n - 1; t++) {
      let z = 0;
      const tmp = Array.from({ length: states }, () => new Array(states).fill(0));
      for (let i = 0; i < states; i++) for (let j = 0; j < states; j++) {
        tmp[i][j] = alpha[t][i] * A[i][j] * Math.max(gauss(x[t + 1], mu[j], sig[j]), 1e-300) * beta[t + 1][j];
        z += tmp[i][j];
      }
      for (let i = 0; i < states; i++) for (let j = 0; j < states; j++) xi[i][j] += tmp[i][j] / (z || 1e-300);
    }
    pi = gamma[0];
    A = xi.map(row => { const z = row.reduce((s, v) => s + v, 0) || 1; return row.map(v => v / z); });
    for (let j = 0; j < states; j++) {
      const w = gamma.map(g => g[j]);
      const ws = w.reduce((s, v) => s + v, 0) || 1e-12;
      mu[j] = w.reduce((s, v, t) => s + v * x[t], 0) / ws;
      sig[j] = Math.max(w.reduce((s, v, t) => s + v * (x[t] - mu[j]) ** 2, 0) / ws, v0 * 1e-3);
    }
  }
  const order = sig.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
  const current = gamma[n - 1];
  const probs = order.map(i => current[i]);
  const state = probs.indexOf(Math.max(...probs));
  return {
    state,
    probabilities: probs.map(p => round(p)),
    means: order.map(i => mu[i]),
    variances: order.map(i => sig[i]),
    persistence: round(A[order[state]][order[state]]),
    path: gamma.slice(-60).map(g => order.map(i => g[i]).indexOf(Math.max(...order.map(i => g[i]))))
  };
}

/**
 * Single change-point scan: the split that best explains the series as two
 * Gaussian segments (mean and variance). Returns where and how strong.
 */
export function changePoint(x, minSize = 15) {
  const n = x.length;
  if (n < minSize * 2 + 5) return null;
  const ll = seg => {
    const v = Math.max(variance(seg), 1e-12);
    return -0.5 * seg.length * (Math.log(2 * Math.PI * v) + 1);
  };
  const whole = ll(x);
  let best = { k: null, lr: 0 };
  for (let k = minSize; k <= n - minSize; k++) {
    const lr = 2 * (ll(x.slice(0, k)) + ll(x.slice(k)) - whole);
    if (lr > best.lr) best = { k, lr };
  }
  if (best.k == null) return null;
  const before = x.slice(0, best.k);
  const after = x.slice(best.k);
  // LR ~ chi-square(2) under no change; > 13.8 ≈ p < 0.001 (scan-adjusted, conservative).
  return {
    barsAgo: n - best.k,
    strength: round(best.lr, 2),
    significant: best.lr > 13.8,
    volRatio: round(Math.sqrt(variance(after) / Math.max(variance(before), 1e-12)), 2),
    meanShift: round((mean(after) - mean(before)) / (Math.sqrt(variance(x)) || 1), 2)
  };
}

export const REGIMES = {
  A: 'Tendência forte',
  B: 'Tendência fraca',
  C: 'Acumulação',
  D: 'Distribuição',
  E: 'Compressão',
  F: 'Expansão de volatilidade',
  G: 'Liquidação / capitulação'
};

/** Rule-based A–G classification from the other layers' features. */
export function classifyRegime(f) {
  const trend = Math.abs(f.trendStrength || 0);
  if (f.volPercentile > 0.95 && Math.abs(f.recentMove) > 2.5 && f.volumeZ > 2) return 'G';
  if (f.compression) return 'E';
  if (f.expansion) return 'F';
  if (trend > 1.5 && (f.hurst ?? 0.5) > 0.55) return 'A';
  if (Math.abs(f.recentMove) < 1 && (f.cvdSlope ?? 0) > 0.15) return 'C';
  if (Math.abs(f.recentMove) < 1 && (f.cvdSlope ?? 0) < -0.15) return 'D';
  if (trend > 0.6) return 'B';
  return f.cvdSlope > 0.05 ? 'C' : f.cvdSlope < -0.05 ? 'D' : 'B';
}

export function regimeLayer(returns, features) {
  const hmm = fitHmm(returns.slice(-300));
  const cp = changePoint(returns.slice(-150));
  const code = classifyRegime(features);
  const stability = hmm ? hmm.persistence : 0.5;
  const dir = Math.sign(features.trendDirection || 0);
  // Direction only from trending/accumulation regimes; capitulation/expansion are neutral here.
  const bias = { A: 0.8, B: 0.4, C: 0.5, D: -0.5, E: 0, F: 0.2, G: 0 }[code];
  const score = code === 'C' || code === 'D' ? bias : bias * dir;
  const hmmLabel = hmm ? ['calmo', 'normal', 'turbulento'][hmm.state] : '—';
  const notes = [
    `Regime ${code}: ${REGIMES[code]}.`,
    hmm ? `HMM: estado ${hmmLabel} (${Math.round(hmm.probabilities[hmm.state] * 100)}%), persistência ${Math.round(stability * 100)}%.` : null,
    cp?.significant && cp.barsAgo <= 30 ? `Mudança estrutural há ${cp.barsAgo} velas (volatilidade ×${cp.volRatio}).` : null
  ].filter(Boolean);
  return {
    id: 'regime', name: 'Regimes', score: round(clamp(score)), confidence: round(clamp(0.35 + stability * 0.5 - (cp?.significant && cp.barsAgo <= 10 ? 0.2 : 0), 0.1, 0.9)),
    metrics: { code, label: REGIMES[code], hmm: hmm && { ...hmm, means: hmm.means.map(v => round(v, 6)), variances: undefined, path: hmm.path }, changePoint: cp },
    notes
  };
}
