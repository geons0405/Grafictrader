import { getAllIntelligence } from './_lib/intelligence.js';
import { isBinanceSymbol, parseMarketQuery, clientIp } from './_lib/validate.js';
import { runEngine } from './_lib/engine/index.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';

// GET /api/intelligence?symbol=BTCUSDT                       → news and events feed
// GET /api/intelligence?engine=1&symbol=BTCUSDT&interval=5m  → Market Intelligence Engine

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  if (req.query?.engine) {
    const market = parseMarketQuery(req.query);
    if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
    const limit = await rateLimit('engine', clientIp(req), { limit: 60, windowSeconds: 600 });
    if (!limit.allowed) return sendRateLimited(res, limit);
    try {
      const data = await runEngine(market.symbol, market.interval);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      return res.status(200).json(data);
    } catch (error) {
      console.error('[Engine]', error);
      return res.status(error.status || 502).json({ ok: false, error: error.message || 'Motor indisponível.' });
    }
  }
  const symbol = String(req.query?.symbol || 'BTCUSDT').toUpperCase();
  if (!isBinanceSymbol(symbol)) return res.status(400).json({ ok: false, error: 'Ativo inválido.' });
  try {
    const result = await getAllIntelligence(symbol);
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    return res.status(200).json({
      ok: true,
      symbol,
      updatedAt: new Date().toISOString(),
      events: result.events,
      activeSources: result.activeSources,
      failedSources: result.failedSources,
      sourceCount: result.sourceCount
    });
  } catch (error) {
    console.error('[Intelligence] agregador falhou:', error);
    return res.status(200).json({
      ok: true,
      symbol,
      updatedAt: new Date().toISOString(),
      events: [],
      activeSources: [],
      failedSources: [{ source: 'aggregator', error: error?.message || 'Falha no agregador' }],
      sourceCount: 4
    });
  }
}
