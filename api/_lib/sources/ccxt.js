// Backup candle source when Binance cannot be reached (outage, blocked region):
// the same market from other exchanges through ccxt (github.com/ccxt/ccxt, MIT).
// ccxt is large, so it is only loaded when it is actually needed.

const EXCHANGES = ['okx', 'bybit', 'kraken'];
let clients = null;

/** "BTCUSDT" → "BTC/USDT" (ccxt's unified market name). */
export function toCcxtMarket(symbol) {
  const match = String(symbol || '').toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function exchanges() {
  if (!clients) {
    const { default: ccxt } = await import('ccxt');
    clients = EXCHANGES.map(id => new ccxt[id]({ timeout: 8000, enableRateLimit: false }));
  }
  return clients;
}

/** Candles from the first exchange that has the market, or [] when none answers. */
export async function getCcxtCandles(symbol, interval = '5m', limit = 120, startTimeSec = null) {
  const market = toCcxtMarket(symbol);
  if (!market) return [];
  for (const exchange of await exchanges().catch(() => [])) {
    try {
      if (!exchange.timeframes?.[interval]) continue;
      const rows = await exchange.fetchOHLCV(market, interval, startTimeSec ? Math.floor(startTimeSec * 1000) : undefined, Math.min(Number(limit) || 120, 300));
      const candles = (rows || [])
        .map(([time, open, high, low, close, volume]) => ({ time: time / 1000, open, high, low, close, volume: volume || 0 }))
        .filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));
      if (candles.length) return candles;
    } catch (error) {
      console.warn(`[ccxt] ${exchange.id} ${market} ${interval}: ${error?.message || error}`);
    }
  }
  return [];
}
