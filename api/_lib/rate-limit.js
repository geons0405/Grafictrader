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
