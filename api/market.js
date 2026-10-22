import { getBinanceTicker, getBinanceUsdtMarkets } from './_lib/sources/binance.js';
import { getCandles } from './_lib/sources/candles.js';
import { getYahooTicker } from './_lib/sources/yahoo.js';
import { isForexMarket, FOREX_MARKETS } from './_lib/markets.js';
import { parseMarketQuery } from './_lib/validate.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  // GET /api/market?list=1 → every Binance USDT pair, most traded first, plus the forex pairs and gold.
  if (req.query?.list) {
    try {
      const [markets, forex] = await Promise.all([
        getBinanceUsdtMarkets(),
        // A forex quote that fails only loses its price in the list, never the list itself.
        Promise.all(Object.keys(FOREX_MARKETS).map(symbol => getYahooTicker(symbol).catch(() => null)))
      ]);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ ok: true, markets, forex: forex.filter(Boolean).map(t => ({ symbol: t.symbol, price: t.price, change24h: t.change24h })) });
    } catch (error) {
      return res.status(502).json({ ok: false, error: error?.message || 'Lista de mercados indisponível.' });
    }
  }

  const market = parseMarketQuery(req.query);
  if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
  const { symbol, interval } = market;

  try {
    const [ticker, candles] = await Promise.all([
      isForexMarket(symbol) ? getYahooTicker(symbol) : getBinanceTicker([symbol]).then(list => list[0]),
      getCandles(symbol, interval, 300)
    ]);

    if (!ticker || !candles.length) {
      throw new Error('Nenhuma fonte de mercado devolveu dados para este ativo.');
    }

    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');

    return res.status(200).json({
      ok: true,
      source: ticker.source || 'unknown',
      symbol,
      interval,
      updatedAt: new Date().toISOString(),
      ticker: {
        price: Number(ticker.price ?? ticker.lastPrice),
        change24h: Number(ticker.change24h ?? ticker.priceChangePercent ?? 0),
        volume24h: Number(ticker.volume24h ?? 0),
        high24h: Number(ticker.high24h ?? 0),
        low24h: Number(ticker.low24h ?? 0)
      },
      candles
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      source: 'unavailable',
      error: error?.message || 'Mercado indisponível',
      candles: []
    });
  }
}
