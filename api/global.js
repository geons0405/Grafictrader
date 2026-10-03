import { getGlobalMarkets, riskSentiment } from './_lib/sources/global-markets.js';
import { getCalendar } from './_lib/sources/calendar.js';
import { getFearGreed } from './_lib/sources/feargreed.js';

// International context for Live Inteligente: world markets, the economic
// calendar and crypto sentiment. Each source fails independently.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  const [markets, calendar, fearGreed] = await Promise.allSettled([getGlobalMarkets(), getCalendar(), getFearGreed()]);
  const now = Date.now();
  const board = markets.status === 'fulfilled' ? markets.value : [];
  const events = calendar.status === 'fulfilled'
    ? calendar.value
      .filter(e => e.time >= now - 3 * 3600000 && e.impact !== 'Low' && e.impact !== 'Non-Economic')
      .sort((a, b) => a.time - b.time)
      .slice(0, 60)
    : [];
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  return res.status(200).json({
    ok: true,
    updatedAt: new Date().toISOString(),
    markets: board,
    risk: riskSentiment(board),
    calendar: events,
    fearGreed: fearGreed.status === 'fulfilled' ? fearGreed.value : null,
    failed: [
      markets.status === 'rejected' ? 'mercados' : null,
      calendar.status === 'rejected' ? 'calendário' : null,
      fearGreed.status === 'rejected' ? 'fear & greed' : null
    ].filter(Boolean)
  });
}
