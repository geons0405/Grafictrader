import { randomBytes } from 'node:crypto';
import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from '../sources/binance.js';
import { redis, redisConfigured } from '../redis.js';
import { closedCandles } from '../mechanics/pattern-library.js';
import { lastCandlePatterns } from './patterns.js';
import { getCandles } from '../sources/candles.js';
import { isYahooMarket } from '../sources/yahoo.js';
import { quantSnapshot, decide, regimeLabel } from './signal.js';
import { emptyState, advance, summarize, STATE_VERSION } from './instructor.js';
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
      state = await advanceStored(stateKey(symbol, interval), lockKey(symbol, interval), symbol, interval, closed, live.context);
    } catch {
      mode = 'replay';
      state = null;
    }
  }
  if (!state) state = advance(emptyState(symbol, interval), closed, { context: live.context });

  return instructorView({ symbol, interval, mode, state, closed, livePrice, context: live.context, orderBook: live.orderBook });
}

/**
 * Advances a persisted instructor state under a lock. The state is read only
 * after the lock is taken (so two requests can never both advance an old
 * copy), the lock carries a token so only its owner releases it, and a write
 * that would go back in time is skipped. Without the lock the stored state is
 * shown as it is.
 */
export async function advanceStored(key, lock, symbol, interval, closed, context, { ttl = null } = {}) {
  const token = randomBytes(12).toString('hex');
  const locked = (await redis(['SET', lock, token, 'NX', 'EX', '30'])) === 'OK';
  try {
    const stored = await redis(['GET', key]);
    let state = stored ? JSON.parse(stored) : null;
    // An account saved before costs and gap fills were counted starts again.
    if (state && state.version !== STATE_VERSION) state = null;
    if (!locked) return state || advance(emptyState(symbol, interval), closed);
    const before = state?.lastTime ?? null;
    state = advance(state || emptyState(symbol, interval), closed, { context });
    if (before == null || state.lastTime > before) {
      await redis(ttl ? ['SET', key, JSON.stringify(state), 'EX', String(ttl)] : ['SET', key, JSON.stringify(state)]);
    }
    return state;
  } finally {
    if (locked && (await redis(['GET', lock])) === token) await redis(['DEL', lock]);
  }
}

/** At most `max` balance points, always keeping the changes and the last one: smaller answers on mobile data. */
export function thinEquity(points, max = 200) {
  if (points.length <= max) return points;
  const changes = points.filter((p, i) => i === 0 || i === points.length - 1 || p.value !== points[i - 1].value);
  if (changes.length <= max) return changes;
  const step = changes.length / max;
  return Array.from({ length: max }, (_, i) => changes[Math.min(changes.length - 1, Math.floor(i * step))]).concat(changes.at(-1));
}

/** Shapes the instructor response; shared by Binance and MetaTrader 5 feeds. */
export function instructorView({ symbol, interval, mode, state, closed, livePrice, context, orderBook = null }) {
  const snapshot = quantSnapshot(closed);
  const now = decide(snapshot, context);
  const summary = summarize(state, livePrice);
  const plan = buildPlan(summary, now, snapshot, livePrice);
  const patterns = lastCandlePatterns(closed);
  const guidance = explainPlain({ decision: now, snapshot, context, plan, patterns });
  return {
    ok: true,
    symbol,
    interval,
    mode,
    updatedAt: new Date().toISOString(),
    price: livePrice,
    summary,
    guidance,
    patterns,
    plan,
    trades: state.trades.slice(-30),
    equity: thinEquity(state.equity),
    log: state.log.slice(-40),
    lastDecision: state.lastDecision,
    signal: { ...now, regime: snapshot?.regime ?? null, regimeLabel: regimeLabel(snapshot?.regime) },
    quant: snapshot,
    context,
    orderBook: orderBook ? { bids: (orderBook.bids || []).slice(0, 12), asks: (orderBook.asks || []).slice(0, 12) } : null
  };
}

/**
 * Instructor on candles supplied by a MetaTrader 5 bridge. With `owner` (the
 * account email) and Redis, the state is kept like the Binance one, so past
 * trades never change when the candle window slides.
 */
export async function instructorFromCandles(symbol, interval, candles, livePrice, owner = null) {
  const rows = normalize(candles);
  const closed = closedCandles(rows, interval);
  const macro = await macroContext(symbol).catch(() => ({}));
  const context = { score: 0, flow: null, book: null, news: { score: 0, total: 0 }, available: false, ...macro };
  let state = null;
  if (owner && redisConfigured()) {
    const base = `grafictrader:mt5state:${owner}:${symbol}:${interval}`;
    try { state = await advanceStored(base, base + ':lock', symbol, interval, closed, context, { ttl: 14 * 24 * 3600 }); } catch { state = null; }
  }
  if (!state) state = advance(emptyState(symbol, interval), closed, { context });
  return instructorView({ symbol, interval, mode: 'mt5', state, closed, livePrice: livePrice ?? rows.at(-1)?.close, context });
}

/** Quant reading + live context for one market, used to cross-check photo analysis. */
/**
 * Engine reading of a market. `withContext: false` skips the order flow, news and
 * macro calendar: a quick chart-only cross-check for FOTO and the live screen,
 * where the answer has to come fast.
 */
export async function marketReading(symbol, interval, { withContext = true } = {}) {
  const [raw, live] = await Promise.all([
    getCandles(symbol, interval, 300),
    // Order flow and the order book come from Binance: crypto only.
    withContext && !isYahooMarket(symbol) ? liveContext(symbol) : Promise.resolve({ context: {} })
  ]);
  const closed = closedCandles(normalize(raw), interval);
  const snapshot = quantSnapshot(closed);
  const signal = decide(snapshot, live.context);
  const price = raw.at(-1)?.close ?? null;
  const patterns = lastCandlePatterns(closed);
  const guidance = explainPlain({ decision: signal, snapshot, context: live.context, plan: buildPlan(null, signal, snapshot, price), patterns });
  return { snapshot, signal: { ...signal, regimeLabel: regimeLabel(snapshot?.regime) }, context: live.context, price, guidance, patterns };
}
