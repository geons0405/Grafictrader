export function calculateEfficiency(candles) {
  if (!Array.isArray(candles) || candles.length < 2) return { value: null, sampleSize: 0 };
  const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
  if (closes.length < 2) return { value: null, sampleSize: closes.length };
  const net = Math.abs(closes.at(-1) - closes[0]);
  const path = closes.slice(1).reduce((sum, close, i) => sum + Math.abs(close - closes[i]), 0);
  if (!(path > 0)) return { value: 0, sampleSize: closes.length };
  return { value: Math.max(0, Math.min(1, net / path)), sampleSize: closes.length };
}

export function calculatePersistence(candles) {
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
  if (closes.length < 3) return null;
  const dirs = [];
  for (let i = 1; i < closes.length; i++) {
    const d = Math.sign(closes[i] - closes[i - 1]);
    if (d) dirs.push(d);
  }
  if (!dirs.length) return 0;
  let same = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] === dirs[i - 1]) same++;
  return same / Math.max(1, dirs.length - 1);
}