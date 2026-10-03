import { redis, redisConfigured } from './redis.js';

// Fixed-window limiter. Uses Redis when configured (shared across instances),
// otherwise falls back to a per-instance in-memory map.
const memory = new Map();

export async function rateLimit(bucket, id, { limit, windowSeconds }) {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `grafictrader:rl:${bucket}:${id}:${windowId}`;
  let count;
  if (redisConfigured()) {
    try {
      count = Number(await redis(['INCR', key]));
      if (count === 1) await redis(['EXPIRE', key, String(windowSeconds)]);
    } catch {
      count = null;
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

export function sendRateLimited(res, result) {
  res.setHeader('Retry-After', String(result.retryAfter));
  return res.status(429).json({ ok: false, error: 'Demasiados pedidos. Tenta novamente dentro de instantes.' });
}
