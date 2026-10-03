const SYMBOLS = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', BNBUSDT: 'BNB', SOLUSDT: 'SOL', XRPUSDT: 'XRP', ADAUSDT: 'ADA', DOGEUSDT: 'DOGE' };

export async function getMarketauxEvents(symbol = 'BTCUSDT') {
  const key = process.env.MARKETAUX_API_KEY;
  if (!key) {
    console.warn('[Marketaux] MARKETAUX_API_KEY não configurada; fonte ignorada.');
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const url = 'https://api.marketaux.com/v1/news/all?' + new URLSearchParams({
      api_token: key,
      symbols: SYMBOLS[symbol] || 'BTC',
      entity_types: 'cryptocurrency',
      language: 'en',
      filter_entities: 'true',
      limit: '20',
      sort: 'published_at',
      published_after: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 16)
    });
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `Marketaux HTTP ${response.status}`);
    return (Array.isArray(data?.data) ? data.data : []).map((item, index) => {
      const scores = (Array.isArray(item.entities) ? item.entities : [])
        .map(e => Number(e.sentiment_score)).filter(Number.isFinite);
      const avg = scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : 0;
      return {
        id: `marketaux-${item.uuid || index}`,
        source: 'Marketaux',
        tag: /bitcoin|btc/i.test(item.title || '') ? 'BTC' : 'CRYPTO',
        headline: item.title || 'Notícia financeira',
        url: item.url || undefined,
        timestamp: item.published_at || new Date().toISOString(),
        sentiment: avg > 0.12 ? 'bullish' : avg < -0.12 ? 'bearish' : 'neutral',
        symbol,
        summary: item.description || item.snippet || '',
        imageUrl: item.image_url || undefined
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
