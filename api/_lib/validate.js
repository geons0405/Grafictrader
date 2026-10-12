export const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
export const INTERVALS = ['1m', '5m', '15m', '1h', '4h'];

export const INTERVAL_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };

// Any Binance spot pair quoted in USDT; Binance itself rejects unknown ones.
export const isBinanceSymbol = symbol => /^[A-Z0-9]{2,16}USDT$/.test(symbol);

export function parseMarketQuery(query = {}) {
  const symbol = String(query.symbol || 'BTCUSDT').toUpperCase();
  const interval = String(query.interval || '5m');
  if (!isBinanceSymbol(symbol) || !INTERVALS.includes(interval)) return null;
  return { symbol, interval };
}

export function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * Browser requests that change state must come from this site: a different
 * Origin, or a plain HTML form post, is refused. Native app and MT5 bridge
 * requests send no Origin and pass.
 */
export function crossSite(req) {
  const origin = req.headers?.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { return true; }
    const own = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '');
    if (host !== own) return true;
  }
  // The content types a cross-site HTML form can send without asking permission.
  const type = String(req.headers?.['content-type'] || '').toLowerCase();
  return /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/.test(type);
}
