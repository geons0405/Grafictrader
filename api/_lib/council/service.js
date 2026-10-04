import { getBinanceCandles } from '../sources/binance.js';
import { getFearGreed } from '../sources/feargreed.js';
import { getRssNews, getYahooNews } from '../sources/news-feeds.js';
import { getMarketauxEvents } from '../sources/marketaux.js';
import { memo } from '../sources/http.js';
import { closedCandles } from '../mechanics/pattern-library.js';
import { runInstructor } from '../quant/service.js';
import { buildPlan } from '../quant/explain.js';
import {
  newsAnalyst, mathAnalyst, statsAnalyst, behaviourAnalyst, trendAnalyst, algorithmAnalyst, macroAnalyst, consensus
} from './analysts.js';
import { judge } from './judge.js';

// The council: seven analysts compute, the AI judge decides. Results are cached
// for a minute per market so free AI tiers are not exhausted.

const HIGHER = { '1m': ['15m', '1h'], '3m': ['15m', '1h'], '5m': ['1h', '4h'], '15m': ['1h', '4h'], '30m': ['4h', '1d'], '1h': ['4h', '1d'], '2h': ['4h', '1d'], '4h': ['1d', '1w'], '1d': ['1w', '1M'] };
const CACHE_MS = 60_000;
const cache = new Map();
const cachedFearGreed = memo(10 * 60_000, getFearGreed);
const newsCache = new Map();

const rows = raw => raw.map(c => ({ time: +c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 }));

async function newsFor(symbol) {
  const hit = newsCache.get(symbol);
  if (hit && Date.now() - hit.at < 3 * 60_000) return hit.events;
  const settled = await Promise.allSettled([getRssNews(symbol), getYahooNews(symbol), getMarketauxEvents(symbol)]);
  const events = settled.flatMap(r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []));
  newsCache.set(symbol, { at: Date.now(), events });
  return events;
}

/** Entry, stop and target in the verdict's direction (the engine's plan when it agrees). */
function planFor(decision, view) {
  if (decision === 'AGUARDAR') return null;
  const side = decision === 'COMPRAR' ? 1 : -1;
  if (view.plan && view.plan.side === side) return view.plan;
  return buildPlan(null, { direction: side, setup: 'trend' }, view.quant, view.price);
}

async function computeCouncil(symbol, interval) {
  const [mid, high] = HIGHER[interval] || ['1h', '4h'];
  const [view, midRaw, highRaw, news, fearGreed] = await Promise.all([
    runInstructor(symbol, interval),
    getBinanceCandles(symbol, mid, 200).catch(() => []),
    getBinanceCandles(symbol, high, 200).catch(() => []),
    newsFor(symbol).catch(() => []),
    cachedFearGreed().catch(() => null)
  ]);
  const base = closedCandles(rows(await getBinanceCandles(symbol, interval, 300)), interval);
  const analysts = [
    algorithmAnalyst(view.signal, view.summary),
    trendAnalyst({ base, mid: rows(midRaw), high: rows(highRaw), labels: { base: interval, mid, high } }),
    statsAnalyst(view.quant),
    mathAnalyst(base),
    behaviourAnalyst(view.quant, view.context, fearGreed),
    newsAnalyst(news),
    macroAnalyst(view.context, true)
  ];
  const numbers = consensus(analysts);
  const verdict = await judge({ symbol, interval, price: view.price, analysts, consensus: numbers });
  return {
    ok: true,
    symbol,
    interval,
    price: view.price,
    updatedAt: new Date().toISOString(),
    analysts,
    consensus: numbers,
    verdict,
    plan: planFor(verdict.decision, view)
  };
}

export function runCouncil(symbol, interval) {
  const key = symbol + ':' + interval;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = computeCouncil(symbol, interval);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
