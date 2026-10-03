/** Deterministic random-walk candles for tests. */
export function makeCandles(count, { start = 100, interval = 300, endTime = null, seed = 42 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const last = endTime ?? Math.floor(Date.now() / 1000 / interval) * interval;
  const out = [];
  let price = start;
  for (let i = count - 1; i >= 0; i--) {
    const open = price;
    price = price * (1 + Math.sin((count - i) / 7) * 0.003 + (rand() - 0.5) * 0.004);
    out.push({
      time: last - i * interval,
      open,
      high: Math.max(open, price) * 1.001,
      low: Math.min(open, price) * 0.999,
      close: price,
      volume: 100 + rand() * 50
    });
  }
  return out;
}
