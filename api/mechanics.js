import { getBinanceCandles } from './_lib/sources/binance.js';
import { analyzeMarketMechanics } from './_lib/mechanics/index.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Método não permitido.' });

  const symbol = String(req.query?.symbol || 'BTCUSDT').toUpperCase();
  const interval = String(req.query?.interval || '5m');
  const allowed = ['1m','5m','15m','1h','4h'];

  if (!/^[A-Z0-9]{6,12}$/.test(symbol) || !allowed.includes(interval)) {
    return res.status(400).json({ ok:false, error:'Parâmetros inválidos.' });
  }

  try {
    const candles = await getBinanceCandles(symbol, interval, 120);
    if (!Array.isArray(candles) || candles.length < 2) {
      return res.status(502).json({ ok:false, error:'Dados de candles insuficientes.', candles:[] });
    }

    const mechanics = analyzeMarketMechanics(candles);
    res.setHeader('Cache-Control','s-maxage=5, stale-while-revalidate=10');

    return res.status(200).json({
      ok:true,
      symbol,
      interval,
      updatedAt:new Date().toISOString(),
      source:candles[0]?.source || 'market-data',
      dataQuality:{
        candles:candles.length,
        trades:false,
        orderBook:false
      },
      ...mechanics
    });
  } catch (error) {
    return res.status(502).json({
      ok:false,
      error:error?.message || 'Dados de mercado indisponíveis.',
      source:'unavailable',
      dataQuality:{ candles:0, trades:false, orderBook:false }
    });
  }
}