import { fetchJson } from './http.js';
import { redis, redisConfigured } from '../redis.js';

// ForexFactory weekly calendar (faireconomy.media). The source allows ~2
// downloads per 5 minutes, so it is cached for 15 minutes (shared in Redis
// when available).
const URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const TTL_MS = 15 * 60 * 1000;
const CACHE_KEY = 'grafictrader:calendar:thisweek';
let local = { at: 0, events: null };

function normalize(raw) {
  return (Array.isArray(raw) ? raw : []).map(e => ({
    title: String(e.title || ''),
    currency: String(e.country || '').toUpperCase(),
    time: new Date(e.date).getTime(),
    impact: String(e.impact || 'Low'),
    forecast: e.forecast || '',
    previous: e.previous || '',
    actual: e.actual || ''
  })).filter(e => Number.isFinite(e.time) && e.title);
}

export async function getCalendar() {
  if (local.events && Date.now() - local.at < TTL_MS) return local.events;
  if (redisConfigured()) {
    try {
      const cached = await redis(['GET', CACHE_KEY]);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.at < TTL_MS) {
          local = parsed;
          return parsed.events;
        }
      }
    } catch { /* fall through to the source */ }
  }
  try {
    const events = normalize(await fetchJson(URL, { timeout: 8000 }));
    local = { at: Date.now(), events };
    if (redisConfigured()) redis(['SET', CACHE_KEY, JSON.stringify(local), 'EX', '3600']).catch(() => {});
    return events;
  } catch (error) {
    if (local.events) return local.events;
    throw error;
  }
}

// Which calendar currencies move which instrument. USD news moves almost
// everything (crypto included), so it is always relevant.
export function currenciesFor(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  const set = new Set(['USD']);
  for (const ccy of ['EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'CNY']) if (s.includes(ccy)) set.add(ccy);
  if (/XAU|XAG|GOLD|SILVER/.test(s)) set.add('USD');
  if (/GER|DE40|DAX/.test(s)) set.add('EUR');
  if (/UK100|FTSE/.test(s)) set.add('GBP');
  if (/JP225|NIKKEI/.test(s)) set.add('JPY');
  return [...set];
}

/**
 * High-impact events for the instrument's currencies from 15 min before to
 * 30 min after release: the classic "don't trade the news" window.
 */
export function eventRisk(events, symbol, nowMs = Date.now()) {
  const currencies = currenciesFor(symbol);
  const relevant = (events || []).filter(e => e.impact === 'High' && currencies.includes(e.currency));
  const active = relevant.find(e => nowMs >= e.time - 15 * 60000 && nowMs <= e.time + 30 * 60000) || null;
  const next = relevant.filter(e => e.time > nowMs).sort((a, b) => a.time - b.time)[0] || null;
  return {
    blocked: Boolean(active),
    event: active,
    next,
    minutesToNext: next ? Math.round((next.time - nowMs) / 60000) : null
  };
}
