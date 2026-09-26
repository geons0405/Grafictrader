import { getBinanceTicker } from './_lib/sources/binance.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    const data = await getBinanceTicker(symbols);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    return res.status(200).json({ ok: true, updatedAt: new Date().toISOString(), data });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.message || 'Binance indisponível', data: [] });
  }
}
