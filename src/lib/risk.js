/**
 * How much to risk and how big the position can be.
 * balance and riskPct (e.g. 1 for 1%) give the money at risk; entry and stop
 * give the distance, hence the size. For fixed-time (binary) trades the whole
 * stake is at risk, so the stake itself must not exceed the money at risk.
 */
export function positionSize({ balance, riskPct, entry, stop }) {
  const b = Number(balance);
  const pct = Number(riskPct);
  if (!(b > 0) || !(pct > 0) || pct > 100) return null;
  const riskAmount = (b * pct) / 100;
  const e = Number(entry);
  const s = Number(stop);
  const distance = Math.abs(e - s);
  const sized = e > 0 && s > 0 && distance > 0;
  return {
    riskAmount: round(riskAmount),
    binaryStake: round(riskAmount),
    units: sized ? riskAmount / distance : null,
    notional: sized ? round((riskAmount / distance) * e) : null,
    stopPct: sized ? round((distance / e) * 100, 3) : null,
    leverageNeeded: sized ? round(((riskAmount / distance) * e) / b, 2) : null
  };
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
