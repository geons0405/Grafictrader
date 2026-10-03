import { buildMechanicsSnapshot } from './_lib/mechanics/snapshot.js';
import { parseMarketQuery } from './_lib/validate.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  const market = parseMarketQuery(req.query);
  if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });

  try {
    const snapshot = await buildMechanicsSnapshot(market.symbol, market.interval, { persist: true });
    res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=7');
    return res.status(200).json(snapshot);
  } catch (error) {
    return res.status(error?.status || 502).json({
      ok: false,
      error: error?.message || 'Dados de mercado indisponíveis.',
      source: 'unavailable',
      dataQuality: { candles: 0, trades: false, tradeCount: 0, orderBook: false, bidLevels: 0, askLevels: 0 }
    });
  }
}
