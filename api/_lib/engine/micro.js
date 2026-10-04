import { clamp, mean, median, sum, round, last } from './core.js';

// Layer 1 — Microstructure: who is pushing the price, how hard, and whether
// there is liquidity to sustain it. Uses Binance aggregated trades (aggressor
// side), the order book and candles.

/** Cumulative volume delta and aggressor imbalance over time buckets. */
export function orderFlow(trades = [], buckets = 10) {
  const rows = trades.filter(t => t.quantity > 0 && (t.side === 'buy' || t.side === 'sell')).sort((a, b) => a.time - b.time);
  if (rows.length < 30) return null;
  let cvd = 0;
  const cvdPath = rows.map(t => (cvd += t.side === 'buy' ? t.quantity : -t.quantity));
  const buyVol = sum(rows.filter(t => t.side === 'buy').map(t => t.quantity));
  const sellVol = sum(rows.filter(t => t.side === 'sell').map(t => t.quantity));
  const total = buyVol + sellVol;
  const size = Math.ceil(rows.length / buckets);
  const groups = [];
  // Each bucket's return runs from the previous bucket's close, so moves between buckets count.
  let previousPrice = rows[0].price;
  for (let i = 0; i < rows.length; i += size) {
    const g = rows.slice(i, i + size);
    const buy = sum(g.filter(t => t.side === 'buy').map(t => t.quantity));
    const sell = sum(g.filter(t => t.side === 'sell').map(t => t.quantity));
    const ret = Math.log(last(g).price / previousPrice);
    previousPrice = last(g).price;
    groups.push({ ofi: (buy - sell) / Math.max(buy + sell, 1e-12), net: buy - sell, volume: buy + sell, ret });
  }
  // Kyle's lambda: price move per unit of net aggressive volume.
  const impacts = groups.filter(g => Math.abs(g.net) > 0).map(g => g.ret / g.net);
  const lambda = median(impacts);
  const recent = groups.slice(-3);
  const early = groups.slice(0, 3);
  const ofiTrend = mean(recent.map(g => g.ofi)) - mean(early.map(g => g.ofi));
  // Absorption: strong aggression in recent buckets with little or opposite price progress.
  const recentNet = sum(recent.map(g => g.net));
  const recentRet = sum(recent.map(g => g.ret));
  const expectedRet = lambda * recentNet;
  let absorption = 0;
  if (Math.abs(recentNet) > 0 && Math.sign(expectedRet) !== 0) {
    const progress = recentRet / expectedRet; // 1 = normal impact, ≤0 = fully absorbed
    absorption = clamp(1 - progress, 0, 1) * clamp(Math.abs(mean(recent.map(g => g.ofi))) * 3, 0, 1);
  }
  const priceChange = Math.log(last(rows).price / rows[0].price);
  return {
    trades: rows.length,
    buyVolume: round(buyVol, 4),
    sellVolume: round(sellVol, 4),
    imbalance: round((buyVol - sellVol) / total),
    cvd: round(cvd, 4),
    cvdSlope: round(cvd / total),
    ofiTrend: round(ofiTrend),
    lambda,
    absorption: round(absorption),
    absorbedSide: absorption > 0.3 ? (recentNet > 0 ? 'compra' : 'venda') : null,
    divergence: Math.sign(priceChange) !== 0 && Math.sign(cvd) !== 0 && Math.sign(priceChange) !== Math.sign(cvd),
    priceChange: round(priceChange, 5),
    cvdPath: cvdPath.filter((_, i) => i % Math.max(1, Math.floor(cvdPath.length / 60)) === 0).map(v => round(v, 3))
  };
}

/** Depth on each side within bands around the mid price. */
export function bookLiquidity(book = {}) {
  const bids = book.bids || [];
  const asks = book.asks || [];
  if (!bids.length || !asks.length) return null;
  const mid = (bids[0].price + asks[0].price) / 2;
  const depth = (rows, pct, side) => sum(rows.filter(r => (side === 'bid' ? r.price >= mid * (1 - pct) : r.price <= mid * (1 + pct))).map(r => r.quantity * r.price));
  const bands = [0.001, 0.005, 0.01].map(pct => {
    const b = depth(bids, pct, 'bid');
    const a = depth(asks, pct, 'ask');
    return { pct, bid: round(b, 0), ask: round(a, 0), imbalance: round((b - a) / Math.max(a + b, 1e-9)) };
  });
  return { mid, spreadBps: round((asks[0].price - bids[0].price) / mid * 10000, 2), bands };
}

/** Prices where far more traded than the book shows resting: hidden (iceberg) orders. */
export function icebergs(trades = [], book = {}, tick = null) {
  if (trades.length < 30) return [];
  const step = tick || (book.asks?.[0] && book.bids?.[0] ? Math.max((book.asks[0].price - book.bids[0].price), book.bids[0].price * 1e-5) : null);
  if (!step) return [];
  const traded = new Map();
  for (const t of trades) {
    const level = Math.round(t.price / step) * step;
    const key = level.toFixed(8);
    const entry = traded.get(key) || { price: level, buy: 0, sell: 0 };
    entry[t.side] += t.quantity;
    traded.set(key, entry);
  }
  const resting = new Map();
  for (const r of [...(book.bids || []), ...(book.asks || [])]) {
    // Bins can span several ticks: add up every resting level in the bin, as trades are.
    const key = (Math.round(r.price / step) * step).toFixed(8);
    resting.set(key, (resting.get(key) || 0) + r.quantity);
  }
  const avgTraded = mean([...traded.values()].map(e => e.buy + e.sell));
  return [...traded.entries()]
    .map(([key, e]) => ({ price: e.price, traded: e.buy + e.sell, visible: resting.get(key) || 0, side: e.buy > e.sell ? 'venda escondida (absorve compras)' : 'compra escondida (absorve vendas)' }))
    .filter(e => e.visible > 0 && e.traded > 3 * e.visible && e.traded > 4 * avgTraded)
    .sort((a, b) => b.traded - a.traded)
    .slice(0, 3)
    .map(e => ({ ...e, traded: round(e.traded, 4), visible: round(e.visible, 4) }));
}

/** Volume profile: POC, value area (70%), high/low volume nodes. */
export function volumeProfile(candles = [], bins = 40) {
  const rows = candles.slice(-200);
  if (rows.length < 30) return null;
  const lo = Math.min(...rows.map(c => c.low));
  const hi = Math.max(...rows.map(c => c.high));
  if (!(hi > lo)) return null;
  const width = (hi - lo) / bins;
  const vol = new Array(bins).fill(0);
  for (const c of rows) {
    const a = Math.max(0, Math.floor((c.low - lo) / width));
    const b = Math.min(bins - 1, Math.floor((c.high - lo) / width));
    const share = c.volume / (b - a + 1);
    for (let i = a; i <= b; i++) vol[i] += share;
  }
  const price = i => lo + (i + 0.5) * width;
  const poc = vol.indexOf(Math.max(...vol));
  const total = sum(vol);
  let inside = vol[poc], up = poc, down = poc;
  while (inside < total * 0.7 && (up < bins - 1 || down > 0)) {
    const nextUp = up < bins - 1 ? vol[up + 1] : -1;
    const nextDown = down > 0 ? vol[down - 1] : -1;
    if (nextUp >= nextDown) inside += vol[++up]; else inside += vol[--down];
  }
  const avg = total / bins;
  const nodes = vol.map((v, i) => ({ i, v }));
  const hvn = nodes.filter(n => n.i > 0 && n.i < bins - 1 && n.v > vol[n.i - 1] && n.v > vol[n.i + 1] && n.v > avg * 1.3).map(n => round(price(n.i), 6));
  const lvn = nodes.filter(n => n.i > 0 && n.i < bins - 1 && n.v < vol[n.i - 1] && n.v < vol[n.i + 1] && n.v < avg * 0.6).map(n => round(price(n.i), 6));
  const close = last(rows).close;
  return { poc: round(price(poc), 6), vah: round(price(up), 6), val: round(price(down), 6), hvn: hvn.slice(-4), lvn: lvn.slice(-4), location: close > price(up) ? 'acima da área de valor' : close < price(down) ? 'abaixo da área de valor' : 'dentro da área de valor' };
}

export function vwap(candles = [], window = 200) {
  const rows = candles.slice(-window);
  const v = sum(rows.map(c => c.volume));
  if (!v) return null;
  const value = sum(rows.map(c => ((c.high + c.low + c.close) / 3) * c.volume)) / v;
  return { value: round(value, 6), distancePct: round((last(rows).close / value - 1) * 100, 3) };
}

/** Liquidity sweep: a wick that takes out a recent swing high/low and closes back inside. */
export function liquiditySweep(candles = [], lookback = 20, recentBars = 3) {
  if (candles.length < lookback + recentBars + 1) return null;
  for (let k = 1; k <= recentBars; k++) {
    const c = candles[candles.length - k];
    const before = candles.slice(-(lookback + k), -k);
    const swingHigh = Math.max(...before.map(x => x.high));
    const swingLow = Math.min(...before.map(x => x.low));
    if (c.high > swingHigh && c.close < swingHigh) return { type: 'bearish', level: round(swingHigh, 6), barsAgo: k - 1, text: 'Varrimento acima do topo: liquidez compradora caçada e preço rejeitado.' };
    if (c.low < swingLow && c.close > swingLow) return { type: 'bullish', level: round(swingLow, 6), barsAgo: k - 1, text: 'Varrimento abaixo do fundo: stops caçados e preço recuperado.' };
  }
  return null;
}

/** Layer score: aggression, absorption, book, sweeps and value-area location. */
export function microLayer({ candles, trades, book }) {
  const flow = orderFlow(trades);
  const liquidity = bookLiquidity(book);
  const profile = volumeProfile(candles);
  const vw = vwap(candles);
  const sweep = liquiditySweep(candles);
  const hidden = icebergs(trades, book);
  const parts = [];
  const notes = [];
  if (flow) {
    parts.push([flow.cvdSlope, 0.3]);
    parts.push([clamp(flow.ofiTrend * 2), 0.15]);
    notes.push(`CVD ${flow.cvd >= 0 ? 'positivo' : 'negativo'}: ${flow.imbalance >= 0 ? 'compradores' : 'vendedores'} agressivos dominam (${Math.round(Math.abs(flow.imbalance) * 100)}%).`);
    if (flow.absorption > 0.3) {
      parts.push([flow.absorbedSide === 'compra' ? -flow.absorption : flow.absorption, 0.2]);
      notes.push(`Absorção: agressão de ${flow.absorbedSide} sem o preço avançar (${Math.round(flow.absorption * 100)}%).`);
    }
    if (flow.divergence) notes.push('Divergência: o preço e o CVD vão em sentidos opostos.');
  }
  if (liquidity) {
    const near = liquidity.bands[1];
    parts.push([near.imbalance, 0.15]);
    notes.push(`Livro a ±0,5%: ${near.imbalance > 0 ? 'mais ordens de compra' : 'mais ordens de venda'} (${Math.round(Math.abs(near.imbalance) * 100)}%).`);
  }
  if (sweep) {
    parts.push([sweep.type === 'bullish' ? 0.7 : -0.7, 0.15]);
    notes.push(sweep.text);
  }
  if (profile) {
    const loc = profile.location.startsWith('acima') ? 0.4 : profile.location.startsWith('abaixo') ? -0.4 : 0;
    parts.push([loc, 0.05]);
  }
  const w = sum(parts.map(p => p[1]));
  const score = w ? sum(parts.map(([v, k]) => v * k)) / w : 0;
  return {
    id: 'micro', name: 'Microestrutura', score: round(clamp(score * 1.3)), confidence: round(flow ? (liquidity ? 0.8 : 0.6) : 0.2),
    metrics: { flow: flow && { ...flow, cvdPath: undefined, lambda: undefined }, liquidity, profile, vwap: vw, sweep, icebergs: hidden },
    notes: notes.slice(0, 4),
    series: { cvd: flow?.cvdPath || [] }
  };
}
