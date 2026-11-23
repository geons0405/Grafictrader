import { redis, redisConfigured } from './redis.js';
import { getSessionUser } from './auth.js';
import { rateLimit, sendRateLimited } from './rate-limit.js';
import { crossSite } from './validate.js';
import { createHash, randomBytes } from 'node:crypto';

// Trading journal: the user's own trades, to see what really works for them.
// Served by /api/auth?action=journal (Vercel Hobby allows 12 functions):
//  GET    /api/auth?action=journal          → entries, newest first, and totals
//  POST   /api/auth?action=journal          → { date, asset, side, amount, result, followedApp, note }
//  DELETE /api/auth?action=journal&id=…
const MAX_ENTRIES = 500;
const key = email => 'grafictrader:journal:' + email;

async function read(email) {
  try { return JSON.parse((await redis(['GET', key(email)])) || '[]'); } catch { return []; }
}

/** Validates one entry from the client; returns null when it is not usable. */
export function cleanEntry(body = {}) {
  const date = new Date(body.date || Date.now());
  // Empty fields are missing, not zero: a blank result is not a break-even trade.
  const given = v => v !== undefined && v !== null && String(v).trim() !== '';
  if (!given(body.amount) || !given(body.result)) return null;
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

export async function journalHandler(req, res) {
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


// Continuous learning memory. Only compact market context and outcomes are stored;
// screenshots, credentials, account balances and personal notes are never retained.
const LEARNING_MAX = 500;
const LEARNING_MIN_SKILL = 20;
const learningUserKey = user => 'grafictrader:learning:' + createHash('sha256').update(String(user)).digest('hex').slice(0, 32);
const learningMarketKey = market => String(market || '').toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 80);
export const wilsonLower = (wins, total) => {
  if (!total) return 0;
  const z = 1.96, p = wins / total, z2 = z * z, d = 1 + z2 / total;
  return Math.max(0, (p + z2 / (2 * total) - z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total))) / d);
};
async function learningRead(key) {
  try { return JSON.parse((await redis(['GET', key])) || 'null') ?? { pending: [], settled: [], skills: [] }; }
  catch { return { pending: [], settled: [], skills: [] }; }
}
function learningSignature(p) {
  return [p.mode, p.interval, p.direction, p.regime || 'unknown',
    p.confidence >= 80 ? 'high' : p.confidence >= 60 ? 'medium' : 'low',
    p.expirySeconds || 0].join('|');
}

export async function learnFromObservation(user, observation) {
  if (!redisConfigured() || !user || !observation?.market || !Number.isFinite(observation.price) || observation.price <= 0) {
    return { stored: false, reason: 'learning_storage_or_market_unavailable' };
  }
  const key = learningUserKey(user) + ':' + learningMarketKey(observation.market);
  const now = Number.isFinite(observation.at) ? observation.at : Date.now();
  const state = await learningRead(key);
  let settledNow = 0;
  const remaining = [];
  for (const p of state.pending || []) {
    if (now < p.dueAt) { remaining.push(p); continue; }
    const delta = observation.price - p.entryPrice;
    const delayMs = now - p.dueAt;
    const toleranceMs = p.mode === 'binary-options'
      ? Math.max(2_000, (p.expirySeconds || 60) * 50)
      : Math.max(15_000, (p.horizonMs || 300_000) * 0.2);
    const outcome = delayMs > toleranceMs ? 'unverified'
      : Math.abs(delta) <= Math.max(p.tickSize || 0, p.entryPrice * 1e-8) ? 'tie'
      : Math.sign(delta) === p.direction ? 'win' : 'loss';
    state.settled.unshift({ ...p, settledAt: now, settlementDelayMs: delayMs,
      exitPrice: observation.price, outcome,
      returnPct: outcome === 'unverified' ? null : Number(((delta * p.direction / p.entryPrice) * 100).toFixed(5)) });
    settledNow++;
  }
  state.pending = remaining;
  const p = observation.prediction;
  let recorded = false;
  if (p && [-1, 1].includes(p.direction) && Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100) {
    const horizonMs = p.mode === 'binary-options' ? Number(p.expirySeconds) * 1000 : Number(p.horizonMs);
    if (Number.isFinite(horizonMs) && horizonMs >= 30_000 && horizonMs <= 86_400_000 && Number.isFinite(p.entryPrice) && p.entryPrice > 0) {
      const signature = learningSignature(p);
      const duplicate = state.pending.some(x => x.signature === signature && now - x.createdAt < Math.min(horizonMs, 300_000));
      if (!duplicate) {
        state.pending.unshift({
          id: randomBytes(8).toString('hex'), market: observation.market,
          mode: p.mode === 'binary-options' ? 'binary-options' : 'market',
          interval: String(p.interval || '').slice(0, 12), direction: p.direction,
          confidence: p.confidence, regime: String(p.regime || 'unknown').slice(0, 30),
          expirySeconds: p.mode === 'binary-options' ? Number(p.expirySeconds) : null,
          horizonMs: p.mode === 'binary-options' ? null : horizonMs,
          entryPrice: p.entryPrice, tickSize: Number.isFinite(p.tickSize) ? p.tickSize : 0,
          createdAt: now, dueAt: now + horizonMs, signature
        });
        recorded = true;
      }
    }
  }
  const groups = new Map();
  for (const trade of state.settled || []) {
    const g = groups.get(trade.signature) || { wins: 0, losses: 0, ties: 0, latestAt: trade.settledAt };
    if (trade.outcome === 'win') g.wins++;
    else if (trade.outcome === 'loss') g.losses++;
    else if (trade.outcome === 'tie') g.ties++;
    g.latestAt = Math.max(g.latestAt, trade.settledAt);
    groups.set(trade.signature, g);
  }
  state.skills = [...groups.entries()].flatMap(([signature, g]) => {
    const samples = g.wins + g.losses;
    if (samples < LEARNING_MIN_SKILL) return [];
    const [mode, interval, direction, regime, confidenceBand, expiry] = signature.split('|');
    const lower = wilsonLower(g.wins, samples);
    return [{
      id: 'skill_' + createHash('sha256').update(signature).digest('hex').slice(0, 20),
      signature, mode, interval, direction: Number(direction), regime, confidenceBand,
      expirySeconds: Number(expiry) || null, samples, wins: g.wins, losses: g.losses, ties: g.ties,
      observedWinRate: Number((g.wins / samples).toFixed(4)),
      winRateLower95: Number(lower.toFixed(4)),
      status: samples >= 100 && lower > 0.5 ? 'candidate_for_out_of_sample_test' : 'learning',
      rule: `Contexto ${mode}, ${interval}, regime ${regime}, confiança ${confidenceBand}: ${g.wins} vitórias em ${samples} resultados.`,
      autoApplied: false, updatedAt: g.latestAt
    }];
  }).sort((a, b) => b.samples - a.samples).slice(0, 100);
  state.pending = state.pending.slice(0, LEARNING_MAX);
  state.settled = (state.settled || []).slice(0, LEARNING_MAX);
  await redis(['SET', key, JSON.stringify(state)]);
  const wins = state.settled.filter(x => x.outcome === 'win').length;
  const losses = state.settled.filter(x => x.outcome === 'loss').length;
  return { stored: recorded || settledNow > 0, recorded, settled: settledNow,
    pending: state.pending.length, wins, losses,
    unverified: state.settled.filter(x => x.outcome === 'unverified').length,
    skills: state.skills.slice(0, 10) };
}

export async function getLearningSummary(user, market) {
  if (!redisConfigured() || !user) return { available: false, reason: 'Memória de aprendizagem não configurada.' };
  const state = await learningRead(learningUserKey(user) + ':' + learningMarketKey(market));
  const settled = state.settled || [];
  const wins = settled.filter(x => x.outcome === 'win').length;
  const losses = settled.filter(x => x.outcome === 'loss').length;
  return { available: true, pending: (state.pending || []).length, settled: settled.length,
    wins, losses, ties: settled.filter(x => x.outcome === 'tie').length,
    unverified: settled.filter(x => x.outcome === 'unverified').length,
    winRate: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
    skills: state.skills || [] };
}
