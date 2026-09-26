import { analyzeMarketMechanics } from './index.js';

const WINDOW = 20;
const MAX_WINDOWS = 6;

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
  const keys = Object.keys(a || {});
  let sum = 0;
  let count = 0;
  for (const key of keys) {
    if (Number.isFinite(a[key]) && Number.isFinite(b?.[key])) {
      sum += Math.abs(a[key] - b[key]) / 100;
      count++;
    }
  }
  return count ? sum / count : 0;
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
      changeScore: null
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

  return {
    available: true,
    windowBars: WINDOW,
    currentState: current.state,
    previousState: previous?.state || null,
    transition,
    durationBars,
    changeScore,
    timeline: recent.map((item, i) => ({
      step: i + 1,
      endTime: item.endTime,
      state: item.state
    }))
  };
}
