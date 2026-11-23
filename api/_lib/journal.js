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
const LEARNING_MIN_SKILL = 100;
const LEARNING_DUE_INDEX = 'grafictrader:learning:due';
const learningUserHash = user => createHash('sha256').update(String(user)).digest('hex').slice(0, 32);
const learningUserKeyFromHash = hash => 'grafictrader:learning:' + hash;
const learningUserKey = user => learningUserKeyFromHash(learningUserHash(user));
const learningMarketKey = market => String(market || '').toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 80);
const dueMember = (hash, market, id) => hash + '~' + String(market).slice(0, 100) + '~' + id;
export const wilsonLower = (wins, total) => {
  if (!total) return 0;
  const z = 1.96, p = wins / total, z2 = z * z, d = 1 + z2 / total;
  return Math.max(0, (p + z2 / (2 * total) - z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total))) / d);
};
export const wilsonUpper = (wins, total) => {
  if (!total) return 1;
  const z = 1.96, p = wins / total, z2 = z * z, d = 1 + z2 / total;
  return Math.min(1, (p + z2 / (2 * total) + z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total))) / d);
};
async function learningRead(key) {
  // A failed read must never be treated as an empty account state.
  return JSON.parse((await redis(['GET', key])) || 'null') ?? { pending: [], settled: [], skills: [] };
}
const FEATURE_KEYS = ['hurst', 'varianceRatio', 'kalmanZ', 'entropy', 'volPercentile', 'flowImbalance', 'flowImbalanceShort', 'vwapZ', 'atrPct', 'autocorr'];
function cleanFeatures(input = {}) {
  const out = {};
  for (const name of FEATURE_KEYS) {
    const value = Number(input[name]);
    if (input[name] !== null && input[name] !== undefined && Number.isFinite(value)) {
      out[name] = Math.max(-1_000_000, Math.min(1_000_000, value));
    }
  }
  return out;
}
function learningSignature(p) {
  return [p.mode, p.interval, p.direction, p.regime || 'unknown',
    p.confidence >= 80 ? 'high' : p.confidence >= 60 ? 'medium' : 'low',
    p.expirySeconds || 0].join('|');
}
function featureInsight(avg = {}) {
  const notes = [];
  if (Number.isFinite(avg.kalmanZ)) notes.push(avg.kalmanZ > 0.8 ? 'deriva de Kalman positiva' : avg.kalmanZ < -0.8 ? 'deriva de Kalman negativa' : 'deriva de Kalman fraca');
  if (Number.isFinite(avg.flowImbalance)) notes.push(avg.flowImbalance > 0.08 ? 'fluxo comprador' : avg.flowImbalance < -0.08 ? 'fluxo vendedor' : 'fluxo equilibrado');
  if (Number.isFinite(avg.vwapZ)) notes.push(avg.vwapZ > 1.5 ? 'preço acima do VWAP' : avg.vwapZ < -1.5 ? 'preço abaixo do VWAP' : 'preço próximo do VWAP');
  if (Number.isFinite(avg.entropy)) notes.push(avg.entropy > 0.98 ? 'entropia elevada' : 'entropia controlada');
  if (Number.isFinite(avg.volPercentile)) notes.push(avg.volPercentile > 0.85 ? 'volatilidade elevada' : 'volatilidade moderada');
  return notes.slice(0, 4).join('; ') || 'contexto quantitativo ainda incompleto';
}
function resultCounts(rows) {
  const valid = rows.filter(x => x.outcome === 'win' || x.outcome === 'loss');
  return { samples: valid.length, wins: valid.filter(x => x.outcome === 'win').length, losses: valid.filter(x => x.outcome === 'loss').length };
}
function updateSkillValidation(skill, trades) {
  if (skill.status !== 'validating') return;
  for (const trade of trades) {
    if (trade.settledAt <= skill.createdAt || !['win', 'loss'].includes(trade.outcome)) continue;
    if (trade.mode !== skill.mode || trade.interval !== skill.interval) continue;
    if (trade.signature === skill.signature) {
      skill.validation.samples++;
      if (trade.outcome === 'win') skill.validation.wins++;
      else skill.validation.losses++;
    } else {
      skill.validation.baselineSamples++;
      if (trade.outcome === 'win') skill.validation.baselineWins++;
    }
  }
  const n = skill.validation.samples;
  const baselineN = skill.validation.baselineSamples;
  if (!n || !baselineN) return;
  const baselineRate = skill.validation.baselineWins / baselineN;
  const lower = wilsonLower(skill.validation.wins, n);
  const upper = wilsonUpper(skill.validation.wins, n);
  const baselineLower = wilsonLower(skill.validation.baselineWins, baselineN);
  const baselineUpper = wilsonUpper(skill.validation.baselineWins, baselineN);
  skill.validation.winRate = Number((skill.validation.wins / n).toFixed(4));
  skill.validation.baselineWinRate = Number(baselineRate.toFixed(4));
  skill.validation.wilsonLower95 = Number(lower.toFixed(4));
  skill.validation.wilsonUpper95 = Number(upper.toFixed(4));
  skill.validation.baselineWilsonLower95 = Number(baselineLower.toFixed(4));
  skill.validation.baselineWilsonUpper95 = Number(baselineUpper.toFixed(4));
  if (n >= 100 && baselineN >= 100) {
    if (skill.action === 'support' && lower > baselineUpper + 0.02) skill.status = 'validated';
    else if (skill.action === 'avoid' && upper < baselineLower - 0.02) skill.status = 'validated_avoid';
    else if ((skill.action === 'support' && upper < baselineLower) || (skill.action === 'avoid' && lower > baselineUpper)) skill.status = 'rejected';
    else if (n >= 300 && baselineN >= 300) skill.status = 'inconclusive';
  }
  skill.updatedAt = trades.at(-1)?.settledAt || skill.updatedAt;
}
function buildSkillCandidates(state, now) {
  const groups = new Map();
  const eligible = (state.settled || []).filter(t => ['win', 'loss'].includes(t.outcome));
  for (const trade of eligible) {
    const g = groups.get(trade.signature) || { trades: [], featureSums: {}, featureCounts: {} };
    g.trades.push(trade);
    for (const [name, value] of Object.entries(trade.features || {})) {
      if (!FEATURE_KEYS.includes(name) || !Number.isFinite(value)) continue;
      g.featureSums[name] = (g.featureSums[name] || 0) + value;
      g.featureCounts[name] = (g.featureCounts[name] || 0) + 1;
    }
    groups.set(trade.signature, g);
  }
  const existing = new Set((state.skills || []).map(s => s.signature));
  const created = [];
  for (const [signature, g] of groups) {
    const counts = resultCounts(g.trades);
    if (counts.samples < LEARNING_MIN_SKILL || existing.has(signature)) continue;
    const first = g.trades[0];
    const baselineRows = eligible.filter(t => t.mode === first.mode && t.interval === first.interval && t.signature !== signature);
    const baseline = resultCounts(baselineRows);
    if (!baseline.samples) continue;
    const rate = counts.wins / counts.samples;
    const baselineRate = baseline.wins / baseline.samples;
    const lower = wilsonLower(counts.wins, counts.samples);
    const upper = wilsonUpper(counts.wins, counts.samples);
    const action = lower > baselineRate + 0.02 ? 'support'
      : upper < baselineRate - 0.02 ? 'avoid' : null;
    if (!action) continue;
    const [mode, interval, direction, regime, confidenceBand, expiry] = signature.split('|');
    const featureAverages = Object.fromEntries(Object.entries(g.featureSums).map(([name, sum]) => [name, Number((sum / g.featureCounts[name]).toFixed(5))]));
    const skill = {
      id: 'skill_' + createHash('sha256').update(signature).digest('hex').slice(0, 20),
      signature, mode, interval, direction: Number(direction), regime, confidenceBand,
      expirySeconds: Number(expiry) || null, action,
      training: { samples: counts.samples, wins: counts.wins, losses: counts.losses, winRate: Number(rate.toFixed(4)), baselineSamples: baseline.samples, baselineWinRate: Number(baselineRate.toFixed(4)), wilsonLower95: Number(lower.toFixed(4)), wilsonUpper95: Number(upper.toFixed(4)), baselineWilsonLower95: Number(baselineLower.toFixed(4)), baselineWilsonUpper95: Number(baselineUpper.toFixed(4)) },
      validation: { samples: 0, wins: 0, losses: 0, baselineSamples: 0, baselineWins: 0 },
      featureAverages, featureInsight: featureInsight(featureAverages),
      status: 'validating', autoApplied: false, createdAt: now, updatedAt: now,
      rule: action === 'support'
        ? 'Contexto com desempenho histórico acima da linha de base; em validação independente.'
        : 'Contexto historicamente fraco; testar se evitar este sinal melhora a estratégia.'
    };
    state.skills.push(skill);
    created.push(skill);
  }
  state.skills = (state.skills || []).slice(-100);
  return created;
}
async function learnFromObservationUnlocked(user, observation, userHashOverride = null) {
  const userHash = userHashOverride || learningUserHash(user);
  if (!redisConfigured() || !userHash || !observation?.market ||
      (!observation.unverifiedOnly && (!Number.isFinite(observation.price) || observation.price <= 0))) {
    return { stored: false, reason: 'learning_storage_or_market_unavailable' };
  }
  const key = learningUserKeyFromHash(userHash) + ':' + learningMarketKey(observation.market);
  const now = Number.isFinite(observation.at) ? observation.at : Date.now();
  const priceAt = Number.isFinite(observation.priceAt) ? observation.priceAt : now;
  const state = await learningRead(key);
  let settledNow = 0;
  const newlySettled = [];
  const removeMembers = [];
  const remaining = [];
  for (const p of state.pending || []) {
    if (priceAt < p.dueAt) { remaining.push(p); continue; }
    // An external market quote is not proof of the broker's binary-options expiry price.
    if (p.mode === 'binary-options' && observation.priceSource !== 'broker') {
      const trade = { ...p, settledAt: now, observedAt: now, settlementDelayMs: now - p.dueAt, exitPrice: null, outcome: 'unverified', returnPct: null };
      state.settled.unshift(trade); newlySettled.push(trade); settledNow++;
      if (p.indexMember) removeMembers.push(p.indexMember);
      continue;
    }
    if (observation.unverifiedOnly && p.mode !== 'binary-options') { remaining.push(p); continue; }
    const delta = observation.price - p.entryPrice;
    const delayMs = priceAt - p.dueAt;
    const toleranceMs = p.mode === 'binary-options'
      ? Math.max(2_000, (p.expirySeconds || 60) * 50)
      : Math.max(15_000, (p.horizonMs || 300_000) * 0.2);
    const outcome = observation.unverifiedOnly || delayMs > toleranceMs ? 'unverified'
      : Math.abs(delta) <= Math.max(p.tickSize || 0, p.entryPrice * 1e-8) ? 'tie'
      : Math.sign(delta) === p.direction ? 'win' : 'loss';
    const trade = { ...p, settledAt: priceAt, observedAt: now, settlementDelayMs: delayMs,
      exitPrice: Number.isFinite(observation.price) ? observation.price : null, outcome,
      returnPct: outcome === 'unverified' ? null : Number(((delta * p.direction / p.entryPrice) * 100).toFixed(5)) };
    state.settled.unshift(trade); newlySettled.push(trade); settledNow++;
    if (p.indexMember) removeMembers.push(p.indexMember);
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
        const id = randomBytes(8).toString('hex');
        const member = dueMember(userHash, observation.market, id);
        state.pending.unshift({
          id, indexMember: member, market: observation.market,
          mode: p.mode === 'binary-options' ? 'binary-options' : 'market',
          interval: String(p.interval || '').slice(0, 12), direction: p.direction,
          confidence: p.confidence, regime: String(p.regime || 'unknown').slice(0, 30),
          expirySeconds: p.mode === 'binary-options' ? Number(p.expirySeconds) : null,
          horizonMs: p.mode === 'binary-options' ? null : horizonMs,
          entryPrice: p.entryPrice, tickSize: Number.isFinite(p.tickSize) ? p.tickSize : 0,
          features: cleanFeatures(p.features),
          createdAt: now, dueAt: now + horizonMs, signature
        });
        recorded = true;
      }
    }
  }
  state.pending = (state.pending || []).slice(0, LEARNING_MAX);
  state.settled = (state.settled || []).slice(0, LEARNING_MAX);
  for (const skill of state.skills || []) updateSkillValidation(skill, newlySettled);
  buildSkillCandidates(state, now);
  await redis(['SET', key, JSON.stringify(state)]);
  for (const member of removeMembers) await redis(['ZREM', LEARNING_DUE_INDEX, member]);
  if (recorded) {
    const pending = state.pending[0];
    if (pending?.indexMember) await redis(['ZADD', LEARNING_DUE_INDEX, String(pending.dueAt), pending.indexMember]);
  }
  const wins = state.settled.filter(x => x.outcome === 'win').length;
  const losses = state.settled.filter(x => x.outcome === 'loss').length;
  return { stored: recorded || settledNow > 0, recorded, settled: settledNow,
    pending: state.pending.length, wins, losses,
    unverified: state.settled.filter(x => x.outcome === 'unverified').length,
    skills: state.skills.slice(0, 10) };
}
async function withLearningLock(userHash, market, fn) {
  const key = learningUserKeyFromHash(userHash) + ':' + learningMarketKey(market);
  const lock = key + ':lock';
  const token = randomBytes(16).toString('hex');
  let acquired = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await redis(['SET', lock, token, 'NX', 'EX', '30']);
    if (result === 'OK') { acquired = true; break; }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
  }
  if (!acquired) return { stored: false, reason: 'learning_update_busy' };
  try { return await fn(); }
  finally {
    try { if ((await redis(['GET', lock])) === token) await redis(['DEL', lock]); } catch { /* lease expiry releases it */ }
  }
}
export async function learnFromObservation(user, observation) {
  if (!redisConfigured() || !user || !observation?.market) return { stored: false, reason: 'learning_storage_or_market_unavailable' };
  return withLearningLock(learningUserHash(user), observation.market,
    () => learnFromObservationUnlocked(user, observation));
}
export async function settleDueLearning({ getPrice, limit = 50, now = Date.now() } = {}) {
  if (!redisConfigured()) return { processed: 0, settled: 0, skipped: 0, reason: 'redis_unavailable' };
  const members = await redis(['ZRANGEBYSCORE', LEARNING_DUE_INDEX, '-inf', String(now), 'LIMIT', '0', String(Math.max(1, Math.min(100, limit)))]) || [];
  let processed = 0, settled = 0, skipped = 0;
  const startedAt = Date.now();
  const priceCache = new Map();
  for (const member of members) {
    if (Date.now() - startedAt > 45_000) break;
    const [userHash, market, id] = String(member).split('~');
    if (!userHash || !market || !id) { await redis(['ZREM', LEARNING_DUE_INDEX, member]); continue; }
    const key = learningUserKeyFromHash(userHash) + ':' + learningMarketKey(market);
    const state = await learningRead(key);
    const pending = (state.pending || []).find(p => p.id === id);
    if (!pending) { await redis(['ZREM', LEARNING_DUE_INDEX, member]); continue; }
    let quote = null;
    if (pending.mode !== 'binary-options') {
      const [symbol, interval] = String(market).split('|');
      const cacheKey = symbol + '|' + interval;
      if (priceCache.has(cacheKey)) quote = priceCache.get(cacheKey);
      else {
        try { quote = await getPrice?.(symbol, interval); } catch { quote = null; }
        priceCache.set(cacheKey, quote);
      }
      if (!Number.isFinite(quote?.price) || quote.price <= 0) { skipped++; continue; }
    }
    const result = await withLearningLock(userHash, market, () => learnFromObservationUnlocked(null, {
      market, price: quote?.price, at: now, priceAt: quote?.at || now,
      priceSource: 'external-market-feed', unverifiedOnly: pending.mode === 'binary-options'
    }, userHash));
    const refreshed = await learningRead(key);
    if (!(refreshed.pending || []).some(p => p.id === id)) await redis(['ZREM', LEARNING_DUE_INDEX, member]);
    if (result.stored) { processed++; settled += result.settled || 0; }
    else skipped++;
  }
  return { processed, settled, skipped };
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
