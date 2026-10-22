import YahooFinance from 'yahoo-finance2';
import { FOREX_MARKETS } from '../markets.js';

// Real forex and gold candles from Yahoo Finance (github.com/gadicc/node-yahoo-finance2, MIT).
// Not an official API: Yahoo can change it, so callers treat an empty list as "no data".

/** Markets read from Yahoo: our id → Yahoo symbol. */
export const YAHOO_MARKETS = FOREX_MARKETS;

export const isYahooMarket = symbol => Object.hasOwn(YAHOO_MARKETS, symbol);

// Yahoo intervals; 4h is built from 1h candles. 1d and 1w are read by the council.
const YAHOO_INTERVAL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '60m', '4h': '60m', '1d': '1d', '1w': '1wk' };
const SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
// How far back Yahoo serves each interval.
const MAX_DAYS = { '1m': 7, '5m': 59, '15m': 59, '1h': 700, '4h': 700, '1d': 20000, '1w': 20000 };

let client = null;

/** Groups 1h candles into 4h candles aligned to 00:00, 04:00… UTC. */
export function toFourHours(candles) {
  const groups = new Map();
  for (const c of candles) {
    const start = Math.floor(c.time / 14400) * 14400;
    const g = groups.get(start);
    if (!g) groups.set(start, { ...c, time: start });
    else Object.assign(g, { high: Math.max(g.high, c.high), low: Math.min(g.low, c.low), close: c.close, volume: g.volume + c.volume });
  }
  return [...groups.values()].sort((a, b) => a.time - b.time);
}

export async function getYahooCandles(symbol, interval = '5m', limit = 120, startTimeSec = null) {
  const ticker = YAHOO_MARKETS[symbol];
  if (!ticker || !YAHOO_INTERVAL[interval]) return [];
  const now = Math.floor(Date.now() / 1000);
  // Markets close at weekends: ask for more time than the candles alone would need.
  const wanted = startTimeSec || now - Math.ceil(limit * SECONDS[interval] * 2.2) - 3 * 86_400;
  const from = Math.max(wanted, now - MAX_DAYS[interval] * 86_400 + 60);
  try {
    client ||= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const result = await client.chart(ticker, { period1: new Date(from * 1000), interval: YAHOO_INTERVAL[interval] }, { validateResult: false });
    let candles = (result?.quotes || [])
      .map(q => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume || 0 }))
      .filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));
    // Forex has no exchange volume (Yahoo sends 0): every candle weighs the same, like tick
    // volume, so the volume-weighted parts of the engine (flow, VWAP) still work.
    if (candles.length && candles.every(c => !c.volume)) candles = candles.map(c => ({ ...c, volume: 1 }));
    if (interval === '4h') candles = toFourHours(candles);
    return startTimeSec ? candles.slice(0, limit) : candles.slice(-limit);
  } catch (error) {
    console.warn(`[Yahoo] ${ticker} ${interval}: ${error?.message || error}`);
    return [];
  }
}

/** 24h figures for a forex pair or gold, from its last day of hourly candles (Yahoo's chart has no ticker). */
export async function getYahooTicker(symbol) {
  const hours = await getYahooCandles(symbol, '1h', 30);
  if (!hours.length) return null;
  const now = hours.at(-1);
  const day = hours.filter(c => c.time > now.time - 86_400);
  const open = day[0]?.open ?? now.open;
  return {
    symbol,
    source: 'Yahoo Finance',
    price: now.close,
    change24h: open ? ((now.close - open) / open) * 100 : 0,
    volume24h: 0,
    high24h: Math.max(...day.map(c => c.high)),
    low24h: Math.min(...day.map(c => c.low)),
    timestamp: Date.now()
  };
}
