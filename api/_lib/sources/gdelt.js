import { headlineSentiment } from './headline-sentiment.js';
const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

export function parseGdeltDate(value) {
  if (!value) return new Date().toISOString();
  const raw = String(value).trim();
  const match = raw.match(/^(\d{8})T(\d{6})Z$/);
  if (match) {
    const [, d, t] = match;
    const iso = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sentimentFromText(text = '') {
  return headlineSentiment(text).sentiment;
}

function tagsFor(text = '') {
  const t = text.toLowerCase();
  const tags = [];
  if (/bitcoin|btc/.test(t)) tags.push('BTC');
  if (/ethereum|eth/.test(t)) tags.push('CRYPTO');
  if (/crypto|blockchain|token|defi/.test(t)) tags.push('CRYPTO');
  if (/fed|inflation|cpi|interest rate|ecb|gdp|jobs|employment/.test(t)) tags.push('MACRO');
  tags.push('NEWS');
  return [...new Set(tags)].slice(0, 4);
}

export async function getGdeltEvents(symbol = 'BTCUSDT') {
  const queryMap = {
    BTCUSDT: '(bitcoin OR BTC OR cryptocurrency)',
    ETHUSDT: '(ethereum OR ETH OR cryptocurrency)',
    BNBUSDT: '(binance OR BNB OR cryptocurrency)',
    SOLUSDT: '(solana OR SOL OR cryptocurrency)',
    XRPUSDT: '(ripple OR XRP OR cryptocurrency)',
    ADAUSDT: '(cardano OR ADA OR cryptocurrency)',
    DOGEUSDT: '(dogecoin OR DOGE OR cryptocurrency)'
  };
  const query = queryMap[symbol] || '(bitcoin OR cryptocurrency)';
  const url = GDELT_BASE + '?' + new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    maxrecords: '50',
    timespan: '6h',
    sort: 'datedesc'
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(`GDELT HTTP ${response.status}`);
    const articles = Array.isArray(data?.articles) ? data.articles : [];
    return articles.map((article, index) => {
      const headline = article.title || 'Acontecimento de mercado';
      return {
        id: `gdelt-${article.url || index}-${article.seendate || ''}`,
        source: 'GDELT',
        tag: tagsFor(headline)[0] || 'NEWS',
        headline,
        url: article.url || undefined,
        timestamp: parseGdeltDate(article.seendate),
        sentiment: sentimentFromText(headline),
        symbol: /bitcoin|btc/i.test(headline) ? 'BTCUSDT' : /ethereum|eth/i.test(headline) ? 'ETHUSDT' : undefined,
        summary: headline,
        domain: article.domain || ''
      };
    });
  } finally {
    clearTimeout(timer);
  }
}
