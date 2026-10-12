import { redis, redisConfigured } from './redis.js';
import { getBinanceCandles } from './sources/binance.js';

// Every BUY/SELL the app shows (FOTO, Minha corretora) is recorded with the
// live price at that moment and checked later against what the price really
// did, using the same rules as the demo robot: stop at 1.5 ATR, target at 2R,
// at most 24 candles. This is the app's honest track record.

const STOP_ATR = 1.5;
const TARGET_R = 2;
export const HORIZON_BARS = 24;
const DAYS_KEPT = 30;
const MAX_PER_DAY = 3000;
const SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };

const dayOf = sec => new Date(sec * 1000).toISOString().slice(0, 10);
const dayKey = day => 'grafictrader:signals:' + day;

async function readDay(day) {
  try { return JSON.parse((await redis(['GET', dayKey(day)])) || '[]'); } catch { return []; }
}

async function writeDay(day, list) {
  await redis(['SET', dayKey(day), JSON.stringify(list.slice(-MAX_PER_DAY)), 'EX', String(DAYS_KEPT * 86_400)]);
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Read-modify-write of one day under a short lock, so a signal recorded while
 * results are being saved (or two signals at once) is never lost.
 */
async function updateDay(day, change) {
  const lock = dayKey(day) + ':lock';
  const token = Math.random().toString(36).slice(2);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await redis(['SET', lock, token, 'NX', 'EX', '10'])) === 'OK') {
      try {
        const list = await readDay(day);
        if (change(list) !== false) await writeDay(day, list);
        return true;
      } finally {
        if ((await redis(['GET', lock])) === token) await redis(['DEL', lock]);
      }
    }
    await pause(50 + Math.random() * 100);
  }
  return false;
}

/**
 * Records one shown signal. The same source, market and side is recorded at
 * most once per candle, so the live watch (a frame every few seconds) does
 * not count the same call many times. Never throws.
 */
export async function recordSignal({ source, symbol, interval, side, price, atr, confidence = null, at = Date.now() / 1000 }) {
  try {
    if (!redisConfigured() || !SECONDS[interval] || ![1, -1].includes(side)) return false;
    if (!(price > 0) || !(atr > 0)) return false;
    const bucket = Math.floor(at / SECONDS[interval]);
    const fresh = await redis(['SET', `grafictrader:sigseen:${source}:${symbol}:${interval}:${side}:${bucket}`, '1', 'NX', 'EX', String(SECONDS[interval] * 2)]);
    if (fresh !== 'OK') return false;
    const entry = {
      id: `${Math.round(at)}-${source}-${symbol}-${interval}-${side}`,
      at: Math.round(at),
      source,
      symbol,
      interval,
      side,
      entry: price,
      stop: price - side * STOP_ATR * atr,
      target: price + side * TARGET_R * STOP_ATR * atr,
      confidence,
      outcome: null
    };
    return await updateDay(dayOf(at), list => { list.push(entry); });
  } catch {
    return false;
  }
}

/** Outcome of one signal from the candles after it, or null while still open. Pure, for tests. */
export function judgeSignal(signal, after) {
  const bars = after.filter(c => c.time > signal.at).slice(0, HORIZON_BARS);
  const risk = Math.abs(signal.entry - signal.stop);
  if (!risk) return { outcome: 'flat', r: 0, bars: 0 };
  for (let i = 0; i < bars.length; i++) {
    const c = bars[i];
    const hitStop = signal.side > 0 ? c.low <= signal.stop : c.high >= signal.stop;
    const hitTarget = signal.side > 0 ? c.high >= signal.target : c.low <= signal.target;
    // Both in one candle counts as the stop (we cannot know which came first).
    if (hitStop) {
      const fill = signal.side > 0 ? Math.min(signal.stop, c.open) : Math.max(signal.stop, c.open);
      return { outcome: 'loss', r: Number((((fill - signal.entry) * signal.side) / risk).toFixed(2)), bars: i + 1 };
    }
    if (hitTarget) return { outcome: 'win', r: TARGET_R, bars: i + 1 };
  }
  if (bars.length < HORIZON_BARS) return null;
  const r = ((bars.at(-1).close - signal.entry) * signal.side) / risk;
  return { outcome: r > 0.05 ? 'win' : r < -0.05 ? 'loss' : 'flat', r: Number(r.toFixed(2)), bars: bars.length };
}

/** Checks pending signals whose horizon has passed. Returns how many were settled. */
export async function verifySignals({ maxFetches = 12, now = Date.now() / 1000 } = {}) {
  if (!redisConfigured()) return 0;
  let settled = 0;
  let fetches = 0;
  for (let d = DAYS_KEPT - 1; d >= 0 && fetches < maxFetches; d--) {
    const day = dayOf(now - d * 86_400);
    const list = await readDay(day);
    const due = list.filter(s => !s.outcome && now > s.at + (HORIZON_BARS + 1) * SECONDS[s.interval]);
    if (!due.length) continue;
    // One candle request per market and timeframe covers all its signals of the day.
    const groups = new Map();
    for (const s of due) {
      const key = s.symbol + ':' + s.interval;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const results = new Map();
    for (const group of groups.values()) {
      if (fetches >= maxFetches) break;
      const first = Math.min(...group.map(s => s.at));
      const last = Math.max(...group.map(s => s.at));
      const span = Math.ceil((last - first) / SECONDS[group[0].interval]) + HORIZON_BARS + 2;
      fetches += 1;
      const candles = await getBinanceCandles(group[0].symbol, group[0].interval, Math.min(1000, span), first).catch(() => []);
      for (const s of group) {
        const result = judgeSignal(s, candles);
        if (result) results.set(s.id, { ...result, checkedAt: Math.round(now) });
      }
    }
    // Saved on a fresh copy of the day, under the lock: signals added meanwhile stay.
    if (results.size) {
      await updateDay(day, fresh => {
        for (const s of fresh) {
          if (!s.outcome && results.has(s.id)) {
            Object.assign(s, results.get(s.id));
            settled += 1;
          }
        }
      });
    }
  }
  return settled;
}

/** Aggregates settled signals by source and timeframe. */
export function signalStats(signals) {
  const groups = {};
  const add = (key, s) => {
    const g = groups[key] ||= { signals: 0, settled: 0, wins: 0, losses: 0, flat: 0, totalR: 0 };
    g.signals += 1;
    if (!s.outcome) return;
    g.settled += 1;
    g[s.outcome === 'win' ? 'wins' : s.outcome === 'loss' ? 'losses' : 'flat'] += 1;
    g.totalR += s.r || 0;
  };
  for (const s of signals) {
    add('total', s);
    add('source:' + s.source, s);
    add('interval:' + s.interval, s);
  }
  for (const g of Object.values(groups)) {
    g.winRate = g.settled ? Math.round((g.wins / g.settled) * 1000) / 10 : null;
    g.avgR = g.settled ? Number((g.totalR / g.settled).toFixed(2)) : null;
    g.totalR = Number(g.totalR.toFixed(2));
  }
  return groups;
}

/** Signals of the last `days` days, newest first. */
export async function recentSignals(days = 14, now = Date.now() / 1000) {
  const all = [];
  for (let d = 0; d < days; d++) all.push(...await readDay(dayOf(now - d * 86_400)));
  return all.sort((a, b) => b.at - a.at);
}
