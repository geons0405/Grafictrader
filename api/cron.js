import { verifySignals } from './_lib/signals.js';
import { runInstructor } from './_lib/quant/service.js';
import { SYMBOLS } from './_lib/validate.js';

// Daily job (vercel.json "crons"): settles the signals whose horizon has
// passed and moves the demo robots forward, so their history has fewer holes
// when nobody opens the app for a while. Vercel sends
// "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
const PLAN = [
  ['1h', SYMBOLS],
  ['15m', SYMBOLS],
  ['5m', SYMBOLS],
  ['1m', ['BTCUSDT', 'ETHUSDT']]
];

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers?.authorization || '');
  if (secret ? auth !== `Bearer ${secret}` : !/vercel-cron/i.test(String(req.headers?.['user-agent'] || ''))) {
    return res.status(401).json({ ok: false });
  }
  const started = Date.now();
  const settled = await verifySignals({ maxFetches: 30 }).catch(() => 0);
  const robots = {};
  for (const [interval, symbols] of PLAN) {
    if (Date.now() - started > 45_000) break;
    const results = await Promise.allSettled(symbols.map(symbol => runInstructor(symbol, interval)));
    robots[interval] = results.filter(r => r.status === 'fulfilled').length;
  }
  return res.status(200).json({ ok: true, settled, robots, ms: Date.now() - started });
}
