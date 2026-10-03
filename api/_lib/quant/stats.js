// Statistical estimators used by the Grafictrader decision engine.
// All functions are pure and operate on plain OHLCV candle arrays.
// They go beyond the usual RSI/MACD toolbox and look at the *process*
// behind the candles: persistence, predictability, order-flow pressure
// and volatility regime.

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const variance = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};
const std = a => Math.sqrt(variance(a));

export function logReturns(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1].close;
    const b = candles[i].close;
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

function logGamma(x) {
  // Lanczos approximation (g = 7, n = 9).
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Anis–Lloyd–Peters expected R/S of an i.i.d. series of length n. */
export function expectedRS(n) {
  let sum = 0;
  for (let i = 1; i < n; i++) sum += Math.sqrt((n - i) / i);
  const gammaRatio = Math.exp(logGamma((n - 1) / 2) - logGamma(n / 2));
  return ((n - 0.5) / n) * (gammaRatio / Math.sqrt(Math.PI)) * sum;
}

/**
 * Hurst exponent by rescaled-range (R/S) analysis with the Anis–Lloyd–Peters
 * small-sample correction, so a random walk reads ≈ 0.5 even on short windows.
 * H > 0.5: persistent (trends tend to continue); H < 0.5: anti-persistent
 * (moves tend to revert).
 */
export function hurstExponent(returns) {
  if (returns.length < 64) return null;
  const sizes = [8, 16, 32, 64, 128].filter(n => n <= returns.length / 2);
  const points = [];
  for (const n of sizes) {
    const ratios = [];
    for (let start = 0; start + n <= returns.length; start += n) {
      const chunk = returns.slice(start, start + n);
      const m = mean(chunk);
      let cum = 0;
      let min = 0;
      let max = 0;
      for (const x of chunk) {
        cum += x - m;
        if (cum < min) min = cum;
        if (cum > max) max = cum;
      }
      const s = Math.sqrt(chunk.reduce((acc, x) => acc + (x - m) ** 2, 0) / n);
      if (s > 0) ratios.push((max - min) / s);
    }
    if (ratios.length) points.push([Math.log(n), Math.log(mean(ratios)) - Math.log(expectedRS(n))]);
  }
  if (points.length < 3) return null;
  const mx = mean(points.map(p => p[0]));
  const my = mean(points.map(p => p[1]));
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den > 0 ? clamp(0.5 + num / den, 0, 1) : null;
}

/**
 * Lo–MacKinlay variance ratio VR(q) with its homoskedastic z statistic.
 * VR > 1: returns are positively autocorrelated (momentum);
 * VR < 1: negatively autocorrelated (mean reversion).
 */
export function varianceRatio(returns, q = 4) {
  const T = returns.length;
  if (T < q * 8) return { value: null, z: null };
  const v1 = variance(returns);
  if (!(v1 > 0)) return { value: null, z: null };
  const agg = [];
  for (let i = 0; i + q <= T; i++) {
    let s = 0;
    for (let j = 0; j < q; j++) s += returns[i + j];
    agg.push(s);
  }
  const vq = variance(agg);
  const value = vq / (q * v1);
  const se = Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * T));
  return { value, z: (value - 1) / se };
}

/**
 * Local linear trend Kalman filter on log price. Returns the filtered
 * slope (per bar) and its z-score against the filter's own uncertainty,
 * i.e. how confidently the hidden drift differs from zero.
 */
export function kalmanTrend(candles) {
  if (candles.length < 30) return { slope: null, z: null, level: null };
  const y = candles.map(c => Math.log(c.close));
  const r = logReturns(candles);
  const R = Math.max(variance(r), 1e-12);
  const qLevel = R * 0.05;
  const qSlope = R * 0.0005;
  let level = y[0];
  let slope = 0;
  let P = [[R, 0], [0, R]];
  for (let t = 1; t < y.length; t++) {
    // predict
    const lp = level + slope;
    const sp = slope;
    const P00 = P[0][0] + 2 * P[0][1] + P[1][1] + qLevel;
    const P01 = P[0][1] + P[1][1];
    const P11 = P[1][1] + qSlope;
    // update
    const S = P00 + R;
    const K0 = P00 / S;
    const K1 = P01 / S;
    const innovation = y[t] - lp;
    level = lp + K0 * innovation;
    slope = sp + K1 * innovation;
    P = [
      [(1 - K0) * P00, (1 - K0) * P01],
      [P01 - K1 * P00, P11 - K1 * P01]
    ];
  }
  const sd = Math.sqrt(Math.max(P[1][1], 1e-18));
  return { slope, z: slope / sd, level: Math.exp(level) };
}

/**
 * Bandt–Pompe permutation entropy (order 3), normalised to [0, 1].
 * 1 means the ordering of consecutive prices is fully random; lower
 * values mean the sequence has exploitable structure.
 */
export function permutationEntropy(values, order = 3) {
  if (values.length < order + 20) return null;
  const counts = new Map();
  let total = 0;
  for (let i = 0; i + order <= values.length; i++) {
    const window = values.slice(i, i + order);
    const key = window.map((v, idx) => [v, idx]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(p => p[1]).join('');
    counts.set(key, (counts.get(key) || 0) + 1);
    total++;
  }
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  const factorial = [1, 1, 2, 6, 24, 120][order];
  return h / Math.log(factorial);
}

/** Garman–Klass per-bar volatility (uses open, high, low and close). */
export function garmanKlass(candle) {
  const { open, high, low, close } = candle;
  if (!(open > 0 && high > 0 && low > 0 && close > 0)) return 0;
  const hl = Math.log(high / low);
  const co = Math.log(close / open);
  return Math.sqrt(Math.max(0, 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co));
}

/** Current Garman–Klass volatility and its percentile within recent history. */
export function volatilityRegime(candles, window = 20) {
  if (candles.length < window * 3) return { value: null, percentile: null };
  const gk = candles.map(garmanKlass);
  const rolling = [];
  for (let i = window; i <= gk.length; i++) rolling.push(mean(gk.slice(i - window, i)));
  const current = rolling.at(-1);
  const below = rolling.filter(v => v <= current).length;
  return { value: current, percentile: below / rolling.length };
}

/** Standard normal CDF (Abramowitz–Stegun approximation). */
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * Bulk Volume Classification (Easley, López de Prado, O'Hara): splits each
 * bar's volume into buy/sell using the standardised price change. Returns
 * the net imbalance over the window and VPIN (volume-synchronised
 * probability of informed trading, a toxicity measure).
 */
export function bulkVolume(candles, window = 20) {
  if (candles.length < window + 2) return { imbalance: null, vpin: null };
  const changes = [];
  for (let i = 1; i < candles.length; i++) changes.push(candles[i].close - candles[i - 1].close);
  const sigma = std(changes.slice(-Math.max(window * 3, 50))) || 1e-12;
  const recent = candles.slice(-window);
  const recentChanges = changes.slice(-window);
  let net = 0;
  let abs = 0;
  let vol = 0;
  recent.forEach((c, i) => {
    const v = Math.max(0, c.volume || 0);
    const buy = v * normalCdf(recentChanges[i] / sigma);
    const sell = v - buy;
    net += buy - sell;
    abs += Math.abs(buy - sell);
    vol += v;
  });
  return vol > 0 ? { imbalance: net / vol, vpin: abs / vol } : { imbalance: 0, vpin: 0 };
}

/** Distance of the close from the rolling VWAP, in standard deviations. */
export function vwapDeviation(candles, window = 50) {
  if (candles.length < window) return { vwap: null, z: null };
  const rows = candles.slice(-window);
  let pv = 0;
  let v = 0;
  for (const c of rows) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * (c.volume || 0);
    v += c.volume || 0;
  }
  const vwap = v > 0 ? pv / v : mean(rows.map(c => c.close));
  const dev = rows.map(c => c.close - vwap);
  const sd = std(dev);
  return { vwap, z: sd > 0 ? (rows.at(-1).close - vwap) / sd : 0 };
}

export function autocorrelation(returns, lag = 1) {
  if (returns.length < lag + 20) return null;
  const m = mean(returns);
  let num = 0;
  let den = 0;
  for (let i = 0; i < returns.length; i++) {
    den += (returns[i] - m) ** 2;
    if (i >= lag) num += (returns[i] - m) * (returns[i - lag] - m);
  }
  return den > 0 ? num / den : null;
}

/** Average true range (simple mean of true ranges). */
export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  return mean(trs);
}
