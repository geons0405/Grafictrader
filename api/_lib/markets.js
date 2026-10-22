// Forex and gold markets the app reads besides the Binance crypto pairs.
// Plain data, no dependencies: imported by request checks and the price formatting.

/** Our id → Yahoo Finance symbol (forex quotes and gold futures). */
export const FOREX_MARKETS = {
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'USDJPY=X',
  AUDUSD: 'AUDUSD=X',
  USDCAD: 'USDCAD=X',
  USDCHF: 'USDCHF=X',
  NZDUSD: 'NZDUSD=X',
  EURJPY: 'EURJPY=X',
  GBPJPY: 'GBPJPY=X',
  EURGBP: 'EURGBP=X',
  XAUUSD: 'GC=F'
};

export const isForexMarket = symbol => Object.hasOwn(FOREX_MARKETS, symbol);

/** The forex markets shown next to the crypto ones in summaries (desk, daily job). */
export const MAIN_FOREX = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];

const CURRENCY_NAMES = { EUR: 'euro', USD: 'dollar', GBP: 'pound', JPY: 'yen', AUD: 'Australian dollar', CAD: 'Canadian dollar', CHF: 'Swiss franc', NZD: 'New Zealand dollar' };

/** Search words for a forex pair's or gold's news, e.g. ("EUR/USD" OR euro dollar OR forex). */
export function forexNewsQuery(symbol) {
  if (symbol === 'XAUUSD') return '("gold price" OR XAUUSD OR "gold prices")';
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  return `("${base}/${quote}" OR ${base}${quote} OR "${CURRENCY_NAMES[base] || base}" OR forex)`;
}

/** "EUR/USD", "Ouro (XAU/USD)", "BTC/USDT". */
export function marketLabel(symbol) {
  const s = String(symbol || '');
  if (s === 'XAUUSD') return 'Ouro (XAU/USD)';
  if (isForexMarket(s)) return s.slice(0, 3) + '/' + s.slice(3);
  return s.endsWith('USDT') ? s.slice(0, -4) + '/USDT' : s;
}

/**
 * A price as traders read it: currency pairs with 5 decimals (3 for yen pairs) and no "$",
 * because 1.08 euros-in-dollars is a rate, not an amount; gold and crypto in dollars.
 */
export function formatPrice(symbol, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const s = String(symbol || '');
  if (isForexMarket(s) && s !== 'XAUUSD') return n.toFixed(s.endsWith('JPY') ? 3 : 5);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 4 : 2 });
}
