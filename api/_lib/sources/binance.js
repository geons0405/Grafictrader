import { getTwelveDataTicker, getTwelveDataSparkline, getTwelveDataCandles } from './twelvedata.js';

const BINANCE_BASE = 'https://data-api.binance.vision/api/v3';

function isRestrictedLocation(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  return status === 451 || /restricted\s+location|eligibility/i.test(text);
}

async function binanceJson(path, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response;
    try {
      response = await fetch(BINANCE_BASE + path, { signal: controller.signal, cache: 'no-store' });
    } catch (error) {
      throw new Error(`Binance fetch failed: ${error?.message || error}`);
    }
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { msg: raw }; }
    if (!response.ok) {
      const error = new Error(data?.msg || `Binance HTTP ${response.status}`);
      error.binanceBlocked = isRestrictedLocation(response.status, raw);
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function getBinanceTickerRaw(symbols) {
  return Promise.all(symbols.map(async symbol => {
    const data = await binanceJson('/ticker/24hr?symbol=' + encodeURIComponent(symbol));
    return {
      symbol,
      price: Number(data.last),
      change24h: Number(data.priceChangePercent),
      lastPrice: Number(data.last),
      priceChangePercent: Number(data.priceChangePercent),
      volume24h: Number(data.quoteVolume),
      high24h: Number(data.highPrice),
      low24h: Number(data.lowPrice),
      timestamp: Date.now(),
      source: 'Binance'
    };
  }));
}

export async function getBinanceTicker(symbols = ['BTCUSDT', 'ETHUSDT']) {
  try {
    return await getBinanceTickerRaw(symbols);
  } catch (error) {
    console.warn(`[Binance] ticker indisponível; a usar Twelve Data: ${error?.message || error}`);
    const pairs = symbols.map(symbol => ({
      BTCUSDT: 'BTC/USD',
      ETHUSDT: 'ETH/USD',
      BNBUSDT: 'BNB/USD',
      SOLUSDT: 'SOL/USD',
      XRPUSDT: 'XRP/USD',
      ADAUSDT: 'ADA/USD',
      DOGEUSDT: 'DOGE/USD'
    }[symbol] || String(symbol).replace(/USDT$/i, '/USD')));
    return getTwelveDataTicker(pairs);
  }
}

export async function getBinanceMarketEvents(symbol = 'BTCUSDT') {
  try {
    const [data, sparkline] = await Promise.all([
      getBinanceTickerRaw([symbol]).then(rows => rows[0]),
      getSparklineRaw(symbol, '1h', 24)
    ]);
    return [{
      id: `binance-market-${symbol}-${Math.floor(Date.now() / 30000)}`,
      source: 'Binance',
      tag: 'MARKET',
      headline: `${symbol.replace('USDT', '/USDT')} ${data.change24h >= 0 ? 'em alta' : 'em baixa'}`,
      timestamp: new Date().toISOString(),
      sentiment: data.change24h > 0.15 ? 'bullish' : data.change24h < -0.15 ? 'bearish' : 'neutral',
      symbol,
      sparkline,
      metrics: data
    }];
  } catch (error) {
    console.warn(`[Binance] market event indisponível; a usar Twelve Data: ${error?.message || error}`);
    const tickers = await getTwelveDataTicker([{
      BTCUSDT: 'BTC/USD',
      ETHUSDT: 'ETH/USD',
      BNBUSDT: 'BNB/USD',
      SOLUSDT: 'SOL/USD',
      XRPUSDT: 'XRP/USD',
      ADAUSDT: 'ADA/USD',
      DOGEUSDT: 'DOGE/USD'
    }[symbol] || String(symbol).replace(/USDT$/i, '/USD')]);
    const data = tickers[0];
    const sparkline = await getTwelveDataSparkline(symbol, '1h', 24);
    if (!data) return [];
    return [{
      id: `twelvedata-market-${symbol}-${Math.floor(Date.now() / 30000)}`,
      source: 'Twelve Data',
      tag: 'MARKET',
      headline: `${symbol.replace('USDT', '/USDT')} ${data.change24h >= 0 ? 'em alta' : 'em baixa'}`,
      timestamp: new Date().toISOString(),
      sentiment: data.change24h > 0.15 ? 'bullish' : data.change24h < -0.15 ? 'bearish' : 'neutral',
      symbol,
      sparkline,
      metrics: data
    }];
  }
}

async function getSparklineRaw(symbol = 'BTCUSDT', interval = '1h', limit = 24) {
  const data = await binanceJson('/klines?' + new URLSearchParams({
    symbol, interval, limit: String(Math.min(limit, 100))
  }));
  return data.map(row => Number(row[4])).filter(Number.isFinite);
}

export async function getSparkline(symbol = 'BTCUSDT', interval = '1h', limit = 24) {
  try {
    return await getSparklineRaw(symbol, interval, limit);
  } catch (error) {
    console.warn(`[Binance] sparkline indisponível; a usar Twelve Data: ${error?.message || error}`);
    return getTwelveDataSparkline(symbol, interval, limit);
  }
}

export async function getBinanceCandles(symbol = 'BTCUSDT', interval = '5m', limit = 120) {
  try {
    const data = await binanceJson('/klines?' + new URLSearchParams({
      symbol, interval, limit: String(Math.min(limit, 1000))
    }));
    return data.map(row => ({
      time: Number(row[0]) / 1000,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }));
  } catch (error) {
    console.warn(`[Binance] candles indisponíveis; a usar Twelve Data: ${error?.message || error}`);
    return getTwelveDataCandles(symbol, interval, limit);
  }
}

export async function getBinanceAggTrades(symbol = 'BTCUSDT', limit = 500) {
  try {
    const data = await binanceJson('/aggTrades?' + new URLSearchParams({
      symbol,
      limit: String(Math.min(Number(limit) || 500, 1000))
    }));
    return data.map(row => ({
      id: row.a,
      price: Number(row.p),
      quantity: Number(row.q),
      time: Number(row.T),
      side: row.m ? 'sell' : 'buy'
    })).filter(row => Number.isFinite(row.price) && Number.isFinite(row.quantity) && Number.isFinite(row.time));
  } catch (error) {
    console.warn(`[Binance] aggTrades indisponíveis: ${error?.message || error}`);
    return [];
  }
}

export async function getBinanceOrderBook(symbol = 'BTCUSDT', limit = 100) {
  try {
    const data = await binanceJson('/depth?' + new URLSearchParams({
      symbol,
      limit: String(Math.min(Number(limit) || 100, 1000))
    }));
    return {
      bids: (data.bids || []).map(row => ({ price: Number(row[0]), quantity: Number(row[1]) }))
        .filter(row => Number.isFinite(row.price) && Number.isFinite(row.quantity)),
      asks: (data.asks || []).map(row => ({ price: Number(row[0]), quantity: Number(row[1]) }))
        .filter(row => Number.isFinite(row.price) && Number.isFinite(row.quantity)),
      lastUpdateId: data.lastUpdateId || null,
      source: 'Binance order book'
    };
  } catch (error) {
    console.warn(`[Binance] order book indisponível: ${error?.message || error}`);
    return { bids: [], asks: [], source: 'unavailable' };
  }
}

/** All Binance spot pairs quoted in USDT with 24h stats, sorted by volume. */
export async function getBinanceUsdtMarkets() {
  const rows = await binanceJson('/ticker/24hr', 12000);
  return (Array.isArray(rows) ? rows : [])
    .filter(r => /USDT$/.test(r.symbol) && Number(r.quoteVolume) > 0 && Number(r.count) > 0)
    .map(r => ({
      symbol: r.symbol,
      base: r.symbol.replace(/USDT$/, ''),
      price: Number(r.lastPrice),
      change24h: Number(r.priceChangePercent),
      volume24h: Number(r.quoteVolume)
    }))
    .sort((a, b) => b.volume24h - a.volume24h);
}
