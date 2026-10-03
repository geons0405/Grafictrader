export const ASSETS = [
  { symbol: 'BTCUSDT', short: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', short: 'ETH', name: 'Ethereum' },
  { symbol: 'SOLUSDT', short: 'SOL', name: 'Solana' },
  { symbol: 'BNBUSDT', short: 'BNB', name: 'BNB' },
  { symbol: 'XRPUSDT', short: 'XRP', name: 'XRP' },
  { symbol: 'ADAUSDT', short: 'ADA', name: 'Cardano' },
  { symbol: 'DOGEUSDT', short: 'DOGE', name: 'Dogecoin' }
];

export const INTERVALS = [
  { value: '1m', label: '1m', name: '1 minuto' },
  { value: '5m', label: '5m', name: '5 minutos' },
  { value: '15m', label: '15m', name: '15 minutos' },
  { value: '1h', label: '1h', name: '1 hora' },
  { value: '4h', label: '4h', name: '4 horas' }
];

const listeners = new Set();
export const market = { symbol: 'BTCUSDT', interval: '5m' };

export function setMarket(next) {
  const changed = (next.symbol && next.symbol !== market.symbol) || (next.interval && next.interval !== market.interval);
  Object.assign(market, next);
  if (changed) listeners.forEach(fn => fn({ ...market }));
}

export function onMarketChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const intervalName = value => INTERVALS.find(i => i.value === value)?.name || value;
