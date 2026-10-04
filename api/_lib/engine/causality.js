import { clamp, correlation, ols, fPValue, round, mean, alignPair } from './core.js';
import { transferEntropy } from './entropy.js';

// Layer 8 — Causality: which series tends to move first. Not proof of cause,
// but statistically tested precedence (Granger), lead-lag and information flow.

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

const pairReturns = (a, b) => {
  const [x, y] = alignPair(a, b);
  const r = rows => rows.slice(1).map((c, i) => Math.log(c.close / rows[i].close));
  return { x: r(x), y: r(y), lastTime: x.length ? x[x.length - 1].time : null };
};

/**
 * Influence graph among the given series (each pair aligned on its own common
 * timestamps, so a closed market like DXY on Sunday does not block the others)
 * and the predicted drift of `target`.
 */
export function causalityLayer(seriesByName, target) {
  const names = Object.keys(seriesByName).filter(k => (seriesByName[k] || []).length > 100);
  if (!names.includes(target) || names.length < 2) {
    return { id: 'causality', name: 'Causalidade', score: 0, confidence: 0, metrics: { edges: [] }, notes: ['Sem ativos suficientes para medir causalidade.'] };
  }
  const targetLast = seriesByName[target][seriesByName[target].length - 1].time;
  const edges = [];
  const drivers = [];
  for (const a of names) for (const b of names) {
    if (a === b) continue;
    const { x, y, lastTime } = pairReturns(seriesByName[a], seriesByName[b]);
    if (x.length < 120) continue;
    const xs = x.slice(-400), ys = y.slice(-400);
    const g = granger(xs, ys, 2);
    if (!g || g.p >= 0.05) continue;
    const edge = { from: a, to: b, p: g.p, F: g.F, sign: g.sign, transferEntropy: round(transferEntropy(xs, ys), 4), leadLag: leadLag(xs, ys, 5), overlap: xs.length };
    edges.push(edge);
    // Only drivers whose data is current (same last bar as the target) can predict now.
    if (b === target && lastTime === targetLast) drivers.push({ edge, x: xs, coefs: g.coefs, y: ys });
  }
  let predicted = 0;
  for (const d of drivers) predicted += d.coefs.reduce((s, c, k) => s + c * d.x[d.x.length - 1 - k], 0);
  const tr = drivers[0]?.y || [];
  const sd = Math.sqrt(mean(tr.map(v => v * v))) || 1e-9;
  const score = drivers.length ? clamp(Math.tanh((predicted / sd) * 1.5)) : 0;
  const strength = drivers.length ? clamp(mean(drivers.map(d => 1 - d.edge.p)) * Math.min(1, drivers.length / 2), 0, 1) : 0;
  const led = edges.filter(e => e.from === target).map(e => e.to);
  const notes = [
    drivers.length ? `${drivers.map(d => d.edge.from).join(', ')} ${drivers.length > 1 ? 'antecipam' : 'antecipa'} o ${target} (Granger p ${drivers.map(d => d.edge.p).join(', ')}).` : `Nenhum ativo com dados atuais antecipa o ${target} de forma significativa agora.`,
    led.length ? `O ${target} lidera: ${led.join(', ')}.` : null,
    drivers.length ? `Os líderes sugerem ${score > 0.1 ? 'subida' : score < -0.1 ? 'descida' : 'pouco movimento'} a seguir.` : null
  ].filter(Boolean);
  return {
    id: 'causality', name: 'Causalidade', score: round(score), confidence: round(clamp(0.2 + strength * 0.6, 0, 0.85)),
    metrics: { edges, assets: names },
    notes
  };
}
