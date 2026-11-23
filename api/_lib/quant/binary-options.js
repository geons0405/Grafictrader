/**
 * Binary-options decision gate.
 *
 * Binary options are expiry-dependent: direction alone is not enough. A call
 * is permitted only when an out-of-sample calibration for the exact
 * market/timeframe/expiry has enough settled observations and its Wilson
 * lower confidence bound clears the payout break-even rate plus an edge.
 * Until that calibration exists, the engine returns WAIT rather than
 * presenting an unvalidated directional score as a win probability.
 */

const ALLOWED_EXPIRIES = new Set([30, 60, 120, 180, 300, 600, 900]);
const MIN_SETTLED = 200;
const MIN_EDGE = 0.03;
const Z_95 = 1.96;

function wilsonLowerBound(wins, total, z = Z_95) {
  if (!Number.isInteger(wins) || !Number.isInteger(total) || total <= 0 || wins < 0 || wins > total) return null;
  const p = wins / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) / total) + (z2 / (4 * total * total)));
  return Math.max(0, (centre - margin) / denominator);
}

export function evaluateBinaryOptions({
  vision,
  verdict,
  reading,
  expirySeconds,
  payoutPercent,
  calibration = null
} = {}) {
  const wait = (reason, extra = {}) => ({
    enabled: true,
    status: 'WAIT',
    decision: 'AGUARDAR',
    direction: 0,
    expirySeconds: Number.isFinite(expirySeconds) ? expirySeconds : null,
    probability: null,
    breakEvenProbability: null,
    validated: false,
    reasons: [reason],
    ...extra
  });

  if (!ALLOWED_EXPIRIES.has(Number(expirySeconds))) {
    return wait('Escolhe uma expiração suportada: 30s, 1m, 2m, 3m, 5m, 10m ou 15m.');
  }
  const payout = Number(payoutPercent);
  if (!Number.isFinite(payout) || payout < 50 || payout > 100) {
    return wait('Retorno da corretora inválido. Informa o payout real antes de calcular a vantagem.');
  }
  if (!vision || !verdict || !reading?.snapshot) {
    return wait('Faltam dados de gráfico e confirmação quantitativa para avaliar esta expiração.');
  }
  if (![1, -1].includes(verdict.direction) || verdict.decision === 'AGUARDAR') {
    return wait('Não existe direção suficientemente confirmada para esta expiração.');
  }
  if (vision.direction !== verdict.direction || reading.signal?.direction !== verdict.direction) {
    return wait('A leitura visual e o motor quantitativo não estão alinhados. Não entrar.');
  }

  const intervalSeconds = ({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 })[reading.interval];
  if (!intervalSeconds || expirySeconds < intervalSeconds || expirySeconds > intervalSeconds * 6) {
    return wait('A expiração não corresponde à resolução temporal dos dados disponíveis. Usa um timeframe compatível.');
  }
  if (reading.snapshot.regime === 'chaotic' || reading.context?.eventRisk?.blocked) {
    return wait('Volatilidade extrema ou evento de alto impacto: expiração bloqueada.');
  }

  const breakEven = 1 / (1 + payout / 100);
  const c = calibration;
  if (!c || c.outOfSample !== true || c.market !== reading.symbol || c.interval !== reading.interval || c.expirySeconds !== expirySeconds) {
    return wait('Ainda não existe calibração independente para este ativo, timeframe e expiração. O sistema não vai inventar uma probabilidade.');
  }
  const settled = Number(c.settled);
  const wins = Number(c.wins);
  if (!Number.isInteger(settled) || settled < MIN_SETTLED || !Number.isInteger(wins) || wins < 0 || wins > settled) {
    return wait('A amostra histórica independente ainda é insuficiente (mínimo de 200 operações concluídas).');
  }

  const lowerBound = wilsonLowerBound(wins, settled);
  if (lowerBound == null || lowerBound < breakEven + MIN_EDGE) {
    return wait('A vantagem estatística ainda não supera o ponto de equilíbrio do payout com margem de segurança.', {
      breakEvenProbability: Number(breakEven.toFixed(4)),
      calibratedLowerBound: lowerBound == null ? null : Number(lowerBound.toFixed(4)),
      sampleSize: settled
    });
  }

  const probability = wins / settled;
  return {
    enabled: true,
    status: 'VALIDATED_SETUP',
    decision: verdict.direction > 0 ? 'CALL' : 'PUT',
    direction: verdict.direction,
    expirySeconds,
    probability: Number(probability.toFixed(4)),
    calibratedLowerBound: Number(lowerBound.toFixed(4)),
    breakEvenProbability: Number(breakEven.toFixed(4)),
    validated: true,
    sampleSize: settled,
    reasons: ['Direção visual e quantitativa alinhadas.', 'Calibração fora da amostra supera o ponto de equilíbrio do payout com margem estatística.']
  };
}

export { wilsonLowerBound };
