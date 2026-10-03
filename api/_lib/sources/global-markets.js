import { fetchJson } from './http.js';

// International instruments that move financial charts. Quotes come from
// Yahoo Finance's public chart endpoint (no key; unofficial, so failures are
// reported per instrument instead of breaking the board).
export const GLOBAL_INSTRUMENTS = [
  { id: 'SPX', yahoo: '^GSPC', name: 'S&P 500', group: 'Índices', region: 'EUA' },
  { id: 'NDX', yahoo: '^NDX', name: 'Nasdaq 100', group: 'Índices', region: 'EUA' },
  { id: 'DJI', yahoo: '^DJI', name: 'Dow Jones', group: 'Índices', region: 'EUA' },
  { id: 'DAX', yahoo: '^GDAXI', name: 'DAX', group: 'Índices', region: 'Alemanha' },
  { id: 'FTSE', yahoo: '^FTSE', name: 'FTSE 100', group: 'Índices', region: 'Reino Unido' },
  { id: 'N225', yahoo: '^N225', name: 'Nikkei 225', group: 'Índices', region: 'Japão' },
  { id: 'HSI', yahoo: '^HSI', name: 'Hang Seng', group: 'Índices', region: 'Hong Kong' },
  { id: 'VIX', yahoo: '^VIX', name: 'VIX (medo)', group: 'Risco', region: 'EUA' },
  { id: 'DXY', yahoo: 'DX-Y.NYB', name: 'Índice do dólar', group: 'Câmbio', region: 'EUA' },
  { id: 'EURUSD', yahoo: 'EURUSD=X', name: 'EUR/USD', group: 'Câmbio', region: 'Global' },
  { id: 'GBPUSD', yahoo: 'GBPUSD=X', name: 'GBP/USD', group: 'Câmbio', region: 'Global' },
  { id: 'USDJPY', yahoo: 'JPY=X', name: 'USD/JPY', group: 'Câmbio', region: 'Global' },
  { id: 'US10Y', yahoo: '^TNX', name: 'Juro EUA 10 anos', group: 'Juros', region: 'EUA' },
  { id: 'GOLD', yahoo: 'GC=F', name: 'Ouro', group: 'Matérias-primas', region: 'Global' },
  { id: 'SILVER', yahoo: 'SI=F', name: 'Prata', group: 'Matérias-primas', region: 'Global' },
  { id: 'WTI', yahoo: 'CL=F', name: 'Petróleo WTI', group: 'Matérias-primas', region: 'Global' },
  { id: 'BRENT', yahoo: 'BZ=F', name: 'Petróleo Brent', group: 'Matérias-primas', region: 'Global' },
  { id: 'BTC', yahoo: 'BTC-USD', name: 'Bitcoin', group: 'Cripto', region: 'Global' },
  { id: 'ETH', yahoo: 'ETH-USD', name: 'Ethereum', group: 'Cripto', region: 'Global' }
];

async function quote(instrument) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.yahoo)}?range=1d&interval=15m`;
  const data = await fetchJson(url, { timeout: 7000 });
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const price = Number(meta?.regularMarketPrice);
  const previous = Number(meta?.chartPreviousClose ?? meta?.previousClose);
  if (!Number.isFinite(price)) throw new Error('sem preço');
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite).slice(-40);
  return {
    ...instrument,
    price,
    changePct: Number.isFinite(previous) && previous ? ((price - previous) / previous) * 100 : null,
    spark: closes,
    marketState: meta?.marketState || null,
    time: meta?.regularMarketTime ? meta.regularMarketTime * 1000 : null
  };
}

export async function getGlobalMarkets() {
  const settled = await Promise.allSettled(GLOBAL_INSTRUMENTS.map(quote));
  return settled.map((r, i) => (r.status === 'fulfilled' ? r.value : { ...GLOBAL_INSTRUMENTS[i], price: null, changePct: null, error: r.reason?.message || 'indisponível' }));
}

/**
 * Risk-on / risk-off reading of the global board: equities up, VIX and
 * dollar down = risk-on (usually supportive for crypto and stocks).
 */
export function riskSentiment(markets) {
  const by = id => markets.find(m => m.id === id)?.changePct;
  const parts = [
    [by('SPX'), 1], [by('NDX'), 1], [by('DAX'), 0.5], [by('N225'), 0.5],
    [by('VIX') != null ? -by('VIX') / 5 : null, 1], [by('DXY') != null ? -by('DXY') * 2 : null, 1], [by('BTC'), 0.5]
  ].filter(([v]) => Number.isFinite(v));
  if (!parts.length) return { score: 0, label: 'Sem dados' };
  const weight = parts.reduce((s, [, w]) => s + w, 0);
  const raw = parts.reduce((s, [v, w]) => s + Math.max(-2, Math.min(2, v)) * w, 0) / weight / 2;
  const score = Math.max(-1, Math.min(1, raw));
  return { score: Number(score.toFixed(3)), label: score > 0.15 ? 'Apetite ao risco' : score < -0.15 ? 'Aversão ao risco' : 'Neutro' };
}
