import Parser from 'rss-parser';
import YahooFinance from 'yahoo-finance2';
import { headlineSentiment } from './headline-sentiment.js';
import { fetchJson } from './http.js';

// Free real-time news without API keys: RSS feeds (bobby-brennan/rss-parser)
// and Yahoo Finance search (gadicc/node-yahoo-finance2).

const FEEDS = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', crypto: true },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss', crypto: true },
  { source: 'Investing.com', url: 'https://www.investing.com/rss/news_25.rss' },
  { source: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' }
];

const COINS = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'BNB binance', SOL: 'solana', XRP: 'XRP ripple', ADA: 'cardano',
  DOGE: 'dogecoin', TRX: 'tron', TON: 'toncoin', AVAX: 'avalanche', LINK: 'chainlink', DOT: 'polkadot'
};

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const parser = new Parser({ timeout: 6000 });
let yahooClient = null;

/** Search phrase and Yahoo symbol for an app symbol (BTCUSDT, EURUSD, XAUUSD, AAPL...). */
export function newsQueryFor(symbol = 'BTCUSDT') {
  const s = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) {
    const base = s.slice(0, -4);
    return { query: COINS[base] || `${base} crypto`, yahoo: `${base}-USD`, crypto: true };
  }
  if (/^XAU/.test(s)) return { query: 'gold price', yahoo: 'GC=F', crypto: false };
  if (/^XAG/.test(s)) return { query: 'silver price', yahoo: 'SI=F', crypto: false };
  if (/^[A-Z]{6}$/.test(s)) return { query: `${s.slice(0, 3)}/${s.slice(3)} forex`, yahoo: `${s}=X`, crypto: false };
  return { query: `${s} stock`, yahoo: s, crypto: false };
}

function toEvent(source, item, symbol) {
  const headline = String(item.title || '').trim();
  const time = new Date(item.isoDate || item.pubDate || item.time || Date.now());
  const { sentiment } = headlineSentiment(headline);
  return {
    id: `${source}-${item.link || headline}`,
    source,
    tag: 'NEWS',
    headline,
    url: item.link || undefined,
    timestamp: Number.isNaN(time.getTime()) ? new Date().toISOString() : time.toISOString(),
    sentiment,
    symbol,
    summary: String(item.contentSnippet || headline).slice(0, 280)
  };
}

async function readFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 Grafictrader', Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${new URL(url).hostname}`);
    return parser.parseString(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

/** Headlines from public RSS feeds plus a Google News search for the asset. */
export async function getRssNews(symbol = 'BTCUSDT') {
  const { query, crypto } = newsQueryFor(symbol);
  const google = { source: 'Google News', url: 'https://news.google.com/rss/search?' + new URLSearchParams({ q: `${query} when:1d`, hl: 'en-US', gl: 'US', ceid: 'US:en' }) };
  const feeds = [google, ...FEEDS.filter(f => crypto || !f.crypto)];
  const settled = await Promise.allSettled(feeds.map(feed => readFeed(feed.url)));
  const now = Date.now();
  const events = [];
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    for (const item of (result.value.items || []).slice(0, 25)) {
      const event = toEvent(feeds[index].source, item, symbol);
      if (event.headline && now - new Date(event.timestamp).getTime() <= MAX_AGE_MS) events.push(event);
    }
  });
  if (!events.length && settled.every(r => r.status === 'rejected')) throw new Error('Nenhum feed RSS respondeu.');
  return events;
}

/** Latest Yahoo Finance news for the asset. */
export async function getYahooNews(symbol = 'BTCUSDT') {
  const { yahoo } = newsQueryFor(symbol);
  let news;
  try {
    yahooClient ||= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const result = await yahooClient.search(yahoo, { newsCount: 15, quotesCount: 0 }, { validateResult: false });
    news = result?.news;
  } catch {
    // Same public endpoint the library uses, in case the library call fails.
    const data = await fetchJson('https://query1.finance.yahoo.com/v1/finance/search?' + new URLSearchParams({ q: yahoo, newsCount: '15', quotesCount: '0' }));
    news = data?.news;
  }
  return (news || []).map(n => toEvent('Yahoo Finance', {
    title: n.title,
    link: n.link,
    time: typeof n.providerPublishTime === 'number' ? n.providerPublishTime * 1000 : n.providerPublishTime
  }, symbol));
}
