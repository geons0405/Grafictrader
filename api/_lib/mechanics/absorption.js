export function calculateAbsorption(candles) {
  if (!Array.isArray(candles) || candles.length < 5) return { value: null, evidence: 'insufficient_data' };
  const rows = candles.map(c => ({
    high: Number(c.high), low: Number(c.low), close: Number(c.close),
    open: Number(c.open), volume: Number(c.volume)
  })).filter(c => Object.values(c).every(Number.isFinite));
  if (rows.length < 5) return { value: null, evidence: 'insufficient_data' };

  const recent = rows.slice(-10);
  const ranges = recent.map(c => Math.max(0, c.high - c.low));
  const bodies = recent.map(c => Math.abs(c.close - c.open));
  const volumes = recent.map(c => c.volume);
  const median = values => {
    const s = [...values].sort((a,b)=>a-b);
    return s[Math.floor(s.length / 2)] || 0;
  };
  const rangeBase = median(ranges);
  const volumeBase = median(volumes);
  const highActivity = volumeBase > 0 ? Math.max(0, Math.min(1, (volumes.at(-1) / volumeBase - 1) / 2)) : 0;
  const smallBody = rangeBase > 0 ? Math.max(0, Math.min(1, 1 - bodies.at(-1) / rangeBase)) : 0;
  const rejection = ranges.at(-1) > 0
    ? Math.max(0, Math.min(1, Math.abs((rows.at(-1).close - rows.at(-1).low) - (rows.at(-1).high - rows.at(-1).close)) / ranges.at(-1)))
    : 0;
  const value = Math.max(0, Math.min(1, 0.55 * highActivity + 0.30 * smallBody + 0.15 * rejection));
  return { value, evidence: 'ohlcv_proxy' };
}