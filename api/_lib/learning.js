import { randomBytes } from 'node:crypto';
import { redis, redisConfigured } from './redis.js';

const MAX_PREDICTIONS = 500;
const MAX_SKILLS = 100;
const MIN_SKILL_SAMPLES = 20;
const Z = 1.96;
const safeId = value => String(value || '').toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 80);
const userKey = email => 'grafictrader:learning:' + safeId(email);
const marketKey = market => safeId(market);

function wilsonLower(wins, total) {
  if (!total) return 0;
  const p = wins / total, z2 = Z * Z, d = 1 + z2 / total;
  return Math.max(0, (p + z2 / (2 * total) - Z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total))) / d);
}

async function read(key, fallback) {
  try { return JSON.parse((await redis(['GET', key])) || 'null') ?? fallback; }
  catch { return fallback; }
}
async function write(key, value) {
  await redis(['SET', key, JSON.stringify(value)]);
}

function signatureOf(p) {
  return [
    p.mode, p.interval, p.direction,
    p.regime || 'unknown',
    p.confidence >= 80 ? 'high' : p.confidence >= 60 ? 'medium' : 'low',
    p.expirySeconds || 0
  ].join('|');
}

/**
 * Store a prediction and settle expired predictions against a later observed
 * market price. No screenshots, credentials, balances or personal notes are stored.
 * Skills remain proposals until their evidence is independently validated.
 */
export async function learnFromObservation(user, observation) {
  if (!redisConfigured() || !user || !observation?.market || !Number.isFinite(observation.price) || observation.price <= 0) {
    return { stored: false, reason: 'learning_storage_or_market_unavailable' };
  }
  const root = userKey(user);
  const key = root + ':' + marketKey(observation.market);
  const now = Number.isFinite(observation.at) ? observation.at : Date.now();
  const state = await read(key, { pending: [], settled: [], skills: [] });
  let settledNow = 0;

  const remaining = [];
  for (const p of state.pending || []) {
    if (now < p.dueAt) { remaining.push(p); continue; }
    const delta = observation.price - p.entryPrice;
    const outcome = Math.abs(delta) <= Math.max(p.tickSize || 0, p.entryPrice * 1e-8)
      ? 'tie'
      : Math.sign(delta) === p.direction ? 'win' : 'loss';
    state.settled.unshift({
      ...p, settledAt: now, exitPrice: observation.price, outcome,
      returnPct: Number(((delta * p.direction / p.entryPrice) * 100).toFixed(5))
    });
    settledNow++;
  }
  state.pending = remaining;

  const p = observation.prediction;
  let recorded = false;
  if (p && [-1, 1].includes(p.direction) && Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100) {
    const horizonMs = p.mode === 'binary-options'
      ? Number(p.expirySeconds) * 1000
      : Number(p.horizonMs);
    const validHorizon = Number.isFinite(horizonMs) && horizonMs >= 30_000 && horizonMs <= 86_400_000;
    if (validHorizon && Number.isFinite(p.entryPrice) && p.entryPrice > 0) {
      const signature = signatureOf(p);
      const duplicate = state.pending.some(x => x.signature === signature && now - x.createdAt < Math.min(horizonMs, 300_000));
      if (!duplicate) {
        state.pending.unshift({
          id: randomBytes(8).toString('hex'),
          market: observation.market,
          mode: p.mode === 'binary-options' ? 'binary-options' : 'market',
          interval: String(p.interval || '').slice(0, 12),
          direction: p.direction,
          confidence: p.confidence,
          regime: String(p.regime || 'unknown').slice(0, 30),
          expirySeconds: p.mode === 'binary-options' ? Number(p.expirySeconds) : null,
          entryPrice: p.entryPrice,
          tickSize: Number.isFinite(p.tickSize) ? p.tickSize : 0,
          createdAt: now,
          dueAt: now + horizonMs,
          signature
        });
        recorded = true;
      }
    }
  }

  const settled = state.settled || [];
  const groups = new Map();
  for (const trade of settled) {
    const signature = trade.signature;
    const g = groups.get(signature) || { wins: 0, losses: 0, ties: 0, latestAt: trade.settledAt, sample: [] };
    if (trade.outcome === 'win') g.wins++;
    else if (trade.outcome === 'loss') g.losses++;
    else g.ties++;
    g.latestAt = Math.max(g.latestAt, trade.settledAt);
    g.sample.push(trade);
    groups.set(signature, g);
  }

  const skills = [];
  for (const [signature, g] of groups) {
    const n = g.wins + g.losses;
    if (n < MIN_SKILL_SAMPLES) continue;
    const [mode, interval, direction, regime, confidenceBand, expiry] = signature.split('|');
    const lower = wilsonLower(g.wins, n);
    skills.push({
      id: 'skill_' + Buffer.from(signature).toString('base64url').slice(0, 24),
      signature, mode, interval, direction: Number(direction), regime,
      confidenceBand, expirySeconds: Number(expiry) || null,
      samples: n, wins: g.wins, losses: g.losses, ties: g.ties,
      observedWinRate: Number((g.wins / n).toFixed(4)),
      winRateLower95: Number(lower.toFixed(4)),
      status: n >= 100 && lower > 0.5 ? 'candidate_for_out_of_sample_test' : 'learning',
      rule: `Contexto ${mode}, ${interval}, regime ${regime}, confiança ${confidenceBand}, direção ${direction === '1' ? 'alta' : 'baixa'}: ${g.wins} vitórias em ${n} resultados não empatados.`,
      autoApplied: false,
      updatedAt: g.latestAt
    });
  }
  skills.sort((a, b) => b.samples - a.samples);
  state.skills = skills.slice(0, MAX_SKILLS);
  state.settled = settled.slice(0, MAX_PREDICTIONS);
  state.pending = state.pending.slice(0, MAX_PREDICTIONS);
  await write(key, state);

  return {
    stored: recorded || settledNow > 0,
    recorded,
    settled: settledNow,
    pending: state.pending.length,
    skills: state.skills.slice(0, 10)
  };
}

export async function getLearningSummary(user, market) {
  if (!redisConfigured() || !user) return { available: false, reason: 'Memória de aprendizagem não configurada.' };
  const key = userKey(user) + ':' + marketKey(market);
  const state = await read(key, { pending: [], settled: [], skills: [] });
  const settled = state.settled || [];
  const wins = settled.filter(x => x.outcome === 'win').length;
  const losses = settled.filter(x => x.outcome === 'loss').length;
  return {
    available: true,
    pending: (state.pending || []).length,
    settled: settled.length,
    wins, losses,
    ties: settled.filter(x => x.outcome === 'tie').length,
    winRate: wins + losses ? Number((wins / (wins + losses)).toFixed(4)) : null,
    skills: state.skills || []
  };
}

export { wilsonLower };
