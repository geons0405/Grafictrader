const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

export function calculateMovementEnergy(candles, efficiency, persistence) {
  if (!Array.isArray(candles) || candles.length < 3) return { value: null, components: null };
  const rows = candles.map(c => ({
    open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)
  })).filter(c => Object.values(c).every(Number.isFinite));
  if (rows.length < 3) return { value: null, components: null };

  const ranges = rows.map(c => Math.max(0, c.high - c.low));
  const moves = rows.slice(1).map((c, i) => Math.abs(c.close - rows[i].close));
  const rangeBase = ranges.slice(0, -1).reduce((a,b)=>a+b,0) / Math.max(1,ranges.length-1);
  const moveBase = moves.reduce((a,b)=>a+b,0) / Math.max(1,moves.length);
  const recentRange = ranges.slice(-Math.min(10,ranges.length)).reduce((a,b)=>a+b,0) / Math.min(10,ranges.length);
  const recentMove = moves.slice(-Math.min(10,moves.length)).reduce((a,b)=>a+b,0) / Math.min(10,moves.length);
  const rangeExpansion = rangeBase > 0 ? clamp01(recentRange / rangeBase / 2) : 0;
  const displacement = moveBase > 0 ? clamp01(recentMove / moveBase / 2) : 0;
  const value = clamp01(
    0.35 * clamp01(efficiency) +
    0.25 * clamp01(persistence) +
    0.20 * rangeExpansion +
    0.20 * displacement
  );
  return { value, components: { efficiency: clamp01(efficiency), persistence: clamp01(persistence), rangeExpansion, displacement } };
}