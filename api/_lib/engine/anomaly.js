import { clamp, mean, median, mad, solve, ols, std, rng, round, last } from './core.js';

// Layer 7 — Anomalies: statistically unusual candles, volume, behaviour, and
// assets that stop moving the way they usually move together.

export const robustZ = (history, x) => {
  const s = mad(history);
  return s > 0 ? (x - median(history)) / s : 0;
};

/** Mahalanobis distance of `point` from the cloud `rows` (feature vectors). */
export function mahalanobis(rows, point) {
  const k = point.length;
  const mu = Array.from({ length: k }, (_, j) => mean(rows.map(r => r[j])));
  const cov = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) =>
    rows.reduce((s, r) => s + (r[a] - mu[a]) * (r[b] - mu[b]), 0) / Math.max(rows.length - 1, 1) + (a === b ? 1e-12 : 0)));
  const diff = point.map((v, j) => v - mu[j]);
  const y = solve(cov, diff);
  if (!y) return null;
  return Math.sqrt(Math.max(0, diff.reduce((s, v, j) => s + v * y[j], 0)));
}

/** Isolation Forest (Liu et al.): anomaly score in (0, 1); > 0.6 is unusual. */
export function isolationForest(rows, { trees = 100, sample = 128, seed = 7 } = {}) {
  const rand = rng(seed);
  const n = rows.length;
  const psi = Math.min(sample, n);
  const c = m => (m <= 1 ? 0 : 2 * (Math.log(m - 1) + 0.5772156649) - (2 * (m - 1)) / m);
  const build = (data, depth, limit) => {
    if (depth >= limit || data.length <= 1) return { size: data.length };
    const f = Math.floor(rand() * data[0].length);
    const vals = data.map(r => r[f]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) return { size: data.length };
    const split = lo + rand() * (hi - lo);
    return { f, split, left: build(data.filter(r => r[f] < split), depth + 1, limit), right: build(data.filter(r => r[f] >= split), depth + 1, limit) };
  };
  const pathLength = (node, x, depth) => (node.size !== undefined ? depth + c(node.size) : pathLength(x[node.f] < node.split ? node.left : node.right, x, depth + 1));
  const limit = Math.ceil(Math.log2(psi));
  const forest = Array.from({ length: trees }, () => {
    const s = Array.from({ length: psi }, () => rows[Math.floor(rand() * n)]);
    return build(s, 0, limit);
  });
  return x => Math.pow(2, -mean(forest.map(t => pathLength(t, x, 0))) / c(psi));
}

function features(candles) {
  return candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return [Math.log(c.close / prev.close), Math.log(Math.max(c.high / c.low, 1 + 1e-9)), Math.log(c.volume + 1), Math.abs(c.close - c.open) / Math.max(c.high - c.low, 1e-12)];
  });
}

/** Residual of the asset against its usual beta to a reference asset (e.g. ETH vs BTC). */
export function crossAsset(target, reference, window = 200, recent = 6) {
  const n = Math.min(target.length, reference.length);
  if (n < window + recent + 1) return null;
  const tr = target.slice(-n).map((c, i, a) => (i ? Math.log(c.close / a[i - 1].close) : 0)).slice(1);
  const rr = reference.slice(-n).map((c, i, a) => (i ? Math.log(c.close / a[i - 1].close) : 0)).slice(1);
  const fitT = tr.slice(-(window + recent), -recent);
  const fitR = rr.slice(-(window + recent), -recent);
  const fit = ols(fitR.map(v => [v]), fitT);
  if (!fit) return null;
  const [alpha, beta] = fit.beta;
  const residuals = fitT.map((v, i) => v - (alpha + beta * fitR[i]));
  const sd = std(residuals) * Math.sqrt(recent);
  const actual = tr.slice(-recent).reduce((s, v) => s + v, 0);
  const implied = rr.slice(-recent).reduce((s, v) => s + v, 0) * beta;
  const z = sd > 0 ? (actual - implied) / sd : 0;
  return { beta: round(beta, 3), actualPct: round(actual * 100, 3), impliedPct: round(implied * 100, 3), z: round(z, 2) };
}

export function anomalyLayer(candles, { reference = null, referenceName = 'BTC', cvdSlope = null } = {}) {
  if (candles.length < 150) return { id: 'anomaly', name: 'Anomalias', score: 0, confidence: 0, metrics: {}, notes: ['Dados insuficientes.'] };
  const rows = features(candles.slice(-300));
  const hist = rows.slice(0, -1);
  const now = last(rows);
  const z = {
    retorno: round(robustZ(hist.map(r => r[0]), now[0]), 2),
    amplitude: round(robustZ(hist.map(r => r[1]), now[1]), 2),
    volume: round(robustZ(hist.map(r => r[2]), now[2]), 2)
  };
  const dist = mahalanobis(hist.map(r => r.slice(0, 3)), now.slice(0, 3));
  const iso = isolationForest(hist);
  const isoNow = Math.max(...rows.slice(-3).map(iso));
  const cross = reference ? crossAsset(candles, reference) : null;
  const flags = [];
  if (Math.abs(z.volume) > 3) flags.push(`Volume anormal (z robusto ${z.volume}).`);
  if (Math.abs(z.amplitude) > 3) flags.push(`Vela anormal (amplitude z ${z.amplitude}).`);
  if (dist != null && dist > 4) flags.push(`Comportamento multivariado fora do normal (Mahalanobis ${dist.toFixed(1)}).`);
  if (isoNow > 0.62) flags.push(`Isolation Forest marca as últimas velas como invulgares (${isoNow.toFixed(2)}).`);
  if (cross && Math.abs(cross.z) > 2) flags.push(`Anomalia entre ativos: moveu ${cross.actualPct}% quando o normal face ao ${referenceName} seria ${cross.impliedPct}% (z ${cross.z}).`);
  const priceUp = now[0] > 0;
  if (cvdSlope != null && Math.abs(cvdSlope) > 0.15 && (cvdSlope > 0) !== priceUp && Math.abs(z.retorno) > 1) flags.push('Divergência entre preço e fluxo agressor.');
  const level = clamp(Math.max(isoNow - 0.5, 0) * 3 + flags.length * 0.15, 0, 1);
  // Directional hint only from a cross-asset lag: an asset left behind tends to catch up (or the gap closes).
  const score = cross && Math.abs(cross.z) > 2 ? clamp(-cross.z / 4) : 0;
  return {
    id: 'anomaly', name: 'Anomalias', score: round(score), confidence: round(cross && Math.abs(cross.z) > 2 ? 0.5 : 0.2),
    metrics: { level: round(level), robustZ: z, mahalanobis: round(dist, 2), isolationForest: round(isoNow), crossAsset: cross, flags },
    notes: flags.length ? flags.slice(0, 4) : ['Sem anomalias estatísticas relevantes.']
  };
}
