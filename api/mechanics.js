import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from './_lib/sources/binance.js';
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
    const [candles, trades, orderBook] = await Promise.all([
      getBinanceCandles(symbol, interval, 120),
      getBinanceAggTrades(symbol, 500),
      getBinanceOrderBook(symbol, 100)
    ]);

    if (!Array.isArray(candles) || candles.length < 2) {
      return res.status(502).json({ ok:false, error:'Dados de candles insuficientes.', candles:[] });
    }

    const mechanics = analyzeMarketMechanics(candles, { trades, orderBook });
    const hasTrades = trades.length >= 10;
    const hasOrderBook = orderBook?.bids?.length > 0 && orderBook?.asks?.length > 0;

    res.setHeader('Cache-Control','s-maxage=3, stale-while-revalidate=7');

    return res.status(200).json({
      ok:true,
      symbol,
      interval,
      updatedAt:new Date().toISOString(),
      source: hasTrades || hasOrderBook ? 'Binance microstructure + market data' : 'market data fallback',
      dataQuality:{
        candles:candles.length,
        trades:hasTrades,
        tradeCount:trades.length,
        orderBook:hasOrderBook,
        bidLevels:orderBook?.bids?.length || 0,
        askLevels:orderBook?.asks?.length || 0
      },
      ...mechanics
    });
  } catch (error) {
    return res.status(502).json({
      ok:false,
      error:error?.message || 'Dados de mercado indisponíveis.',
      source:'unavailable',
      dataQuality:{ candles:0, trades:false, tradeCount:0, orderBook:false, bidLevels:0, askLevels:0 }
    });
  }
}
