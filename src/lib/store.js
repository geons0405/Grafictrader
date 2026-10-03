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

// TradingView symbols offered in the picker (the widget also searches any symbol).
export const TV_SYMBOLS = [
  { group: 'Cripto', symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin' },
  { group: 'Cripto', symbol: 'BINANCE:ETHUSDT', name: 'Ethereum' },
  { group: 'Cripto', symbol: 'BINANCE:SOLUSDT', name: 'Solana' },
  { group: 'Cripto', symbol: 'BINANCE:XRPUSDT', name: 'XRP' },
  { group: 'Forex', symbol: 'FX:EURUSD', name: 'Euro / Dólar' },
  { group: 'Forex', symbol: 'FX:GBPUSD', name: 'Libra / Dólar' },
  { group: 'Forex', symbol: 'FX:USDJPY', name: 'Dólar / Iene' },
  { group: 'Forex', symbol: 'FX:AUDUSD', name: 'Dólar australiano / Dólar' },
  { group: 'Forex', symbol: 'FX:USDCAD', name: 'Dólar / Dólar canadiano' },
  { group: 'Forex', symbol: 'FX:USDCHF', name: 'Dólar / Franco suíço' },
  { group: 'Metais e energia', symbol: 'OANDA:XAUUSD', name: 'Ouro' },
  { group: 'Metais e energia', symbol: 'OANDA:XAGUSD', name: 'Prata' },
  { group: 'Metais e energia', symbol: 'TVC:USOIL', name: 'Petróleo WTI' },
  { group: 'Metais e energia', symbol: 'TVC:UKOIL', name: 'Petróleo Brent' },
  { group: 'Índices', symbol: 'FOREXCOM:SPXUSD', name: 'S&P 500' },
  { group: 'Índices', symbol: 'FOREXCOM:NSXUSD', name: 'Nasdaq 100' },
  { group: 'Índices', symbol: 'FOREXCOM:DJI', name: 'Dow Jones' },
  { group: 'Índices', symbol: 'XETR:DAX', name: 'DAX' },
  { group: 'Índices', symbol: 'TVC:DXY', name: 'Índice do dólar' }
];

const listeners = new Set();
// source: where the chart comes from — 'binance', 'tradingview' or 'mt5'.
export const market = { source: 'binance', symbol: 'BTCUSDT', tvSymbol: 'BINANCE:BTCUSDT', mt5Symbol: null, interval: '5m' };

export function setMarket(next) {
  const changed = Object.keys(next).some(key => next[key] !== undefined && next[key] !== market[key]);
  Object.assign(market, next);
  if (changed) listeners.forEach(fn => fn({ ...market }));
}

export function onMarketChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const intervalName = value => INTERVALS.find(i => i.value === value)?.name || value;
