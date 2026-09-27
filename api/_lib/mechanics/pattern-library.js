const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_PATTERNS = 100;
const MAX_OBSERVATIONS = 240;
const HORIZONS = [3, 6, 12];

const INTERVAL_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400
};

function configured() {
  return Boolean(REST_URL && REST_TOKEN);
}

async function redis(command) {
  if (!configured()) return null;
  const response = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + REST_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error('Pattern library storage unavailable.');
  return response.json();
}

function key(symbol, interval) {
  return 'grafictrader:pattern-library:' + symbol + ':' + interval;
}

function familyFingerprint(family) {
  if (!family) return null;
  const signature = family.familySignature || {};
  return [
    family.id,
    ...Object.entries(signature).map(([k, v]) => k + ':' + (Number.isFinite(v) ? Math.round(v / 5) * 5 : 'x'))
  ].join('|');
}

function emptyOutcome() {
  return {
    samples: 0,
    positive: 0,
    negative: 0,
    flat: 0,
    avgReturnPct: 0,
    avgAbsReturnPct: 0
  };
}

function updateOutcome(stats, returnPct) {
  const next = stats || emptyOutcome();
  const n = Number(next.samples || 0);
  next.samples = n + 1;
  if (returnPct > 0.02) next.positive = Number(next.positive || 0) + 1;
  else if (returnPct < -0.02) next.negative = Number(next.negative || 0) + 1;
  else next.flat = Number(next.flat || 0) + 1;

  const oldAvg = Number(next.avgReturnPct || 0);
  const oldAbs = Number(next.avgAbsReturnPct || 0);
  next.avgReturnPct = Number(((oldAvg * n + returnPct) / next.samples).toFixed(4));
  next.avgAbsReturnPct = Number(((oldAbs * n + Math.abs(returnPct)) / next.samples).toFixed(4));
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

function normalizeStored(raw, symbol, interval) {
  if (!raw) return { version: 2, symbol, interval, updatedAt: null, patterns: [], observations: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        version: 2,
        symbol,
        interval,
        updatedAt: null,
        patterns: parsed.map(item => ({ ...item, outcomes: item.outcomes || {} })),
        observations: []
      };
    }
    return {
      version: 2,
      symbol,
      interval,
      updatedAt: parsed.updatedAt || null,
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      observations: Array.isArray(parsed.observations) ? parsed.observations : []
    };
  } catch {
    return { version: 2, symbol, interval, updatedAt: null, patterns: [], observations: [] };
  }
}

export async function loadPatternLibrary(symbol, interval) {
  if (!configured()) {
    return {
      available: false,
      reason: 'Pattern Library não configurada.',
      patterns: [],
      observations: []
    };
  }

  try {
    const result = await redis(['GET', key(symbol, interval)]);
    const library = normalizeStored(result?.result, symbol, interval);
    return {
      available: true,
      patterns: summarize(library.patterns),
      observations: library.observations
    };
  } catch (error) {
    return {
      available: false,
      reason: error?.message || 'Não foi possível ler a Pattern Library.',
      patterns: [],
      observations: []
    };
  }
}

export async function rememberPatternFamily(symbol, interval, family, candles = []) {
  if (!family || !configured()) {
    return {
      available: configured(),
      saved: false,
      reason: configured() ? 'Nenhuma família encontrada.' : 'Pattern Library não configurada.',
      patterns: []
    };
  }

  try {
    const result = await redis(['GET', key(symbol, interval)]);
    const library = normalizeStored(result?.result, symbol, interval);
    const patterns = library.patterns || [];
    const observations = library.observations || [];
    const fingerprint = familyFingerprint(family);
    const now = new Date().toISOString();
    const latestCandle = candles.at(-1);
    const entryTime = Number(latestCandle?.time);
    const entryPrice = Number(latestCandle?.close);
    const intervalSeconds = INTERVAL_SECONDS[interval] || 300;

    // Resolve older observations as enough future candles become available.
    for (const observation of observations) {
      if (!Number.isFinite(observation.entryTime) || !Number.isFinite(observation.entryPrice)) continue;
      for (const horizon of HORIZONS) {
        if (observation.outcomes?.[horizon]) continue;
        const targetTime = observation.entryTime + horizon * intervalSeconds;
        const target = candles.find(candle => Number(candle.time) >= targetTime);
        if (!target || !Number.isFinite(target.close)) continue;

        const returnPct = ((Number(target.close) - observation.entryPrice) / observation.entryPrice) * 100;
        observation.outcomes = observation.outcomes || {};
        observation.outcomes[horizon] = {
          returnPct: Number(returnPct.toFixed(4)),
          resolvedAt: new Date().toISOString(),
          targetTime: Number(target.time)
        };

        const pattern = patterns.find(item => item.fingerprint === observation.fingerprint);
        if (pattern) {
          pattern.outcomes = pattern.outcomes || {};
          pattern.outcomes[horizon] = updateOutcome(pattern.outcomes[horizon], returnPct);
        }
      }
    }

    if (Number.isFinite(entryTime) && Number.isFinite(entryPrice)) {
      const lastObservation = observations.at(-1);
      const duplicate = lastObservation &&
        lastObservation.fingerprint === fingerprint &&
        Math.abs(Number(lastObservation.entryTime) - entryTime) < intervalSeconds;

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
          recordedAt: now,
          outcomes: {}
        });
      }
    }

    const existing = patterns.find(item => item.fingerprint === fingerprint);
    if (existing) {
      // Count unique observations rather than every API poll.
      const alreadyCounted = existing.lastObservationTime &&
        Number(existing.lastObservationTime) === entryTime;
      if (!alreadyCounted) existing.occurrences = Number(existing.occurrences || 0) + 1;
      existing.lastSeenAt = now;
      existing.lastObservationTime = entryTime;
      existing.lastSimilarity = family.bestSimilarity;
      existing.avgSimilarity = family.avgSimilarity;
      existing.label = family.label;
      existing.signature = family.familySignature;
    } else {
      patterns.unshift({
        id: family.id,
        fingerprint,
        label: family.label,
        occurrences: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastObservationTime: entryTime,
        lastSimilarity: family.bestSimilarity,
        avgSimilarity: family.avgSimilarity,
        signature: family.familySignature,
        basis: family.basis,
        outcomes: {}
      });
    }

    const cutoff = Date.now() / 1000 - intervalSeconds * Math.max(HORIZONS) * 20;
    const recentObservations = observations
      .filter(item => !Number.isFinite(item.entryTime) || item.entryTime >= cutoff)
      .slice(-MAX_OBSERVATIONS);

    patterns.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    const trimmed = patterns.slice(0, MAX_PATTERNS);

    const stored = {
      version: 2,
      symbol,
      interval,
      updatedAt: now,
      patterns: trimmed,
      observations: recentObservations
    };

    await redis(['SET', key(symbol, interval), JSON.stringify(stored)]);

    return {
      available: true,
      saved: true,
      patternCount: trimmed.length,
      fingerprint,
      patterns: summarize(trimmed)
    };
  } catch (error) {
    return {
      available: false,
      saved: false,
      reason: error?.message || 'Não foi possível guardar a família.',
      patterns: []
    };
  }
}
