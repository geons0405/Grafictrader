// Small numeric helpers for the analysts (closing prices in, numbers out).

export const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
export const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  if (!s.length) return null;
  const line = s.map((v, i) => f[i + (slow - fast)] - v);
  const signal = ema(line, signalPeriod);
  if (!signal.length) return null;
  return { line: line.at(-1), signal: signal.at(-1), histogram: line.at(-1) - signal.at(-1) };
}

/** Rate of change over n bars, as a fraction. */
export function roc(values, n) {
  if (values.length <= n) return null;
  const past = values[values.length - 1 - n];
  return past ? values.at(-1) / past - 1 : null;
}

/** Average true range of the last `period` bars. */
export function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }
  return sum / period;
}
