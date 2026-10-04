import { runInstructor } from './_lib/quant/service.js';
import { parseMarketQuery, SYMBOLS, clientIp } from './_lib/validate.js';
import { runCouncil } from './_lib/council/service.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';

// GET /api/instructor?symbol=BTCUSDT&interval=5m  → full instructor view
// GET /api/instructor?desk=1&interval=5m          → one summary per asset
// GET /api/instructor?council=1&symbol=…&interval=… → 7 analysts + AI judge verdict
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  if (req.query?.council) {
    const market = parseMarketQuery(req.query);
    if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
    const limit = await rateLimit('council', clientIp(req), { limit: 40, windowSeconds: 600 });
    if (!limit.allowed) return sendRateLimited(res, limit);
    try {
      const data = await runCouncil(market.symbol, market.interval);
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data);
    } catch (error) {
      return res.status(error.status || 502).json({ ok: false, error: error.message || 'Conselho indisponível.' });
    }
  }

  if (req.query?.desk) {
    const market = parseMarketQuery({ symbol: 'BTCUSDT', interval: req.query.interval });
    if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
    const settled = await Promise.allSettled(SYMBOLS.map(symbol => runInstructor(symbol, market.interval)));
    const desk = settled.map((result, i) => result.status === 'fulfilled'
      ? {
          symbol: SYMBOLS[i],
          ok: true,
          price: result.value.price,
          summary: result.value.summary,
          signal: { action: result.value.signal.action, confidence: result.value.signal.confidence, regimeLabel: result.value.signal.regimeLabel }
        }
      : { symbol: SYMBOLS[i], ok: false, error: result.reason?.message || 'Indisponível' });
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(200).json({ ok: true, interval: market.interval, updatedAt: new Date().toISOString(), desk });
  }

  const market = parseMarketQuery(req.query);
  if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
  try {
    const data = await runInstructor(market.symbol, market.interval);
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(error?.status || 502).json({ ok: false, error: error?.message || 'Instrutor indisponível.' });
  }
}
