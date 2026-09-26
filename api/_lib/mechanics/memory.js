import { analyzeMarketMechanics } from './index.js';

const WINDOW = 20;
const MAX_WINDOWS = 12;
const PATTERN_LENGTH = 3;
const FAMILY_THRESHOLD = 72;

// These metrics are normalized to 0–100 by the mechanics engine.
// Historical windows intentionally use OHLCV only; live microstructure
// is not available for every historical window.
const SIGNATURE_KEYS = [
  'priceEfficiency',
  'movementEnergy',
  'absorption',
  'displacementCost',
  'liquidityResistance',
  'marketOrderliness',
  'regimeStability',
  'structuralPressure'
];

function safeSlice(candles, end) {
  return candles.slice(Math.max(0, end - WINDOW), end);
}

function compactMetrics(result) {
  const m = result?.metrics || {};
  return {
    priceEfficiency: m.priceEfficiency,
    movementEnergy: m.movementEnergy,
    absorption: m.absorption,
    displacementCost: m.displacementCost,
    liquidityResistance: m.liquidityResistance,
    marketOrderliness: m.marketOrderliness,
    regimeStability: m.regimeStability,
    structuralPressure: m.structuralPressure
  };
}

function distance(a, b) {
  let sum = 0;
  let count = 0;
  for (const key of SIGNATURE_KEYS) {
    if (Number.isFinite(a?.[key]) && Number.isFinite(b?.[key])) {
      sum += Math.abs(a[key] - b[key]) / 100;
      count++;
    }
  }
  return count ? sum / count : 0;
}

function signatureDistance(currentItems, historicalItems) {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < PATTERN_LENGTH; i++) {
    const current = currentItems[i]?.metrics || {};
    const historical = historicalItems[i]?.metrics || {};

    for (const key of SIGNATURE_KEYS) {
      if (Number.isFinite(current[key]) && Number.isFinite(historical[key])) {
        sum += Math.abs(current[key] - historical[key]) / 100;
        count++;
      }
    }
  }

  return count ? sum / count : null;
}

function signatureSimilarity(currentItems, historicalItems) {
  const d = signatureDistance(currentItems, historicalItems);
  return d == null ? null : Math.max(0, Math.min(100, Math.round((1 - d) * 100)));
}

function stateSequence(items) {
  return items.map(item => item.state).filter(Boolean);
}

function patternWindows(items) {
  const windows = [];
  for (let i = 0; i <= items.length - PATTERN_LENGTH; i++) {
    windows.push(items.slice(i, i + PATTERN_LENGTH));
  }
  return windows;
}

function familySignature(items) {
  const out = {};
  for (const key of SIGNATURE_KEYS) {
    const values = items
      .map(item => item?.metrics?.[key])
      .filter(Number.isFinite);
    out[key] = values.length
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : null;
  }
  return out;
}

function familyLabel(items) {
  const states = stateSequence(items);
  const short = states.map(state => String(state).replaceAll('_', ' '));
  return short.join(' → ') || 'MIXED MECHANICS';
}

function findRecurringPattern(items) {
  if (items.length < PATTERN_LENGTH * 2) return null;

  const currentItems = items.slice(-PATTERN_LENGTH);
  const current = stateSequence(currentItems);
  if (current.length !== PATTERN_LENGTH) return null;

  const matches = [];

  for (let i = 0; i <= items.length - PATTERN_LENGTH * 2; i++) {
    const candidateItems = items.slice(i, i + PATTERN_LENGTH);
    const candidate = stateSequence(candidateItems);

    if (candidate.length === PATTERN_LENGTH && candidate.every((state, j) => state === current[j])) {
      matches.push({
        startStep: i + 1,
        endStep: i + PATTERN_LENGTH,
        sequence: candidate,
        similarity: signatureSimilarity(currentItems, candidateItems),
        signature: candidateItems.map(item => item.metrics)
      });
    }
  }

  if (!matches.length) return null;

  const scored = matches.filter(match => Number.isFinite(match.similarity));
  const bestSimilarity = scored.length
    ? Math.max(...scored.map(match => match.similarity))
    : null;

  return {
    sequence: current,
    occurrences: matches.length,
    matches,
    bestSimilarity,
    currentSignature: currentItems.map(item => item.metrics),
    basis: 'OHLCV_PATTERN'
  };
}

function findPatternFamily(items) {
  if (items.length < PATTERN_LENGTH * 2) return null;

  const currentItems = items.slice(-PATTERN_LENGTH);
  const candidates = patternWindows(items).slice(0, -1);
  const matches = [];

  for (const candidateItems of candidates) {
    const similarity = signatureSimilarity(currentItems, candidateItems);
    if (similarity != null && similarity >= FAMILY_THRESHOLD) {
      matches.push({
        startStep: items.indexOf(candidateItems[0]) + 1,
        endStep: items.indexOf(candidateItems[candidateItems.length - 1]) + 1,
        sequence: stateSequence(candidateItems),
        similarity,
        signature: familySignature(candidateItems)
      });
    }
  }

  if (!matches.length) return null;

  matches.sort((a, b) => b.similarity - a.similarity);

  const all = [currentItems, ...matches.map(match =>
    items.slice(match.startStep - 1, match.endStep)
  )];

  const familySignatures = all.map(familySignature);
  const aggregate = {};
  for (const key of SIGNATURE_KEYS) {
    const values = familySignatures.map(signature => signature[key]).filter(Number.isFinite);
    aggregate[key] = values.length
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : null;
  }

  const avgSimilarity = Math.round(
    matches.reduce((sum, match) => sum + match.similarity, 0) / matches.length
  );

  return {
    id: familyLabel(currentItems).replace(/[^A-Z0-9]+/gi, '_').replace(/^_|_$/g, '').toUpperCase(),
    label: familyLabel(currentItems),
    occurrences: matches.length,
    avgSimilarity,
    bestSimilarity: matches[0].similarity,
    threshold: FAMILY_THRESHOLD,
    basis: 'OHLCV_SIGNATURE_FAMILY',
    currentSignature: familySignature(currentItems),
    familySignature: aggregate,
    matches: matches.slice(0, 5)
  };
}

function buildTransitions(sequence) {
  const transitions = [];
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] !== sequence[i - 1]) {
      transitions.push({ from: sequence[i - 1], to: sequence[i], step: i + 1 });
    }
  }
  return transitions;
}

export function buildMechanicsMemory(candles) {
  if (!Array.isArray(candles) || candles.length < WINDOW) {
    return {
      available: false,
      reason: 'Histórico insuficiente para construir memória mecânica.',
      timeline: [],
      currentState: null,
      previousState: null,
      transition: null,
      durationBars: 0,
      changeScore: null,
      pattern: null,
      patternFamily: null,
      transitions: []
    };
  }

  const timeline = [];
  for (let end = WINDOW; end <= candles.length; end += WINDOW) {
    const slice = safeSlice(candles, end);
    const result = analyzeMarketMechanics(slice);
    const last = slice[slice.length - 1];

    timeline.push({
      index: timeline.length,
      endTime: last?.time ?? null,
      state: result.state,
      metrics: compactMetrics(result)
    });
  }

  if (timeline.at(-1)?.endTime !== candles.at(-1)?.time) {
    const result = analyzeMarketMechanics(candles.slice(-WINDOW));
    timeline.push({
      index: timeline.length,
      endTime: candles.at(-1)?.time ?? null,
      state: result.state,
      metrics: compactMetrics(result)
    });
  }

  const recent = timeline.slice(-MAX_WINDOWS);
  const current = recent.at(-1);
  let durationBars = WINDOW;

  for (let i = recent.length - 2; i >= 0; i--) {
    if (recent[i].state !== current.state) break;
    durationBars += WINDOW;
  }

  const previous = recent.length > 1 ? recent[recent.length - 2] : null;
  const transition = previous && previous.state !== current.state
    ? { from: previous.state, to: current.state }
    : null;

  const changeScore = previous ? Math.round(distance(current.metrics, previous.metrics) * 100) : 0;
  const sequence = stateSequence(recent);

  return {
    available: true,
    windowBars: WINDOW,
    currentState: current.state,
    previousState: previous?.state || null,
    transition,
    durationBars,
    changeScore,
    pattern: findRecurringPattern(recent),
    patternFamily: findPatternFamily(recent),
    transitions: buildTransitions(sequence),
    timeline: recent.map((item, i) => ({
      step: i + 1,
      endTime: item.endTime,
      state: item.state,
      signature: item.metrics
    }))
  };
}
