import { recentSignals, signalStats, verifySignals } from './_lib/signals.js';
import { redisConfigured } from './_lib/redis.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp } from './_lib/validate.js';

// GET /api/signals → the app's real track record: every BUY/SELL shown in
// FOTO and Minha corretora, checked against what the price did next.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  if (!redisConfigured()) return res.status(200).json({ ok: true, available: false, stats: {}, recent: [] });
  const limit = await rateLimit('signals', clientIp(req), { limit: 60, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);
  try {
    // A few checks per visit keep results fresh between the daily cron runs.
    await verifySignals({ maxFetches: 4 }).catch(() => 0);
    const signals = await recentSignals(14);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      ok: true,
      available: true,
      days: 14,
      horizonBars: 24,
      stats: signalStats(signals),
      recent: signals.slice(0, 20).map(({ at, source, symbol, interval, side, entry, outcome, r }) => ({ at, source, symbol, interval, side, entry, outcome, r: r ?? null }))
    });
  } catch (error) {
    console.error('[Signals]', error?.message || error);
    return res.status(502).json({ ok: false, error: 'Histórico de sinais indisponível.' });
  }
}
