import { redis, redisConfigured } from '../redis.js';
import { INTERVAL_SECONDS } from '../validate.js';

const MAX_PATTERNS = 100;
const MAX_OBSERVATIONS = 240;
export const HORIZONS = [3, 6, 12];
const WRITE_GATE_SECONDS = 30;

// Coarse buckets keep the fingerprint stable enough for a family to recur.
// Quantizing all eight metrics in 5-point steps made almost every
// observation unique, so no family ever accumulated outcomes.
const FINGERPRINT_KEYS = ['priceEfficiency', 'movementEnergy', 'structuralPressure'];

const libraryKey = (symbol, interval) => 'grafictrader:pattern-library:' + symbol + ':' + interval;
const gateKey = (symbol, interval) => 'grafictrader:pattern-library-gate:' + symbol + ':' + interval;

function bucket(value) {
  if (!Number.isFinite(value)) return 'x';
  return value < 34 ? 'L' : value < 67 ? 'M' : 'H';
}

export function familyFingerprint(family) {
  if (!family) return null;
  const signature = family.familySignature || {};
  return [family.id, ...FINGERPRINT_KEYS.map(key => key + ':' + bucket(signature[key]))].join('|');
}

function emptyOutcome() {
  return { samples: 0, positive: 0, negative: 0, flat: 0, avgReturnPct: 0, avgAbsReturnPct: 0 };
}

export function updateOutcome(stats, returnPct) {
  const next = { ...emptyOutcome(), ...(stats || {}) };
  const n = Number(next.samples || 0);
  next.samples = n + 1;
  if (returnPct > 0.02) next.positive += 1;
  else if (returnPct < -0.02) next.negative += 1;
  else next.flat += 1;
  next.avgReturnPct = Number(((Number(next.avgReturnPct) * n + returnPct) / next.samples).toFixed(4));
  next.avgAbsReturnPct = Number(((Number(next.avgAbsReturnPct) * n + Math.abs(returnPct)) / next.samples).toFixed(4));
  return next;
}

function summarize(patterns) {
  return patterns.map(pattern => ({
    id: pattern.id,
    label: pattern.label,
    occurrences: pattern.occurrences,
    firstSeenAt: pattern.firstSeenAt,
    lastSeenAt: pattern.lastSeenAt,
    lastSimilarity: pattern.lastSimilarity,
    avgSimilarity: pattern.avgSimilarity,
    basis: pattern.basis,
    outcomes: pattern.outcomes || {}
  }));
}

export function normalizeStored(raw, symbol, interval) {
  const empty = { version: 3, symbol, interval, updatedAt: null, patterns: [], observations: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { ...empty, patterns: parsed.map(item => ({ ...item, outcomes: item.outcomes || {} })) };
    }
    return {
      ...empty,
      updatedAt: parsed.updatedAt || null,
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      observations: Array.isArray(parsed.observations) ? parsed.observations : []
    };
  } catch {
    return empty;
  }
}

/** Candles whose period has fully elapsed; the last kline from Binance is still forming. */
export function closedCandles(candles, interval, nowMs = Date.now()) {
  const seconds = INTERVAL_SECONDS[interval] || 300;
  return (Array.isArray(candles) ? candles : [])
    .filter(candle => Number.isFinite(Number(candle.time)) && (Number(candle.time) + seconds) * 1000 <= nowMs);
}

/**
 * Pure library update: resolves pending outcomes with closed candles, records
 * the current family observation and refreshes pattern statistics.
 */
export function updateLibrary(library, { family, candles, interval, nowMs = Date.now() }) {
  const intervalSeconds = INTERVAL_SECONDS[interval] || 300;
  const patterns = (library.patterns || []).map(item => ({ ...item, outcomes: { ...(item.outcomes || {}) } }));
  const observations = (library.observations || []).map(item => ({ ...item, outcomes: { ...(item.outcomes || {}) } }));
  const closed = closedCandles(candles, interval, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const fingerprint = familyFingerprint(family);

  for (const observation of observations) {
    if (!Number.isFinite(observation.entryTime) || !Number.isFinite(observation.entryPrice)) continue;
    for (const horizon of HORIZONS) {
      if (observation.outcomes[horizon]) continue;
      const targetTime = observation.entryTime + horizon * intervalSeconds;
      const target = closed.find(candle => Number(candle.time) >= targetTime);
      if (!target || !Number.isFinite(Number(target.close))) continue;

      const returnPct = ((Number(target.close) - observation.entryPrice) / observation.entryPrice) * 100;
      observation.outcomes[horizon] = {
        returnPct: Number(returnPct.toFixed(4)),
        resolvedAt: nowIso,
        targetTime: Number(target.time)
      };
      const pattern = patterns.find(item => item.fingerprint === observation.fingerprint);
      if (pattern) pattern.outcomes[horizon] = updateOutcome(pattern.outcomes[horizon], returnPct);
    }
  }

  const entry = closed.at(-1);
  const entryTime = Number(entry?.time);
  const entryPrice = Number(entry?.close);

  if (family && Number.isFinite(entryTime) && Number.isFinite(entryPrice)) {
    const duplicate = observations.some(item => item.fingerprint === fingerprint && item.entryTime === entryTime);
    if (!duplicate) {
      observations.push({
        fingerprint,
        familyId: family.id,
        familyLabel: family.label,
        stateSequence: family.matches?.[0]?.sequence || [],
        signature: family.currentSignature,
        similarity: family.bestSimilarity,
        entryTime,
        entryPrice,
        recordedAt: nowIso,
        outcomes: {}
      });
    }

    const existing = patterns.find(item => item.fingerprint === fingerprint);
    if (existing) {
      // Count unique closed candles rather than every API poll.
      if (Number(existing.lastObservationTime) !== entryTime) existing.occurrences = Number(existing.occurrences || 0) + 1;
      Object.assign(existing, {
        lastSeenAt: nowIso,
        lastObservationTime: entryTime,
        lastSimilarity: family.bestSimilarity,
        avgSimilarity: family.avgSimilarity,
        label: family.label,
        signature: family.familySignature
      });
    } else {
      patterns.unshift({
        id: family.id,
        fingerprint,
        label: family.label,
        occurrences: 1,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        lastObservationTime: entryTime,
        lastSimilarity: family.bestSimilarity,
        avgSimilarity: family.avgSimilarity,
        signature: family.familySignature,
        basis: family.basis,
        outcomes: {}
      });
    }
  }

  // Keep observations while their longest horizon can still be resolved.
  const cutoff = nowMs / 1000 - intervalSeconds * Math.max(...HORIZONS) * 20;
  const recentObservations = observations
    .filter(item => Number.isFinite(item.entryTime) && item.entryTime >= cutoff)
    .slice(-MAX_OBSERVATIONS);

  patterns.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));

  return {
    fingerprint,
    library: {
      version: 3,
      symbol: library.symbol,
      interval: library.interval,
      updatedAt: nowIso,
      patterns: patterns.slice(0, MAX_PATTERNS),
      observations: recentObservations
    }
  };
}

export async function loadPatternLibrary(symbol, interval) {
  if (!redisConfigured()) {
    return { available: false, reason: 'Pattern Library não configurada.', patterns: [], observations: [] };
  }
  try {
    const library = normalizeStored(await redis(['GET', libraryKey(symbol, interval)]), symbol, interval);
    return { available: true, patterns: summarize(library.patterns), observations: library.observations };
  } catch (error) {
    return { available: false, reason: error?.message || 'Não foi possível ler a Pattern Library.', patterns: [], observations: [] };
  }
}

export async function rememberPatternFamily(symbol, interval, family, candles = []) {
  if (!redisConfigured()) {
    return { available: false, saved: false, reason: 'Pattern Library não configurada.', patterns: [] };
  }

  try {
    // Write gate: at most one read-modify-write per symbol/interval every
    // WRITE_GATE_SECONDS. It also serialises concurrent requests, which
    // previously overwrote each other's updates.
    const gate = await redis(['SET', gateKey(symbol, interval), '1', 'NX', 'EX', String(WRITE_GATE_SECONDS)]);
    if (gate !== 'OK') return { available: true, saved: false, reason: 'Atualização recente; escrita adiada.' };

    const stored = normalizeStored(await redis(['GET', libraryKey(symbol, interval)]), symbol, interval);
    const { library, fingerprint } = updateLibrary(stored, { family, candles, interval });
    await redis(['SET', libraryKey(symbol, interval), JSON.stringify(library)]);

    return {
      available: true,
      saved: true,
      patternCount: library.patterns.length,
      fingerprint,
      patterns: summarize(library.patterns)
    };
  } catch (error) {
    return { available: false, saved: false, reason: error?.message || 'Não foi possível guardar a família.', patterns: [] };
  }
}
