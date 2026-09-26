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

const MARKETAUX_SYMBOLS = {
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
    if (!response.ok) {
      const message = data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
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
  if (/binance|bnb/.test(t)) tags.push('BNB');
  if (/solana|sol/.test(t)) tags.push('SOL');
  if (/ripple|xrp/.test(t)) tags.push('XRP');
  if (/cardano|ada/.test(t)) tags.push('ADA');
  if (/dogecoin|doge/.test(t)) tags.push('DOGE');
  if (/crypto|blockchain|token|defi/.test(t)) tags.push('CRYPTO');
  if (/etf|fund|institutional/.test(t)) tags.push('FUND');
  if (/regulat|sec|law|government/.test(t)) tags.push('REGULATION');
  if (/hack|exploit|attack|security/.test(t)) tags.push('SECURITY');
  if (!tags.includes('NEWS')) tags.push('NEWS');
  return [...new Set(tags)].slice(0, 6);
}

function impactFor(title = '') {
  return /fed|rate|inflation|sec|hack|exploit|etf|bitcoin|ethereum|binance|regulat|ban|approval|lawsuit/.test(title.toLowerCase())
    ? 'high'
    : 'normal';
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
    impact: impactFor(a.title || '')
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
    tags: [...classify(a.headline || ''), 'FINNHUB'].slice(0, 6),
    impact: impactFor(a.headline || '')
  }));
}

function normalizeMarketaux(data, asset) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((a, index) => {
    const title = a.title || 'Notícia financeira';
    const entities = Array.isArray(a.entities) ? a.entities : [];
    const sentiment = entities
      .map(entity => Number(entity.sentiment_score))
      .filter(Number.isFinite);
    const sentimentAvg = sentiment.length
      ? sentiment.reduce((sum, value) => sum + value, 0) / sentiment.length
      : null;

    return {
      id: `marketaux-${a.uuid || index}`,
      type: 'news',
      source: 'Marketaux',
      asset,
      timestamp: a.published_at || new Date().toISOString(),
      title,
      summary: a.description || a.snippet || title,
      url: a.url || '',
      domain: a.source || a.source_domain || '',
      imageUrl: a.image_url || '',
      tags: [...classify(title), 'MARKETAUX'].slice(0, 6),
      impact: impactFor(title),
      metrics: sentimentAvg === null ? undefined : { sentiment: Number(sentimentAvg.toFixed(3)) }
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });

  const symbol = String(req.query?.symbol || 'BTCUSDT').toUpperCase();
  const asset = LABELS[symbol] ? symbol : 'BTCUSDT';
  const assetLabel = LABELS[asset];

  const events = [];
  const sources = {
    gdelt: 'checking',
    marketaux: process.env.MARKETAUX_API_KEY ? 'checking' : 'not_configured',
    binance: 'checking',
    ccxt: 'checking',
    finnhub: process.env.FINNHUB_API_KEY ? 'checking' : 'not_configured',
    twelveData: process.env.TWELVE_DATA_API_KEY ? 'checking' : 'not_configured'
  };
  const sourceErrors = {};

  try {
    const ccxtModule = await import('ccxt');
    const Binance = ccxtModule.default?.binance || ccxtModule.binance;
    const exchange = new Binance({ enableRateLimit: true });
    const ticker = await exchange.fetchTicker(symbolToCcxt(asset));

    sources.ccxt = 'connected';
    sources.binance = 'connected';

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
    sourceErrors.ccxt = error?.message || 'Falha no CCXT';
    sourceErrors.binance = sourceErrors.ccxt;
  }

  try {
    const query = ASSET_QUERIES[asset];
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
      query,
      mode: 'artlist',
      maxrecords: '50',
      timespan: '6h',
      sort: 'datedesc',
      format: 'json'
    });
    const gdelt = await fetchJson(url);
    sources.gdelt = 'connected';
    events.push(...normalizeGdelt(gdelt, assetLabel));
  } catch (error) {
    sources.gdelt = 'error';
    sourceErrors.gdelt = error?.message || 'Falha no GDELT';
  }

  if (process.env.MARKETAUX_API_KEY) {
    try {
      const marketauxSymbol = MARKETAUX_SYMBOLS[asset];
      const url = 'https://api.marketaux.com/v1/news/all?' + new URLSearchParams({
        api_token: process.env.MARKETAUX_API_KEY,
        symbols: marketauxSymbol,
        entity_types: 'cryptocurrency',
        language: 'en',
        filter_entities: 'true',
        limit: '20',
        sort: 'published_at',
        published_after: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 16)
      });
      const data = await fetchJson(url);
      sources.marketaux = 'connected';
      events.push(...normalizeMarketaux(data, assetLabel));
    } catch (error) {
      sources.marketaux = 'error';
      sourceErrors.marketaux = error?.message || 'Falha no Marketaux';
    }
  }

  if (process.env.FINNHUB_API_KEY) {
    try {
      const url = 'https://finnhub.io/api/v1/news?' + new URLSearchParams({
        category: 'crypto',
        token: process.env.FINNHUB_API_KEY
      });
      const data = await fetchJson(url);
      sources.finnhub = 'connected';
      events.push(...normalizeFinnhub(data, assetLabel));
    } catch (error) {
      sources.finnhub = 'error';
      sourceErrors.finnhub = error?.message || 'Falha no Finnhub';
    }
  }

  if (process.env.TWELVE_DATA_API_KEY) {
    try {
      const tdSymbol = asset.replace('USDT', '/USD');
      const priceUrl = 'https://api.twelvedata.com/price?' + new URLSearchParams({
        symbol: tdSymbol,
        apikey: process.env.TWELVE_DATA_API_KEY
      });
      const quote = await fetchJson(priceUrl);
      if (quote?.price) {
        sources.twelveData = 'connected';
        events.push({
          id: `twelve-price-${asset}-${quote.price}`,
          type: 'market',
          source: 'Twelve Data',
          asset: assetLabel,
          timestamp: new Date().toISOString(),
          title: `${assetLabel}/USD · cotação Twelve Data`,
          summary: `Preço recebido do provedor Twelve Data: ${quote.price} USD.`,
          url: '',
          domain: 'Twelve Data',
          tags: [assetLabel, 'MARKET', 'PRICE'],
          impact: 'normal',
          metrics: { price: Number(quote.price) }
        });
      } else {
        throw new Error(quote?.message || 'Twelve Data não devolveu uma cotação.');
      }
    } catch (error) {
      sources.twelveData = 'error';
      sourceErrors.twelveData = error?.message || 'Falha no Twelve Data';
    }
  }

  const unique = new Map();
  for (const event of events) {
    const normalizedTitle = String(event.title || '').trim().toLowerCase();
    const key = event.url || event.id || normalizedTitle;
    if (!unique.has(key)) unique.set(key, event);
  }

  const sorted = [...unique.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 80);

  return json(res, 200, {
    ok: true,
    asset: assetLabel,
    updatedAt: new Date().toISOString(),
    sources,
    sourceErrors,
    events: sorted
  });
}
