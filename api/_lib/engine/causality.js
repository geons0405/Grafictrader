import { clamp, correlation, ols, fPValue, round, mean } from './core.js';
import { transferEntropy } from './entropy.js';

// Layer 8 — Causality: which series tends to move first. Not proof of cause,
// but statistically tested precedence (Granger), lead-lag and information flow.

/** Aligns several candle series on common timestamps and returns log returns. */
export function alignReturns(seriesByName) {
  const names = Object.keys(seriesByName).filter(k => (seriesByName[k] || []).length > 30);
  if (!names.length) return { names: [], returns: {} };
  const maps = names.map(k => new Map(seriesByName[k].map(c => [c.time, c.close])));
  const times = [...maps[0].keys()].filter(t => maps.every(m => m.has(t))).sort((a, b) => a - b);
  const returns = {};
  names.forEach((k, i) => {
    const closes = times.map(t => maps[i].get(t));
    returns[k] = closes.slice(1).map((c, j) => Math.log(c / closes[j]));
  });
  return { names, returns, length: Math.max(0, times.length - 1) };
}

/** Granger test: does adding p lags of x improve the prediction of y? */
export function granger(x, y, p = 2) {
  const n = Math.min(x.length, y.length);
  if (n < 40 + p) return null;
  const xs = x.slice(-n), ys = y.slice(-n);
  const target = [], restricted = [], full = [];
  for (let t = p; t < n; t++) {
    const yl = [], xl = [];
    for (let k = 1; k <= p; k++) { yl.push(ys[t - k]); xl.push(xs[t - k]); }
    target.push(ys[t]); restricted.push(yl); full.push([...yl, ...xl]);
  }
  const r = ols(restricted, target);
  const u = ols(full, target);
  if (!r || !u || u.rss <= 0) return null;
  const df1 = p, df2 = target.length - 2 * p - 1;
  const F = ((r.rss - u.rss) / df1) / (u.rss / df2);
  const xCoefs = u.beta.slice(1 + p);
  return { F: round(F, 3), p: round(fPValue(F, df1, df2), 4), sign: Math.sign(xCoefs.reduce((s, v) => s + v, 0)), coefs: xCoefs, lags: p };
}

/** Cross-correlation at lags −L..L; positive best lag = x leads y. */
export function leadLag(x, y, L = 5) {
  let best = { lag: 0, r: 0 };
  const n = Math.min(x.length, y.length);
  for (let lag = -L; lag <= L; lag++) {
    const a = lag >= 0 ? x.slice(0, n - lag) : x.slice(-lag, n);
    const b = lag >= 0 ? y.slice(lag, n) : y.slice(0, n + lag);
    const r = correlation(a, b);
    if (Math.abs(r) > Math.abs(best.r)) best = { lag, r };
  }
  return { lag: best.lag, r: round(best.r, 3) };
}

/** Influence graph among the given series and the predicted drift of `target`. */
export function causalityLayer(seriesByName, target) {
  const { names, returns, length } = alignReturns(seriesByName);
  if (!names.includes(target) || length < 80 || names.length < 2) {
    return { id: 'causality', name: 'Causalidade', score: 0, confidence: 0, metrics: { edges: [] }, notes: ['Sem ativos suficientes alinhados para medir causalidade.'] };
  }
  const window = Math.min(length, 400);
  const R = Object.fromEntries(names.map(k => [k, returns[k].slice(-window)]));
  const edges = [];
  for (const a of names) for (const b of names) {
    if (a === b) continue;
    const g = granger(R[a], R[b], 2);
    if (!g) continue;
    const te = transferEntropy(R[a], R[b]);
    const ll = leadLag(R[a], R[b], 5);
    if (g.p < 0.05) edges.push({ from: a, to: b, p: g.p, F: g.F, sign: g.sign, transferEntropy: round(te, 4), leadLag: ll, coefs: g.coefs });
  }
  // Predicted next move of the target from its significant drivers' latest returns.
  const drivers = edges.filter(e => e.to === target);
  let predicted = 0;
  for (const e of drivers) {
    const x = R[e.from];
    predicted += e.coefs.reduce((s, c, k) => s + c * x[x.length - 1 - k], 0);
  }
  const sd = Math.sqrt(mean(R[target].map(v => v * v))) || 1e-9;
  const score = clamp(Math.tanh((predicted / sd) * 1.5));
  const strength = drivers.length ? clamp(mean(drivers.map(e => 1 - e.p)) * Math.min(1, drivers.length / 2), 0, 1) : 0;
  const notes = [
    drivers.length ? `${drivers.map(e => e.from).join(', ')} ${drivers.length > 1 ? 'antecipam' : 'antecipa'} o ${target} (Granger p ${drivers.map(e => e.p).join(', ')}).` : `Nenhum ativo antecipa o ${target} de forma significativa agora.`,
    edges.filter(e => e.from === target).length ? `O ${target} lidera: ${edges.filter(e => e.from === target).map(e => e.to).join(', ')}.` : null,
    drivers.length ? `Os líderes sugerem ${score > 0.1 ? 'subida' : score < -0.1 ? 'descida' : 'pouco movimento'} a seguir.` : null
  ].filter(Boolean);
  return {
    id: 'causality', name: 'Causalidade', score: round(score), confidence: round(clamp(0.2 + strength * 0.6, 0, 0.85)),
    metrics: { edges: edges.map(({ coefs, ...e }) => e), assets: names, window },
    notes
  };
}
