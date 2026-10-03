import { getBinanceTicker, getBinanceCandles } from './_lib/sources/binance.js';
import { parseMarketQuery } from './_lib/validate.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });

  const market = parseMarketQuery(req.query);
  if (!market) return res.status(400).json({ ok: false, error: 'Parâmetros inválidos.' });
  const { symbol, interval } = market;

  try {
    const [tickers, candles] = await Promise.all([
      getBinanceTicker([symbol]),
      getBinanceCandles(symbol, interval, 300)
    ]);
    const ticker = tickers[0];

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
