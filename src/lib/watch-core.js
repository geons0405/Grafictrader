// Pure helpers for live broker analysis (testable without a browser).

/** Grayscale signature of an RGBA frame (Uint8ClampedArray from a tiny canvas). */
export function frameSignature(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

/** Mean absolute difference between two signatures, 0–255. */
export function frameDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Decides whether a frame is worth sending to the AI.
 * Sends when the picture changed enough (new candle, price moved) and the
 * minimum gap passed, or as a heartbeat after maxGap even if nothing changed.
 */
export function shouldSend({ now, lastSentAt, diff, minGapMs = 8000, maxGapMs = 45000, threshold = 1.5 }) {
  if (lastSentAt == null) return true;
  const elapsed = now - lastSentAt;
  if (elapsed < minGapMs) return false;
  return diff >= threshold || elapsed >= maxGapMs;
}

/**
 * Keeps the advice steady: moving to "AGUARDAR" (caution) is immediate,
 * but switching to a trade direction needs the same reading `confirmations`
 * times in a row, so one noisy frame does not flip BUY into SELL. A strong
 * reading (the server's verdict.strong) needs only one.
 */
export function createStabilizer({ confirmations = 2 } = {}) {
  let shown = null;
  let pending = null;
  let count = 0;
  let lastContext = null;
  return {
    /**
     * `context` names the market on screen (asset + timeframe). When it
     * changes, everything starts again: a new market's first trade also
     * needs its confirmations, and the caller must forget the old levels.
     */
    push(decision, { chartVisible = true, context = null, strong = false } = {}) {
      // A strong signal (high certainty, confirmed by the live market) is shown at once.
      const needed = strong ? 1 : confirmations;
      if (!chartVisible) return { shown, changed: false, pending: null, noChart: true };
      let contextChanged = false;
      if (context && lastContext && context !== lastContext) {
        shown = null;
        pending = null;
        count = 0;
        contextChanged = true;
      }
      if (context) lastContext = context;
      if (shown === null) {
        // The very first trade direction is not shown at once either: it waits like any change.
        shown = 'AGUARDAR';
        if (decision === 'AGUARDAR' || needed <= 1) {
          shown = decision;
          return { shown, changed: true, pending: null, contextChanged };
        }
        pending = decision;
        count = 1;
        return { shown, changed: true, pending, contextChanged };
      }
      if (decision === shown) {
        pending = null;
        count = 0;
        return { shown, changed: false, pending: null };
      }
      if (decision === 'AGUARDAR') {
        shown = decision;
        pending = null;
        count = 0;
        return { shown, changed: true, pending: null };
      }
      if (pending === decision) count += 1;
      else { pending = decision; count = 1; }
      if (count >= needed) {
        shown = decision;
        pending = null;
        count = 0;
        return { shown, changed: true, pending: null };
      }
      return { shown, changed: false, pending };
    },
    reset() {
      shown = null;
      pending = null;
      count = 0;
      lastContext = null;
    },
    get shown() {
      return shown;
    }
  };
}
