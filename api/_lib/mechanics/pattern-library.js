const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MAX_PATTERNS = 100;

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

export async function loadPatternLibrary(symbol, interval) {
  if (!configured()) {
    return {
      available: false,
      reason: 'Pattern Library não configurada.',
      patterns: []
    };
  }

  try {
    const result = await redis(['GET', key(symbol, interval)]);
    const raw = result?.result;
    const patterns = raw ? JSON.parse(raw) : [];
    return {
      available: true,
      patterns: Array.isArray(patterns) ? patterns : []
    };
  } catch (error) {
    return {
      available: false,
      reason: error?.message || 'Não foi possível ler a Pattern Library.',
      patterns: []
    };
  }
}

export async function rememberPatternFamily(symbol, interval, family) {
  if (!family || !configured()) {
    return {
      available: configured(),
      saved: false,
      reason: configured() ? 'Nenhuma família encontrada.' : 'Pattern Library não configurada.'
    };
  }

  try {
    const current = await loadPatternLibrary(symbol, interval);
    const patterns = current.patterns || [];
    const fingerprint = familyFingerprint(family);
    const now = new Date().toISOString();
    const existing = patterns.find(item => item.fingerprint === fingerprint);

    if (existing) {
      existing.occurrences = Number(existing.occurrences || 0) + 1;
      existing.lastSeenAt = now;
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
        lastSimilarity: family.bestSimilarity,
        avgSimilarity: family.avgSimilarity,
        signature: family.familySignature,
        basis: family.basis
      });
    }

    patterns.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
    const trimmed = patterns.slice(0, MAX_PATTERNS);

    await redis(['SET', key(symbol, interval), JSON.stringify(trimmed)]);

    return {
      available: true,
      saved: true,
      patternCount: trimmed.length,
      fingerprint
    };
  } catch (error) {
    return {
      available: false,
      saved: false,
      reason: error?.message || 'Não foi possível guardar a família.'
    };
  }
}
