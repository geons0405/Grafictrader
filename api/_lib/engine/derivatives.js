import { fetchJson } from '../sources/http.js';
import { round } from './core.js';

// Open interest and funding from public derivatives APIs (first that answers).
// Used to tell new positions from short covering / long liquidations.

const PERIOD = { '1m': '5m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H' };
const BINANCE_PERIOD = { '1m': '5m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' };

async function okx(base, interval) {
  const data = await fetchJson(`https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${base}&period=${PERIOD[interval] || '5m'}`, { timeout: 4000 });
  const rows = (data?.data || []).map(r => ({ time: Number(r[0]), oi: Number(r[1]) })).filter(r => r.oi > 0).sort((a, b) => a.time - b.time);
  if (rows.length < 3) throw new Error('OKX sem dados');
  let funding = null;
  try {
    const f = await fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${base}-USDT-SWAP`, { timeout: 3000 });
    funding = Number(f?.data?.[0]?.fundingRate);
  } catch { /* optional */ }
  return { source: 'OKX', rows, funding };
}

async function binance(symbol, interval) {
  const data = await fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${BINANCE_PERIOD[interval] || '5m'}&limit=30`, { timeout: 4000 });
  const rows = (data || []).map(r => ({ time: Number(r.timestamp), oi: Number(r.sumOpenInterestValue) })).filter(r => r.oi > 0);
  if (rows.length < 3) throw new Error('Binance futuros sem dados');
  return { source: 'Binance Futures', rows, funding: null };
}

/** OI change over the last bars and funding, or null when no source answers. */
export async function getDerivatives(symbol, interval) {
  if (!symbol.endsWith('USDT')) return null;
  const base = symbol.slice(0, -4);
  for (const attempt of [() => okx(base, interval), () => binance(symbol, interval)]) {
    try {
      const { source, rows, funding } = await attempt();
      const lastOi = rows[rows.length - 1].oi;
      const ref = rows[Math.max(0, rows.length - 7)].oi;
      return { source, oiChangePct: round((lastOi / ref - 1) * 100, 3), funding: Number.isFinite(funding) ? round(funding * 100, 4) : null, points: rows.length };
    } catch { /* try the next source */ }
  }
  return null;
}
