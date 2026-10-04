import { clamp, mean, std, autocorrelation, percentileRank, round, last } from './core.js';

// Layer 4 — Volatility: level, estimator consensus, clustering, vol-of-vol and
// above all the transition from compression to expansion.

const ln = Math.log;

export function estimators(candles, w = 20) {
  const rows = candles.slice(-(w + 1));
  if (rows.length < w + 1) return null;
  const prev = rows.slice(0, -1);
  const cur = rows.slice(1);
  const r = cur.map((c, i) => ln(c.close / prev[i].close));
  const realized = std(r);
  const parkinson = Math.sqrt(mean(cur.map(c => ln(c.high / c.low) ** 2)) / (4 * ln(2)));
  const garmanKlass = Math.sqrt(Math.max(mean(cur.map(c => 0.5 * ln(c.high / c.low) ** 2 - (2 * ln(2) - 1) * ln(c.close / c.open) ** 2)), 0));
  const rogersSatchell = Math.sqrt(Math.max(mean(cur.map(c => ln(c.high / c.close) * ln(c.high / c.open) + ln(c.low / c.close) * ln(c.low / c.open))), 0));
  // Yang–Zhang: overnight (open vs previous close) + open-to-close + Rogers–Satchell.
  const overnight = cur.map((c, i) => ln(c.open / prev[i].close));
  const openClose = cur.map(c => ln(c.close / c.open));
  const k = 0.34 / (1.34 + (w + 1) / (w - 1));
  const yangZhang = Math.sqrt(Math.max(std(overnight) ** 2 + k * std(openClose) ** 2 + (1 - k) * rogersSatchell ** 2, 0));
  return { realized, parkinson, garmanKlass, rogersSatchell, yangZhang };
}

function atr(candles, p) {
  const rows = candles.slice(-(p + 1));
  if (rows.length < p + 1) return null;
  let s = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i], pc = rows[i - 1].close;
    s += Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  return s / p;
}

/** Bollinger band width (2σ, 20) as a fraction of price. */
function bandWidth(closes) {
  const w = closes.slice(-20);
  return (4 * std(w)) / mean(w);
}

export function volatilityLayer(candles, extras = {}) {
  if (candles.length < 120) return { id: 'volatility', name: 'Volatilidade', score: 0, confidence: 0, metrics: {}, notes: ['Dados insuficientes.'] };
  const closes = candles.map(c => c.close);
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const est = estimators(candles, 20);
  // Rolling realized vol to measure clustering, vol-of-vol and its percentile.
  const rolling = [];
  for (let i = 40; i <= returns.length; i += 5) rolling.push(std(returns.slice(i - 20, i)));
  const volPct = percentileRank(rolling, last(rolling));
  const volOfVol = std(rolling.slice(-30)) / (mean(rolling.slice(-30)) || 1);
  const clustering = autocorrelation(returns.slice(-200).map(r => r * r), 1);
  // Short ATR against a long baseline (100 bars) so a long squeeze still reads as compressed.
  const atrRatio = (atr(candles, 5) || 0) / (atr(candles, Math.min(100, candles.length - 2)) || 1);
  const widths = [];
  for (let i = 20; i <= closes.length; i += 2) widths.push(bandWidth(closes.slice(0, i)));
  const widthPct = percentileRank(widths, last(widths));
  // How many bars the bands have stayed in the bottom 25%.
  let squeezeBars = 0;
  for (let i = widths.length - 1; i >= 0 && percentileRank(widths, widths[i]) <= 0.25; i--) squeezeBars += 2;
  const compression = widthPct <= 0.2 && atrRatio < 0.9;
  const expansion = atrRatio > 1.35 || (volPct > 0.85 && widthPct > 0.8);
  // Readiness of a compression to break: long squeeze, volume building, entropy falling.
  const readiness = compression
    ? clamp(0.3 + Math.min(squeezeBars, 60) / 120 + clamp(extras.volumeTrend || 0, 0, 0.3) + clamp(-(extras.entropyTrend || 0) * 5, 0, 0.2), 0, 1)
    : 0;
  const state = compression ? 'compressão' : expansion ? 'expansão' : 'normal';
  const notes = [
    `Volatilidade ${state} (percentil ${Math.round(volPct * 100)}); ATR curto/longo ×${atrRatio.toFixed(2)}.`,
    compression ? `Bandas comprimidas há ${squeezeBars} velas: probabilidade de expansão a crescer (${Math.round(readiness * 100)}%).` : null,
    `Clustering ${clustering.toFixed(2)}, vol-da-vol ${volOfVol.toFixed(2)}.`
  ].filter(Boolean);
  return {
    // Volatility is not directional; its score is 0 and it shapes risk and the early warning.
    id: 'volatility', name: 'Volatilidade', score: 0, confidence: round(clamp(0.4 + Math.abs(volPct - 0.5), 0, 0.9)),
    metrics: {
      estimators: est && Object.fromEntries(Object.entries(est).map(([k, v]) => [k, round(v * 100, 4)])),
      percentile: round(volPct), volOfVol: round(volOfVol), clustering: round(clustering), atrRatio: round(atrRatio),
      bandWidthPercentile: round(widthPct), squeezeBars, compression, expansion, readiness: round(readiness), state
    },
    notes
  };
}
