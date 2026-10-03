import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from '../sources/binance.js';
import { redis, redisConfigured } from '../redis.js';
import { closedCandles } from '../mechanics/pattern-library.js';
import { quantSnapshot, decide, regimeLabel } from './signal.js';
import { emptyState, advance, summarize } from './instructor.js';
import { buildContext, recentNews } from './context.js';

const HISTORY = 1000;
const stateKey = (symbol, interval) => `grafictrader:instructor:${symbol}:${interval}`;
const lockKey = (symbol, interval) => `grafictrader:instructor-lock:${symbol}:${interval}`;

function normalize(candles) {
  return candles
    .map(c => ({ time: Number(c.time), open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 }))
    .filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));
}

/** Live market context for one symbol: aggressor flow, book depth and news tone. */
export async function liveContext(symbol) {
  const [trades, orderBook, news] = await Promise.all([
    getBinanceAggTrades(symbol, 500),
    getBinanceOrderBook(symbol, 100),
    recentNews().catch(() => [])
  ]);
  return { context: buildContext({ trades, orderBook, news }), orderBook };
}

const CACHE_MS = 8000;
const cache = new Map();

/**
 * Runs the AI instructor for a market.
 * With Redis the account state persists, so every decision is locked in at
 * the moment it was made (including its live context). Without Redis the
 * instructor is replayed deterministically from the candle history, so all
 * users still see the same operations.
 */
export function runInstructor(symbol, interval) {
  // Short per-instance cache: the desk and the single view share one run.
  const key = symbol + ':' + interval;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = computeInstructor(symbol, interval);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

async function computeInstructor(symbol, interval) {
  const [raw, live] = await Promise.all([
    getBinanceCandles(symbol, interval, HISTORY),
    liveContext(symbol)
  ]);
  const candles = normalize(raw);
  if (candles.length < 260) {
    const error = new Error('Histórico de velas insuficiente para o instrutor.');
    error.status = 502;
    throw error;
  }
  const closed = closedCandles(candles, interval);
  const livePrice = candles.at(-1).close;

  let state = null;
  let mode = 'replay';
  if (redisConfigured()) {
    mode = 'persistent';
    try {
      const stored = await redis(['GET', stateKey(symbol, interval)]);
      state = stored ? JSON.parse(stored) : null;
      const lock = await redis(['SET', lockKey(symbol, interval), '1', 'NX', 'EX', '10']);
      if (lock === 'OK') {
        state = advance(state || emptyState(symbol, interval), closed, { context: live.context });
        await redis(['SET', stateKey(symbol, interval), JSON.stringify(state)]);
        await redis(['DEL', lockKey(symbol, interval)]);
      } else if (!state) {
        state = advance(emptyState(symbol, interval), closed);
      }
    } catch {
      mode = 'replay';
      state = null;
    }
  }
  if (!state) state = advance(emptyState(symbol, interval), closed, { context: live.context });

  const snapshot = quantSnapshot(closed);
  const now = decide(snapshot, live.context);

  return {
    ok: true,
    symbol,
    interval,
    mode,
    updatedAt: new Date().toISOString(),
    price: livePrice,
    summary: summarize(state, livePrice),
    trades: state.trades.slice(-30),
    equity: state.equity,
    log: state.log.slice(-40),
    lastDecision: state.lastDecision,
    signal: { ...now, regime: snapshot?.regime ?? null, regimeLabel: regimeLabel(snapshot?.regime) },
    quant: snapshot,
    context: live.context,
    orderBook: {
      bids: (live.orderBook.bids || []).slice(0, 12),
      asks: (live.orderBook.asks || []).slice(0, 12)
    }
  };
}

/** Quant reading + live context for one market, used to cross-check photo analysis. */
export async function marketReading(symbol, interval) {
  const [raw, live] = await Promise.all([getBinanceCandles(symbol, interval, 300), liveContext(symbol)]);
  const closed = closedCandles(normalize(raw), interval);
  const snapshot = quantSnapshot(closed);
  const signal = decide(snapshot, live.context);
  return { snapshot, signal: { ...signal, regimeLabel: regimeLabel(snapshot?.regime) }, context: live.context, price: raw.at(-1)?.close ?? null };
}
