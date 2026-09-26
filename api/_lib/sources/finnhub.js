export async function getFinnhubEvents(symbol = 'BTCUSDT') {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    console.warn('[Finnhub] FINNHUB_API_KEY não configurada; fonte ignorada.');
    return [];
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const url = 'https://finnhub.io/api/v1/news?' + new URLSearchParams({
      category: 'crypto',
      token: key
    });
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `Finnhub HTTP ${response.status}`);
    return (Array.isArray(data) ? data : []).map((item, index) => {
      const headline = item.headline || 'Notícia financeira';
      const text = (headline + ' ' + (item.summary || '')).toLowerCase();
      const sentiment = /surge|gain|rise|approval|bullish|growth/.test(text) ? 'bullish' :
        /fall|drop|crash|bearish|loss|decline|hack|ban|warning/.test(text) ? 'bearish' : 'neutral';
      return {
        id: `finnhub-${item.id || index}`,
        source: 'Finnhub',
        tag: /bitcoin|btc/i.test(headline) ? 'BTC' : 'NEWS',
        headline,
        url: item.url || undefined,
        timestamp: item.datetime ? new Date(item.datetime * 1000).toISOString() : new Date().toISOString(),
        sentiment,
        symbol: /bitcoin|btc/i.test(headline) ? 'BTCUSDT' : undefined,
        summary: item.summary || ''
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
