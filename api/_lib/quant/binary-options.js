/**
 * Binary-options risk gate.
 *
 * This does not predict direction and never converts a model confidence score
 * into a win probability. It only evaluates an independently measured,
 * out-of-sample win rate for the exact market/expiry/setup bucket.
 *
 * payoutPercent is the broker's NET profit percentage on a winning contract
 * (e.g. 80 means +0.80 per 1.00 staked; a loss is -1.00).
 */
export function binaryBreakEvenRate(payoutPercent) {
  const payout = Number(payoutPercent);
  if (!Number.isFinite(payout) || payout <= 0 || payout > 1000) return null;
  const ratio = payout / 100;
  return 1 / (1 + ratio);
}

/** Wilson lower confidence bound for a binomial win rate. */
export function wilsonLowerBound(wins, samples, z = 1.96) {
  const n = Number(samples);
  const w = Number(wins);
  if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(w) || w < 0 || w > n) return null;
  const p = w / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - margin) / denominator;
}

/**
 * Evaluate whether a binary-options setup has enough evidence to be shown.
 * calibration must come from out-of-sample results for the same asset class,
 * expiry, session and setup family. Missing or mismatched evidence means WAIT.
 */
export function evaluateBinaryOpportunity({
  direction,
  payoutPercent,
  wins,
  samples,
  expirySeconds,
  calibratedExpirySeconds,
  quoteAgeMs,
  maxQuoteAgeMs = 5000,
  isOtc = false,
  minSamples = 100,
  minEdge = 0.03
} = {}) {
  const wait = (reason, extra = {}) => ({
    eligible: false,
    action: 'AGUARDAR',
    breakEvenRate: binaryBreakEvenRate(payoutPercent),
    lowerWinRate: null,
    edge: null,
    reason,
    ...extra
  });

  if (direction !== 1 && direction !== -1) return wait('Direção não confirmada.');
  if (isOtc) return wait('Ativos OTC exigem dados próprios da corretora; não usar cotações de outro mercado.');
  if (!Number.isFinite(expirySeconds) || expirySeconds <= 0 || expirySeconds !== calibratedExpirySeconds) {
    return wait('A expiração não corresponde ao horizonte validado historicamente.');
  }
  if (!Number.isFinite(quoteAgeMs) || quoteAgeMs < 0 || quoteAgeMs > maxQuoteAgeMs) {
    return wait('Cotação desatualizada ou sem timestamp verificável.');
  }
  const breakEvenRate = binaryBreakEvenRate(payoutPercent);
  if (breakEvenRate == null) return wait('Pagamento da corretora inválido ou não informado.');
  if (!Number.isInteger(samples) || samples < minSamples || !Number.isInteger(wins) || wins < 0 || wins > samples) {
    return wait('Amostra histórica independente insuficiente para esta expiração.');
  }

  const lowerWinRate = wilsonLowerBound(wins, samples);
  const edge = lowerWinRate - breakEvenRate;
  if (edge < minEdge) {
    return {
      eligible: false,
      action: 'AGUARDAR',
      breakEvenRate,
      lowerWinRate,
      edge,
      reason: 'A vantagem estatística conservadora não supera o ponto de equilíbrio e a margem mínima.'
    };
  }

  return {
    eligible: true,
    action: direction > 0 ? 'CALL' : 'PUT',
    breakEvenRate,
    lowerWinRate,
    edge,
    reason: 'Evidência histórica suficiente para mostrar o cenário; não garante o resultado da operação.'
  };
}
