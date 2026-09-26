function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

export function calculateTradeFlow(trades = []) {
  const rows = Array.isArray(trades) ? trades
    .map(t => ({
      price: Number(t.price),
      quantity: Number(t.quantity),
      side: t.side === 'buy' || t.side === 'sell' ? t.side : null,
      time: Number(t.time)
    }))
    .filter(t => Number.isFinite(t.price) && Number.isFinite(t.quantity) && t.quantity > 0 && t.side)
    : [];

  if (rows.length < 10) {
    return { value: null, imbalance: null, aggression: null, count: rows.length, evidence: 'insufficient_trades' };
  }

  const buy = rows.filter(t => t.side === 'buy').reduce((sum, t) => sum + t.quantity, 0);
  const sell = rows.filter(t => t.side === 'sell').reduce((sum, t) => sum + t.quantity, 0);
  const total = buy + sell;
  const imbalance = total > 0 ? (buy - sell) / total : 0;

  const sizes = rows.map(t => t.quantity);
  const medianSize = Math.max(percentile(sizes, 0.5), Number.EPSILON);
  const largeThreshold = percentile(sizes, 0.9);
  const large = rows.filter(t => t.quantity >= largeThreshold);
  const largeBuy = large.filter(t => t.side === 'buy').reduce((sum, t) => sum + t.quantity, 0);
  const largeSell = large.filter(t => t.side === 'sell').reduce((sum, t) => sum + t.quantity, 0);
  const largeTotal = largeBuy + largeSell;
  const largeImbalance = largeTotal > 0 ? (largeBuy - largeSell) / largeTotal : 0;

  return {
    value: clamp((imbalance + 1) / 2),
    imbalance,
    aggression: largeImbalance,
    count: rows.length,
    medianTradeSize: medianSize,
    evidence: 'real_agg_trades'
  };
}

export function calculateOrderBookDynamics(orderBook = {}) {
  const bids = Array.isArray(orderBook.bids) ? orderBook.bids : [];
  const asks = Array.isArray(orderBook.asks) ? orderBook.asks : [];
  if (!bids.length || !asks.length) {
    return { value: null, imbalance: null, spreadBps: null, bidDepth: null, askDepth: null, evidence: 'order_book_unavailable' };
  }

  const bidDepth = bids.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const askDepth = asks.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const totalDepth = bidDepth + askDepth;
  const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;

  const bestBid = Number(bids[0]?.price);
  const bestAsk = Number(asks[0]?.price);
  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = mid > 0 && Number.isFinite(bestBid) && Number.isFinite(bestAsk)
    ? ((bestAsk - bestBid) / mid) * 10000
    : null;

  const topN = Math.min(10, bids.length, asks.length);
  const topBid = bids.slice(0, topN).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const topAsk = asks.slice(0, topN).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const topTotal = topBid + topAsk;
  const topImbalance = topTotal > 0 ? (topBid - topAsk) / topTotal : 0;

  return {
    value: clamp((topImbalance + 1) / 2),
    imbalance,
    topImbalance,
    spreadBps,
    bidDepth,
    askDepth,
    evidence: 'real_order_book'
  };
}

export function calculateMicroAbsorption({ trades = [], candles = [] } = {}) {
  if (!Array.isArray(trades) || trades.length < 10 || !Array.isArray(candles) || candles.length < 2) {
    return { value: null, direction: null, evidence: 'insufficient_microstructure' };
  }

  const flow = calculateTradeFlow(trades);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const range = Math.max(Number(last?.high) - Number(last?.low), Number.EPSILON);
  const priceMove = (Number(last?.close) - Number(previous?.close)) / range;

  if (!Number.isFinite(priceMove) || flow.imbalance == null) {
    return { value: null, direction: null, evidence: 'invalid_microstructure' };
  }

  const directionalFlow = Math.abs(flow.imbalance);
  const displacementResistance = clamp(1 - Math.abs(priceMove));
  const value = clamp(0.7 * directionalFlow + 0.3 * displacementResistance);

  return {
    value,
    direction: flow.imbalance > 0.12 ? 'buy_absorption_candidate' : flow.imbalance < -0.12 ? 'sell_absorption_candidate' : 'neutral',
    flowImbalance: flow.imbalance,
    priceMove,
    evidence: 'trade_flow_plus_ohlcv'
  };
}

export function calculateExecutionSignature(trades = []) {
  const rows = Array.isArray(trades) ? trades
    .map(t => ({ q: Number(t.quantity), time: Number(t.time) }))
    .filter(t => Number.isFinite(t.q) && t.q > 0 && Number.isFinite(t.time))
    : [];

  if (rows.length < 20) return { value: null, fragmentation: null, burstiness: null, evidence: 'insufficient_trades' };

  const sizes = rows.map(t => t.q);
  const median = Math.max(percentile(sizes, 0.5), Number.EPSILON);
  const fragmentation = clamp(1 - percentile(sizes, 0.9) / (median * 12));

  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const gap = Math.max(0, rows[i].time - rows[i - 1].time);
    if (gap > 0) gaps.push(gap);
  }
  const gapMedian = percentile(gaps, 0.5);
  const gapP90 = percentile(gaps, 0.9);
  const burstiness = gapP90 > 0 ? clamp(1 - gapMedian / gapP90) : 0;

  return {
    value: clamp(0.55 * fragmentation + 0.45 * burstiness),
    fragmentation,
    burstiness,
    evidence: 'timing_and_trade_size_signature'
  };
}
