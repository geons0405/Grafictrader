const ASSET_QUERIES = {
  BTCUSDT: '(bitcoin OR BTC OR cryptocurrency)',
  ETHUSDT: '(ethereum OR ETH OR cryptocurrency)',
  BNBUSDT: '(binance OR BNB OR cryptocurrency)',
  SOLUSDT: '(solana OR SOL OR cryptocurrency)',
  XRPUSDT: '(ripple OR XRP OR cryptocurrency)',
  ADAUSDT: '(cardano OR ADA OR cryptocurrency)',
  DOGEUSDT: '(dogecoin OR DOGE OR cryptocurrency)'
};

const LABELS = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
  BNBUSDT: 'BNB',
  SOLUSDT: 'SOL',
  XRPUSDT: 'XRP',
  ADAUSDT: 'ADA',
  DOGEUSDT: 'DOGE'
};

function json(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.end(JSON.stringify(body));
}

async function fetchJson(url, options = {}, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function symbolToCcxt(symbol) {
  return symbol.replace(/(USDT|USDC|BUSD)$/, '/$1');
}

function classify(title = '') {
  const t = title.toLowerCase();
  const tags = [];
  if (/fed|federal reserve|interest rate|inflation|cpi|ppi|jobs|employment|ecb|bank of england|central bank|gdp/.test(t)) tags.push('MACRO');
  if (/bitcoin|btc/.test(t)) tags.push('BTC');
  if (/ethereum|eth/.test(t)) tags.push('ETH');
  if (/solana|sol/.test(t)) tags.push('SOL');
  if (/crypto|blockchain|token|defi/.test(t)) tags.push('CRYPTO');
  if (/etf|fund|institutional/.test(t)) tags.push('FUND');
  if (/regulat|sec|law|government/.test(t)) tags.push('REGULATION');
  if (/hack|exploit|attack|security/.test(t)) tags.push('SECURITY');
  if (!tags.includes('NEWS')) tags.push('NEWS');
  return [...new Set(tags)].slice(0, 5);
}

function normalizeGdelt(data, asset) {
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  return articles.map((a, index) => ({
    id: `gdelt-${a.url || index}-${a.seendate || ''}`,
    type: 'news',
    source: 'GDELT',
    asset,
    timestamp: a.seendate || new Date().toISOString(),
    title: a.title || 'Notícia de mercado',
    summary: a.title || '',
    url: a.url || '',
    domain: a.domain || '',
    tags: classify(a.title || ''),
    impact: /fed|rate|inflation|sec|hack|etf|bitcoin|ethereum/.test((a.title || '').toLowerCase()) ? 'high' : 'normal'
  }));
}

function normalizeFinnhub(data, asset) {
  const rows = Array.isArray(data) ? data : [];
  return rows.map((a, index) => ({
    id: `finnhub-${a.id || index}`,
    type: 'news',
    source: 'Finnhub',
    asset,
    timestamp: a.datetime ? new Date(a.datetime * 1000).toISOString() : new Date().toISOString(),
    title: a.headline || 'Notícia financeira',
    summary: a.summary || a.headline || '',
    url: a.url || '',
    domain: a.source || '',
    tags: [...classify(a.headline || ''), 'FINNHUB'].slice(0, 5),
    impact: /fed|rate|inflation|sec|hack|etf|bitcoin|ethereum/.test((a.headline || '').toLowerCase()) ? 'high' : 'normal'
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });

  const symbol = String(req.query?.symbol || 'BTCUSDT').toUpperCase();
  const asset = LABELS[symbol] ? symbol : 'BTCUSDT';
  const assetLabel = LABELS[asset];

  const events = [];
  const sources = {
    gdelt: 'connected',
    binance: 'connected',
    ccxt: 'connected',
    finnhub: process.env.FINNHUB_API_KEY ? 'connected' : 'not_configured',
    twelveData: process.env.TWELVE_DATA_API_KEY ? 'connected' : 'not_configured'
  };

  try {
    const ccxtModule = await import('ccxt');
    const Binance = ccxtModule.default?.binance || ccxtModule.binance;
    const exchange = new Binance({ enableRateLimit: true });
    const ticker = await exchange.fetchTicker(symbolToCcxt(asset));

    events.push({
      id: `market-${asset}-${ticker.timestamp || Date.now()}`,
      type: 'market',
      source: 'CCXT/Binance',
      asset: assetLabel,
      timestamp: ticker.timestamp ? new Date(ticker.timestamp).toISOString() : new Date().toISOString(),
      title: `${assetLabel}/USDT ${Number(ticker.percentage || 0) >= 0 ? 'em alta' : 'em baixa'}`,
      summary: `Preço ${Number(ticker.last || 0).toLocaleString('en-US')} · variação 24h ${Number(ticker.percentage || 0).toFixed(2)}% · volume ${Number(ticker.quoteVolume || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT.`,
      url: '',
      domain: 'Binance',
      tags: [assetLabel, 'MARKET', 'PRICE'],
      impact: Math.abs(Number(ticker.percentage || 0)) >= 3 ? 'high' : 'normal',
      metrics: {
        price: ticker.last,
        change24h: ticker.percentage,
        volume24h: ticker.quoteVolume
      }
    });
  } catch (error) {
    sources.ccxt = 'error';
    sources.binance = 'error';
  }

  try {
    const query = ASSET_QUERIES[asset];
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
      query,
      mode: 'artlist',
      maxrecords: '25',
      timespan: '1h',
      sort: 'datedesc',
      format: 'json'
    });
    const gdelt = await fetchJson(url);
    events.push(...normalizeGdelt(gdelt, assetLabel));
  } catch {
    sources.gdelt = 'error';
  }

  if (process.env.FINNHUB_API_KEY) {
    try {
      const url = 'https://finnhub.io/api/v1/news?' + new URLSearchParams({
        category: 'crypto',
        token: process.env.FINNHUB_API_KEY
      });
      const data = await fetchJson(url);
      events.push(...normalizeFinnhub(data, assetLabel));
    } catch {
      sources.finnhub = 'error';
    }
  }

  if (process.env.TWELVE_DATA_API_KEY && !asset.endsWith('USDT')) {
    try {
      const tdSymbol = asset.replace('USDT', '/USD');
      const url = 'https://api.twelvedata.com/press_releases?' + new URLSearchParams({
        symbol: tdSymbol,
        type: '1',
        apikey: process.env.TWELVE_DATA_API_KEY
      });
      const data = await fetchJson(url);
      for (const item of (data?.press_releases || []).slice(0, 10)) {
        events.push({
          id: `twelve-${item.id}`,
          type: 'press_release',
          source: 'Twelve Data',
          asset: assetLabel,
          timestamp: item.datetime || new Date().toISOString(),
          title: item.title || 'Comunicado',
          summary: String(item.body || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').slice(0, 220),
          url: '',
          domain: 'Twelve Data',
          tags: [assetLabel, 'PRESS', 'FUNDAMENTAL'],
          impact: 'normal'
        });
      }
    } catch {
      sources.twelveData = 'error';
    }
  }

  const unique = new Map();
  for (const event of events) {
    const key = event.url || event.id || event.title;
    if (!unique.has(key)) unique.set(key, event);
  }

  const sorted = [...unique.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 60);

  return json(res, 200, {
    ok: true,
    asset: assetLabel,
    updatedAt: new Date().toISOString(),
    sources,
    events: sorted
  });
}
