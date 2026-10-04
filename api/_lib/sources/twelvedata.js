import { apiKey as readApiKey } from '../env.js';
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';

const SYMBOL_MAP = {
  BTCUSDT: 'BTC/USD',
  ETHUSDT: 'ETH/USD',
  BNBUSDT: 'BNB/USD',
  SOLUSDT: 'SOL/USD',
  XRPUSDT: 'XRP/USD',
  ADAUSDT: 'ADA/USD',
  DOGEUSDT: 'DOGE/USD'
};

const INTERVAL_MAP = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h'
};

async function twelveJson(path, timeout = 9000) {
  const apiKey = readApiKey('TWELVE_DATA_API_KEY');
  if (!apiKey) {
    console.warn('[Twelve Data] TWELVE_DATA_API_KEY não configurada; fonte ignorada.');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(TWELVE_DATA_BASE + path, {
      signal: controller.signal,
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status === 'error' || data?.code) {
      throw new Error(data?.message || data?.status || `Twelve Data HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function toPair(symbol) {
  return SYMBOL_MAP[String(symbol).toUpperCase()] || String(symbol).replace(/USDT$/i, '/USD');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getTwelveDataTicker(pairs = ['BTC/USD', 'ETH/USD']) {
  if (!readApiKey('TWELVE_DATA_API_KEY')) {
    console.warn('[Twelve Data] TWELVE_DATA_API_KEY não configurada; ticker fallback ignorado.');
    return [];
  }

  const rows = await Promise.all(pairs.map(async pair => {
    try {
      const data = await twelveJson('/quote?' + new URLSearchParams({
        symbol: pair,
        apikey: readApiKey('TWELVE_DATA_API_KEY')
      }));
      if (!data) return null;
      const symbol = Object.keys(SYMBOL_MAP).find(key => SYMBOL_MAP[key] === pair) || pair.replace('/', '');
      const price = toNumber(data.close ?? data.price);
      const change = toNumber(data.percent_change ?? data.percentChange);
      if (!Number.isFinite(price)) return null;
      return {
        symbol,
        price,
        change24h: Number.isFinite(change) ? change : 0,
        lastPrice: price,
        priceChangePercent: Number.isFinite(change) ? change : 0,
        volume24h: toNumber(data.volume) || 0,
        high24h: toNumber(data.high) || price,
        low24h: toNumber(data.low) || price,
        timestamp: Date.now(),
        source: 'Twelve Data'
      };
    } catch (error) {
      console.warn(`[Twelve Data] ticker ${pair} falhou: ${error?.message || error}`);
      return null;
    }
  }));

  return rows.filter(Boolean);
}

export async function getTwelveDataSparkline(symbol = 'BTCUSDT', interval = '15min', limit = 20) {
  if (!readApiKey('TWELVE_DATA_API_KEY')) {
    console.warn('[Twelve Data] TWELVE_DATA_API_KEY não configurada; sparkline fallback ignorado.');
    return [];
  }

  try {
    const pair = toPair(symbol);
    const tdInterval = INTERVAL_MAP[interval] || interval;
    const data = await twelveJson('/time_series?' + new URLSearchParams({
      symbol: pair,
      interval: tdInterval,
      outputsize: String(Math.min(Number(limit) || 20, 5000)),
      order: 'ASC',
      apikey: readApiKey('TWELVE_DATA_API_KEY')
    }));
    if (!data?.values) return [];
    return data.values.map(row => toNumber(row.close)).filter(Number.isFinite);
  } catch (error) {
    console.warn(`[Twelve Data] sparkline ${symbol} falhou: ${error?.message || error}`);
    return [];
  }
}

export async function getTwelveDataCandles(symbol = 'BTCUSDT', interval = '5m', limit = 120) {
  if (!readApiKey('TWELVE_DATA_API_KEY')) {
    console.warn('[Twelve Data] TWELVE_DATA_API_KEY não configurada; candles fallback ignorados.');
    return [];
  }

  try {
    const pair = toPair(symbol);
    const tdInterval = INTERVAL_MAP[interval] || interval;
    const data = await twelveJson('/time_series?' + new URLSearchParams({
      symbol: pair,
      interval: tdInterval,
      outputsize: String(Math.min(Number(limit) || 120, 5000)),
      order: 'ASC',
      apikey: readApiKey('TWELVE_DATA_API_KEY')
    }));
    if (!data?.values) return [];
    return data.values.map(row => ({
      time: Math.floor(new Date(row.datetime).getTime() / 1000),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume) || 0
    })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.close) && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low));
  } catch (error) {
    console.warn(`[Twelve Data] candles ${symbol} falharam: ${error?.message || error}`);
    return [];
  }
}
