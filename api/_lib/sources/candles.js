import { getBinanceCandles } from './binance.js';
import { getYahooCandles, isYahooMarket } from './yahoo.js';

/** Candles for any market the engine reads: crypto from Binance (with backups), forex and gold from Yahoo. */
export function getCandles(symbol, interval, limit, startTimeSec = null) {
  return isYahooMarket(symbol) ? getYahooCandles(symbol, interval, limit, startTimeSec) : getBinanceCandles(symbol, interval, limit, startTimeSec);
}
