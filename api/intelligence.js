import { getAllIntelligence } from './_lib/intelligence.js';
import { isMarketSymbol, parseMarketQuery, clientIp } from './_lib/validate.js';
import { runEngine } from './_lib/engine/index.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';

const FEED_CACHE_MS = 60_000;
const feedCache = new Map();

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
  if (!isMarketSymbol(symbol)) return res.status(400).json({ ok: false, error: 'Ativo inválido.' });
  const limit = await rateLimit('feed', clientIp(req), { limit: 120, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);
  try {
    // News quotas are paid: one fetch per asset and minute per instance, shared
    // by requests that arrive while it is still running.
    let hit = feedCache.get(symbol);
    if (!hit || Date.now() - hit.at >= FEED_CACHE_MS) {
      if (feedCache.size > 200) feedCache.clear();
      const promise = getAllIntelligence(symbol);
      hit = { at: Date.now(), promise };
      feedCache.set(symbol, hit);
      promise.catch(() => { if (feedCache.get(symbol) === hit) feedCache.delete(symbol); });
    }
    const result = await hit.promise;
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
