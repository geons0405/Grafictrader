import { fetchJson } from './http.js';

/** Crypto Fear & Greed index from alternative.me (free, no key). */
export async function getFearGreed() {
  const data = await fetchJson('https://api.alternative.me/fng/?limit=7', { timeout: 6000 });
  const rows = Array.isArray(data?.data) ? data.data : [];
  if (!rows.length) throw new Error('sem dados');
  return {
    value: Number(rows[0].value),
    label: rows[0].value_classification,
    history: rows.map(r => Number(r.value)).reverse()
  };
}
