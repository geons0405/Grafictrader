import { calculateTradeFlow, calculateOrderBookDynamics } from '../mechanics/microstructure.js';
import { getGdeltEvents } from '../sources/gdelt.js';
import { getFinnhubEvents } from '../sources/finnhub.js';
import { getRssNews } from '../sources/news-feeds.js';
import { clamp } from './stats.js';

const NEWS_TTL_MS = 120_000;
const NEWS_WINDOW_MS = 3 * 60 * 60 * 1000;
let newsCache = { at: 0, events: [] };

/** Crypto-wide news, cached per instance so many requests share one fetch. */
export async function recentNews() {
  if (Date.now() - newsCache.at < NEWS_TTL_MS) return newsCache.events;
  const settled = await Promise.allSettled([getGdeltEvents('BTCUSDT'), getFinnhubEvents('BTCUSDT'), getRssNews('BTCUSDT')]);
  const events = settled.flatMap(r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []));
  newsCache = { at: Date.now(), events };
  return events;
}

export function newsSentiment(events, nowMs = Date.now()) {
  const recent = events.filter(e => nowMs - new Date(e.timestamp).getTime() <= NEWS_WINDOW_MS);
  const bull = recent.filter(e => e.sentiment === 'bullish').length;
  const bear = recent.filter(e => e.sentiment === 'bearish').length;
  const total = recent.length;
  return { score: total ? (bull - bear) / total : 0, bullish: bull, bearish: bear, total };
}

/**
 * Live context score in [-1, 1]: positive favours buyers.
 * Aggressor flow 40%, top-of-book depth 30%, news tone 30%.
 */
export function buildContext({ trades = [], orderBook = {}, news = [] } = {}) {
  const flow = calculateTradeFlow(trades);
  const book = calculateOrderBookDynamics(orderBook);
  const tone = newsSentiment(news);
  const parts = [];
  if (flow.imbalance != null) parts.push([flow.imbalance, 0.4]);
  if (book.topImbalance != null) parts.push([book.topImbalance, 0.3]);
  if (tone.total > 0) parts.push([tone.score, 0.3]);
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  const score = weight > 0 ? clamp(parts.reduce((s, [v, w]) => s + v * w, 0) / weight, -1, 1) : 0;
  return {
    score: Number(score.toFixed(3)),
    flow: flow.imbalance,
    largeFlow: flow.aggression ?? null,
    book: book.topImbalance ?? null,
    spreadBps: book.spreadBps ?? null,
    news: tone,
    available: parts.length > 0
  };
}
