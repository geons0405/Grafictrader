import { clamp, mean, std, autocorrelation, ols, round } from './core.js';
import { hurstExponent } from '../quant/stats.js';

// Layer 5 — Fractal behaviour of price: persistence, roughness, multifractality.

/** Detrended fluctuation analysis exponent α (≈ Hurst for returns). */
export function dfa(returns) {
  const n = returns.length;
  if (n < 100) return null;
  const m = mean(returns);
  let acc = 0;
  const profile = returns.map(r => (acc += r - m));
  const sizes = [8, 12, 16, 24, 32, 48, 64].filter(s => s <= n / 4);
  const pts = [];
  for (const s of sizes) {
    const f = [];
    for (let start = 0; start + s <= n; start += s) {
      const seg = profile.slice(start, start + s);
      const fit = ols(seg.map((_, i) => [i]), seg);
      if (!fit) continue;
      const [a, b] = fit.beta;
      f.push(mean(seg.map((v, i) => (v - (a + b * i)) ** 2)));
    }
    // A flat window has no fluctuation: log(0) would poison the fit, so skip that scale.
    if (f.length && mean(f) > 0) pts.push([Math.log(s), Math.log(Math.sqrt(mean(f)))]);
  }
  if (pts.length < 3) return null;
  return ols(pts.map(p => [p[0]]), pts.map(p => p[1]))?.beta[1] ?? null;
}

/** Higuchi fractal dimension of the price path (1 = smooth trend, 2 = very rough). */
export function higuchi(x, kmax = 10) {
  const n = x.length;
  if (n < kmax * 4) return null;
  const pts = [];
  for (let k = 1; k <= kmax; k++) {
    const lens = [];
    for (let m = 0; m < k; m++) {
      let len = 0;
      const count = Math.floor((n - m - 1) / k);
      if (count < 1) continue;
      for (let i = 1; i <= count; i++) len += Math.abs(x[m + i * k] - x[m + (i - 1) * k]);
      lens.push((len * (n - 1)) / (count * k * k));
    }
    pts.push([Math.log(1 / k), Math.log(mean(lens))]);
  }
  return ols(pts.map(p => [p[0]]), pts.map(p => p[1]))?.beta[1] ?? null;
}

/** Generalized Hurst H(q) from q-th moments of increments of the log price. */
export function generalizedHurst(logPrice, q) {
  const taus = [1, 2, 4, 8, 16].filter(t => t < logPrice.length / 4);
  const pts = taus.map(t => {
    const inc = [];
    for (let i = t; i < logPrice.length; i++) inc.push(Math.abs(logPrice[i] - logPrice[i - t]) ** q);
    return [Math.log(t), Math.log(mean(inc)) / q];
  });
  if (pts.length < 3) return null;
  return ols(pts.map(p => [p[0]]), pts.map(p => p[1]))?.beta[1] ?? null;
}

export function fractalLayer(candles) {
  const closes = candles.map(c => c.close);
  if (closes.length < 200) return { id: 'fractal', name: 'Estrutura fractal', score: 0, confidence: 0, metrics: {}, notes: ['Dados insuficientes.'] };
  const logP = closes.map(Math.log);
  const returns = logP.slice(1).map((v, i) => v - logP[i]);
  const window = returns.slice(-256);
  const hurst = hurstExponent(window);
  const alpha = dfa(window);
  const fd = higuchi(logP.slice(-200));
  const h1 = generalizedHurst(logP.slice(-256), 1);
  const h3 = generalizedHurst(logP.slice(-256), 3);
  const multifractal = h1 != null && h3 != null ? h1 - h3 : null;
  const ac1 = autocorrelation(window, 1);
  const ac5 = autocorrelation(window, 5);
  const estimates = [hurst, alpha].filter(v => v != null);
  if (!estimates.length) {
    return { id: 'fractal', name: 'Estrutura fractal', score: 0, confidence: 0, metrics: { hurst: null, dfa: null }, notes: ['Sem variação suficiente para medir a persistência.'] };
  }
  const persistence = mean(estimates) - 0.5; // > 0 persistent, < 0 mean-reverting
  const drift = mean(returns.slice(-30)) / (std(returns.slice(-120)) || 1);
  // Persistent: follow the drift. Anti-persistent: lean against a stretched drift.
  const score = persistence > 0.03 ? Math.tanh(drift * 5) * clamp(persistence * 8, 0, 1)
    : persistence < -0.03 ? -Math.tanh(drift * 5) * clamp(-persistence * 6, 0, 1) : 0;
  const notes = [
    `Hurst ${hurst?.toFixed(2)} e DFA α ${alpha?.toFixed(2)}: ${persistence > 0.03 ? 'comportamento persistente (tendência tende a continuar)' : persistence < -0.03 ? 'anti-persistente (tende a reverter)' : 'perto de passeio aleatório'}.`,
    `Dimensão fractal ${fd?.toFixed(2)} (${fd != null && fd < 1.4 ? 'caminho limpo' : 'caminho rugoso'}); multifractalidade ΔH ${multifractal?.toFixed(2)}.`
  ];
  return {
    id: 'fractal', name: 'Estrutura fractal', score: round(clamp(score)), confidence: round(clamp(Math.abs(persistence) * 6, 0.15, 0.85)),
    metrics: { hurst: round(hurst), dfa: round(alpha), higuchi: round(fd), h1: round(h1), h3: round(h3), multifractality: round(multifractal), autocorr1: round(ac1), autocorr5: round(ac5) },
    notes
  };
}
