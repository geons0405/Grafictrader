import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from '../sources/binance.js';
import { redis, redisConfigured } from '../redis.js';
import { closedCandles } from '../mechanics/pattern-library.js';
import { quantSnapshot, decide, regimeLabel } from './signal.js';
import { emptyState, advance, summarize } from './instructor.js';
import { buildContext, recentNews } from './context.js';
import { explainPlain, buildPlan } from './explain.js';
import { getCalendar, eventRisk } from '../sources/calendar.js';
import { getGlobalMarkets, riskSentiment } from '../sources/global-markets.js';
import { memo } from '../sources/http.js';

const cachedCalendar = memo(5 * 60 * 1000, getCalendar);
const cachedGlobal = memo(60 * 1000, getGlobalMarkets);

export async function macroContext(symbol) {
  const [calendar, markets] = await Promise.all([cachedCalendar().catch(() => []), cachedGlobal().catch(() => [])]);
  return { eventRisk: eventRisk(calendar, symbol), global: riskSentiment(markets) };
}


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
  const [trades, orderBook, news, macro] = await Promise.all([
    getBinanceAggTrades(symbol, 500),
    getBinanceOrderBook(symbol, 100),
    recentNews().catch(() => []),
    macroContext(symbol)
  ]);
  return { context: { ...buildContext({ trades, orderBook, news }), ...macro }, orderBook };
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

  return instructorView({ symbol, interval, mode, state, closed, livePrice, context: live.context, orderBook: live.orderBook });
}

/** Shapes the instructor response; shared by Binance and MetaTrader 5 feeds. */
export function instructorView({ symbol, interval, mode, state, closed, livePrice, context, orderBook = null }) {
  const snapshot = quantSnapshot(closed);
  const now = decide(snapshot, context);
  const summary = summarize(state, livePrice);
  const plan = buildPlan(summary, now, snapshot, livePrice);
  const guidance = explainPlain({ decision: now, snapshot, context, plan });
  return {
    ok: true,
    symbol,
    interval,
    mode,
    updatedAt: new Date().toISOString(),
    price: livePrice,
    summary,
    guidance,
    plan,
    trades: state.trades.slice(-30),
    equity: state.equity,
    log: state.log.slice(-40),
    lastDecision: state.lastDecision,
    signal: { ...now, regime: snapshot?.regime ?? null, regimeLabel: regimeLabel(snapshot?.regime) },
    quant: snapshot,
    context,
    orderBook: orderBook ? { bids: (orderBook.bids || []).slice(0, 12), asks: (orderBook.asks || []).slice(0, 12) } : null
  };
}

/** Replays the instructor on candles supplied by a MetaTrader 5 bridge. */
export async function instructorFromCandles(symbol, interval, candles, livePrice) {
  const rows = normalize(candles);
  const closed = closedCandles(rows, interval);
  const macro = await macroContext(symbol).catch(() => ({}));
  const context = { score: 0, flow: null, book: null, news: { score: 0, total: 0 }, available: false, ...macro };
  const state = advance(emptyState(symbol, interval), closed, { context });
  return instructorView({ symbol, interval, mode: 'mt5', state, closed, livePrice: livePrice ?? rows.at(-1)?.close, context });
}

/** Quant reading + live context for one market, used to cross-check photo analysis. */
export async function marketReading(symbol, interval) {
  const [raw, live] = await Promise.all([getBinanceCandles(symbol, interval, 300), liveContext(symbol)]);
  const closed = closedCandles(normalize(raw), interval);
  const snapshot = quantSnapshot(closed);
  const signal = decide(snapshot, live.context);
  const price = raw.at(-1)?.close ?? null;
  const guidance = explainPlain({ decision: signal, snapshot, context: live.context, plan: buildPlan(null, signal, snapshot, price) });
  return { snapshot, signal: { ...signal, regimeLabel: regimeLabel(snapshot?.regime) }, context: live.context, price, guidance };
}
