import { redis, redisConfigured } from './redis.js';

// Fixed-window limiter. Uses Redis when configured (shared across instances),
// otherwise falls back to a per-instance in-memory map.
const memory = new Map();

export async function rateLimit(bucket, id, { limit, windowSeconds, failClosed = false }) {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `grafictrader:rl:${bucket}:${id}:${windowId}`;
  let count;
  if (redisConfigured()) {
    try {
      count = Number(await redis(['INCR', key]));
      if (count === 1) await redis(['EXPIRE', key, String(windowSeconds)]);
    } catch {
      count = null;
      // Limits that protect paid AI never fall back to a per-instance counter:
      // with many serverless instances that would mean no limit at all.
      if (failClosed) return { allowed: false, remaining: 0, retryAfter: 60 };
    }
  }
  if (!Number.isFinite(count)) {
    if (memory.size > 5000) memory.clear();
    count = (memory.get(key) || 0) + 1;
    memory.set(key, count);
  }
  const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter };
}

/** Current count of a window without adding to it (for limits that only count failures). */
export async function peekLimit(bucket, id, { limit, windowSeconds }) {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `grafictrader:rl:${bucket}:${id}:${windowId}`;
  let count = 0;
  if (redisConfigured()) {
    try { count = Number(await redis(['GET', key])) || 0; } catch { count = 0; }
  } else {
    count = memory.get(key) || 0;
  }
  const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  return { allowed: count < limit, remaining: Math.max(0, limit - count), retryAfter };
}

export function sendRateLimited(res, result) {
  res.setHeader('Retry-After', String(result.retryAfter));
  return res.status(429).json({ ok: false, error: result.message || 'Demasiados pedidos. Tenta novamente dentro de instantes.' });
}

const DAY = 86_400;
const envLimit = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Daily AI budget: per account (or IP) and for the whole app. Creating many
 * accounts cannot exceed the global cap. Tune with AI_DAILY_PER_USER and
 * AI_DAILY_GLOBAL.
 */
export async function aiQuota(id) {
  const user = await rateLimit('ai-day', id, { limit: envLimit('AI_DAILY_PER_USER', 400), windowSeconds: DAY, failClosed: true });
  if (!user.allowed) return { ...user, message: 'Chegaste ao limite diário de análises por IA. Volta amanhã.' };
  const all = await rateLimit('ai-day-global', 'all', { limit: envLimit('AI_DAILY_GLOBAL', 20000), windowSeconds: DAY, failClosed: true });
  if (!all.allowed) return { ...all, message: 'As análises por IA atingiram o limite de hoje. Tenta mais tarde.' };
  return user;
}

/**
 * Daily allowance of live analysis (Minha corretora and the Android bubble),
 * counted in minutes that had at least one analysis: a quiet screen sends no
 * frames, so it costs nothing. `limit` 0 or less means no limit. Resets at
 * 00:00 UTC.
 */
export async function liveMinutes(id, limit) {
  if (!(limit > 0)) return { allowed: true, used: 0, left: null };
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const minuteKey = `grafictrader:live:${id}:${Math.floor(now / 60_000)}`;
  const dayKey = `grafictrader:live-day:${id}:${day}`;
  const retryAfter = 86_400 - Math.floor((now / 1000) % 86_400);
  const result = used => ({ allowed: used <= limit, used, left: Math.max(0, limit - used), retryAfter });
  if (redisConfigured()) {
    // Errors surface: this limit protects paid AI, so it never falls back to "no limit".
    if (await redis(['GET', minuteKey])) return result(Number(await redis(['GET', dayKey])) || 0);
    const used = Number(await redis(['GET', dayKey])) || 0;
    if (used >= limit) return { ...result(used), allowed: false };
    if (await redis(['SET', minuteKey, '1', 'NX', 'EX', '120']) !== 'OK') return result(used);
    const counted = Number(await redis(['INCR', dayKey]));
    if (counted === 1) await redis(['EXPIRE', dayKey, String(2 * 86_400)]);
    return result(counted);
  }
  if (memory.size > 5000) memory.clear();
  if (memory.has(minuteKey)) return result(memory.get(dayKey) || 0);
  const used = memory.get(dayKey) || 0;
  if (used >= limit) return { ...result(used), allowed: false };
  memory.set(minuteKey, 1);
  memory.set(dayKey, used + 1);
  return result(used + 1);
}

/** Live minutes a day for the account's plan (free: 10). Paid plans have no minute limit yet. */
export function liveMinutesFor(user) {
  const plan = user?.plan || 'free';
  if (plan !== 'free') return envLimit('LIVE_MINUTES_PAID', 0);
  return envLimit('LIVE_MINUTES_FREE', 10);
}
