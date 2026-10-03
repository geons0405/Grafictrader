import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from '../sources/binance.js';
import { analyzeMarketMechanics } from './index.js';
import { buildMechanicsMemory } from './memory.js';
import { loadPatternLibrary, rememberPatternFamily, HORIZONS } from './pattern-library.js';

const LIVE_CANDLES = 120;
// 240 candles = 12 memory windows of 20 bars (MAX_WINDOWS in memory.js).
const MEMORY_CANDLES = 240;

/**
 * Computes the full mechanics reading for a market. Shared by /api/mechanics
 * and /api/mechanics-ai so the AI never interprets client-supplied numbers.
 */
export async function buildMechanicsSnapshot(symbol, interval, { persist = false } = {}) {
  const [history, trades, orderBook] = await Promise.all([
    getBinanceCandles(symbol, interval, MEMORY_CANDLES),
    getBinanceAggTrades(symbol, 500),
    getBinanceOrderBook(symbol, 100)
  ]);

  if (!Array.isArray(history) || history.length < 2) {
    const error = new Error('Dados de candles insuficientes.');
    error.status = 502;
    throw error;
  }

  const candles = history.slice(-LIVE_CANDLES);
  const mechanics = analyzeMarketMechanics(candles, { trades, orderBook });
  const memory = buildMechanicsMemory(history);
  const library = await loadPatternLibrary(symbol, interval);
  const saved = persist && library.available
    ? await rememberPatternFamily(symbol, interval, memory.patternFamily, history)
    : { saved: false };
  const hasTrades = trades.length >= 10;
  const hasOrderBook = orderBook?.bids?.length > 0 && orderBook?.asks?.length > 0;

  return {
    ok: true,
    symbol,
    interval,
    updatedAt: new Date().toISOString(),
    source: hasTrades || hasOrderBook ? 'Binance microstructure + market data' : 'market data fallback',
    dataQuality: {
      candles: candles.length,
      memoryCandles: history.length,
      trades: hasTrades,
      tradeCount: trades.length,
      orderBook: hasOrderBook,
      bidLevels: orderBook?.bids?.length || 0,
      askLevels: orderBook?.asks?.length || 0
    },
    ...mechanics,
    memory,
    patternLibrary: {
      available: library.available,
      reason: library.reason,
      saved: Boolean(saved.saved),
      patternCount: saved.patternCount ?? library.patterns.length,
      patterns: saved.patterns || library.patterns,
      historicalOutcomes: true,
      outcomeHorizonsBars: HORIZONS
    }
  };
}
