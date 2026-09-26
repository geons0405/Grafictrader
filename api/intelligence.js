import { getAllIntelligence } from './_lib/intelligence.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  const symbol = String(req.query?.symbol || 'BTCUSDT').toUpperCase();
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
