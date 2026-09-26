const BINANCE_BASE = 'https://api.binance.com/api/v3';

async function binanceJson(path, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(BINANCE_BASE + path, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.msg || `Binance HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBinanceTicker(symbols = ['BTCUSDT', 'ETHUSDT']) {
  const rows = await Promise.all(symbols.map(async symbol => {
    const data = await binanceJson('/ticker/24hr?symbol=' + encodeURIComponent(symbol));
    return {
      symbol,
      price: Number(data.last),
      change24h: Number(data.priceChangePercent),
      volume24h: Number(data.quoteVolume),
      high24h: Number(data.highPrice),
      low24h: Number(data.lowPrice),
      timestamp: Date.now()
    };
  }));
  return rows;
}

export async function getBinanceMarketEvents(symbol = 'BTCUSDT') {
  const [data] = await getBinanceTicker([symbol]);
  return [{
    id: `binance-market-${symbol}-${Math.floor(Date.now() / 30000)}`,
    source: 'Binance',
    tag: 'MARKET',
    headline: `${symbol.replace('USDT', '/USDT')} ${data.change24h >= 0 ? 'em alta' : 'em baixa'}`,
    timestamp: new Date().toISOString(),
    sentiment: data.change24h > 0.15 ? 'bullish' : data.change24h < -0.15 ? 'bearish' : 'neutral',
    symbol,
    metrics: data
  }];
}

export async function getSparkline(symbol = 'BTCUSDT', interval = '1h', limit = 24) {
  const data = await binanceJson('/klines?' + new URLSearchParams({
    symbol, interval, limit: String(Math.min(limit, 100))
  }));
  return data.map(row => Number(row[4])).filter(Number.isFinite);
}
