import { redis, redisConfigured } from './_lib/redis.js';
import { getSessionUser } from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { crossSite } from './_lib/validate.js';
import { randomBytes } from 'node:crypto';

// Trading journal: the user's own trades, to see what really works for them.
//  GET    /api/journal            → entries, newest first, and totals
//  POST   /api/journal            → { date, asset, side, amount, result, followedApp, note }
//  DELETE /api/journal?id=…
const MAX_ENTRIES = 500;
const key = email => 'grafictrader:journal:' + email;

async function read(email) {
  try { return JSON.parse((await redis(['GET', key(email)])) || '[]'); } catch { return []; }
}

/** Validates one entry from the client; returns null when it is not usable. */
export function cleanEntry(body = {}) {
  const date = new Date(body.date || Date.now());
  const amount = Number(body.amount);
  const result = Number(body.result);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(result)) return null;
  if (!['BUY', 'SELL'].includes(body.side)) return null;
  const asset = String(body.asset || '').trim().slice(0, 30);
  if (!asset) return null;
  return {
    id: randomBytes(6).toString('hex'),
    date: date.toISOString(),
    asset,
    side: body.side,
    amount: Math.round(amount * 100) / 100,
    result: Math.round(result * 100) / 100,
    followedApp: body.followedApp === true,
    note: String(body.note || '').trim().slice(0, 280)
  };
}

/** Totals overall and split by whether the trade followed the app. */
export function journalTotals(entries) {
  const group = list => {
    const wins = list.filter(e => e.result > 0).length;
    return {
      trades: list.length,
      wins,
      losses: list.filter(e => e.result < 0).length,
      winRate: list.length ? Math.round((wins / list.length) * 1000) / 10 : null,
      net: Math.round(list.reduce((s, e) => s + e.result, 0) * 100) / 100
    };
  };
  return { all: group(entries), followedApp: group(entries.filter(e => e.followedApp)), ownCall: group(entries.filter(e => !e.followedApp)) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!redisConfigured()) return res.status(503).json({ ok: false, setupRequired: true, error: 'O diário precisa das contas no servidor.' });
  if (req.method !== 'GET' && crossSite(req)) return res.status(403).json({ ok: false, error: 'Pedido recusado.' });
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Inicia sessão para usar o diário.' });
  const limit = await rateLimit('journal', user.email, { limit: 120, windowSeconds: 600 });
  if (!limit.allowed) return sendRateLimited(res, limit);

  let entries = await read(user.email);
  if (req.method === 'POST') {
    const entry = cleanEntry(req.body);
    if (!entry) return res.status(400).json({ ok: false, error: 'Preenche o ativo, a direção, o valor e o resultado.' });
    entries = [entry, ...entries].slice(0, MAX_ENTRIES);
    await redis(['SET', key(user.email), JSON.stringify(entries)]);
  } else if (req.method === 'DELETE') {
    entries = entries.filter(e => e.id !== String(req.query?.id || ''));
    await redis(['SET', key(user.email), JSON.stringify(entries)]);
  } else if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.' });
  }
  return res.status(200).json({ ok: true, entries, totals: journalTotals(entries) });
}
