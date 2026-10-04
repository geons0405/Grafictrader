import { getBinanceMarketEvents } from './sources/binance.js';
import { getGdeltEvents } from './sources/gdelt.js';
import { getMarketauxEvents } from './sources/marketaux.js';
import { getFinnhubEvents } from './sources/finnhub.js';
import { getRssNews, getYahooNews } from './sources/news-feeds.js';
import { apiKey } from './env.js';

export async function getAllIntelligence(symbol = 'BTCUSDT') {
  const tasks = [
    ['Binance', () => getBinanceMarketEvents(symbol)],
    ['GDELT', () => getGdeltEvents(symbol)],
    ['Marketaux', () => getMarketauxEvents(symbol)],
    ['Finnhub', () => getFinnhubEvents(symbol)],
    ['Notícias RSS', () => getRssNews(symbol)],
    ['Yahoo Finance', () => getYahooNews(symbol)]
  ];
  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const events = [];
  const failedSources = [];
  const activeSources = [];

  settled.forEach((result, index) => {
    const name = tasks[index][0];
    const optionalKey = name === 'Marketaux' ? apiKey('MARKETAUX_API_KEY') : name === 'Finnhub' ? apiKey('FINNHUB_API_KEY') : 'public';
    if (result.status === 'fulfilled') {
      if (optionalKey) activeSources.push(name);
      else failedSources.push({ source: name, code: 'not_configured', error: name === 'Marketaux' ? 'MARKETAUX_API_KEY não configurada' : 'FINNHUB_API_KEY não configurada' });
      events.push(...(Array.isArray(result.value) ? result.value : []));
    } else {
      failedSources.push({ source: name, code: 'error', error: result.reason?.message || 'Falha desconhecida' });
    }
  });

  const unique = new Map();
  for (const event of events) {
    const key = event.url || event.id || event.headline;
    if (!unique.has(key)) unique.set(key, event);
  }

  return {
    events: [...unique.values()].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 100),
    activeSources,
    failedSources,
    sourceCount: tasks.length
  };
}
