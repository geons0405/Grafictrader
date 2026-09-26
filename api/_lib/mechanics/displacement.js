export function calculateDisplacementCost(candles) {
  if (!Array.isArray(candles) || candles.length < 5) return { value: null, raw: null };
  const rows = candles.map(c => ({ close: Number(c.close), volume: Number(c.volume), high: Number(c.high), low: Number(c.low) }))
    .filter(c => Object.values(c).every(Number.isFinite));
  if (rows.length < 5) return { value: null, raw: null };
  const activities = rows.map(c => Math.max(0, c.volume) * Math.max(c.high - c.low, 0));
  const displacement = Math.abs(rows.at(-1).close - rows[0].close);
  const activity = activities.reduce((a,b)=>a+b,0) / Math.max(1,activities.length);
  if (!(displacement > 0) || !(activity > 0)) return { value: 0, raw: 0 };
  const raw = activity / displacement;
  const historical = rows.slice(1).map((c,i) => {
    const d = Math.abs(c.close - rows[i].close);
    return d > 0 ? (Math.max(0,c.volume) * Math.max(c.high-c.low,0)) / d : null;
  }).filter(Number.isFinite);
  const ref = historical.length ? historical.reduce((a,b)=>a+b,0)/historical.length : raw;
  return { value: ref > 0 ? Math.max(0, Math.min(1, raw / (ref * 2))) : 0, raw };
}