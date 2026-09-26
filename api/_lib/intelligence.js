import { getBinanceMarketEvents } from './sources/binance.js';
import { getGdeltEvents } from './sources/gdelt.js';
import { getMarketauxEvents } from './sources/marketaux.js';
import { getFinnhubEvents } from './sources/finnhub.js';

const SOURCE_NAMES = ['Binance', 'GDELT', 'Marketaux', 'Finnhub'];

export async function getAllIntelligence(symbol = 'BTCUSDT') {
  const tasks = [
    ['Binance', () => getBinanceMarketEvents(symbol)],
    ['GDELT', () => getGdeltEvents(symbol)],
    ['Marketaux', () => getMarketauxEvents(symbol)],
    ['Finnhub', () => getFinnhubEvents(symbol)]
  ];
  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  const events = [];
  const failedSources = [];
  const activeSources = [];

  settled.forEach((result, index) => {
    const name = tasks[index][0];
    if (result.status === 'fulfilled') {
      activeSources.push(name);
      events.push(...(Array.isArray(result.value) ? result.value : []));
    } else {
      failedSources.push({ source: name, error: result.reason?.message || 'Falha desconhecida' });
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
    sourceCount: SOURCE_NAMES.length
  };
}
