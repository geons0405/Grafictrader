import { getBinanceCandles, getBinanceAggTrades, getBinanceOrderBook } from './_lib/sources/binance.js';
import { analyzeMarketMechanics } from './_lib/mechanics/index.js';
import { buildMechanicsMemory } from './_lib/mechanics/memory.js';
import { loadPatternLibrary, rememberPatternFamily } from './_lib/mechanics/pattern-library.js';

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
    const memory = buildMechanicsMemory(candles);
    const library = await loadPatternLibrary(symbol, interval);
    const savedPattern = memory.patternFamily
      ? await rememberPatternFamily(symbol, interval, memory.patternFamily, candles)
      : { saved:false, available:library.available, patterns:library.patterns };
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
      ...mechanics,
      memory,
      patternLibrary:{
        ...library,
        saved:savedPattern.saved || false,
        patternCount:savedPattern.patternCount ?? library.patterns.length,
        patterns:savedPattern.patterns || library.patterns,
        historicalOutcomes:true,
        outcomeHorizonsBars:[3,6,12]
      }
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
