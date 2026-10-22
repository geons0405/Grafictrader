package com.grafictrader.app;

/**
 * Keeps the advice steady (same rules as src/lib/watch-core.js):
 * moving to AGUARDAR is immediate, a new trade direction needs two matching
 * readings in a row, and frames without a chart never change the advice.
 */
final class Stabilizer {
    static final class Step {
        final String shown;
        final String pending;
        final boolean changed;
        final boolean contextChanged;

        Step(String shown, String pending, boolean changed) {
            this(shown, pending, changed, false);
        }

        Step(String shown, String pending, boolean changed, boolean contextChanged) {
            this.shown = shown;
            this.pending = pending;
            this.changed = changed;
            this.contextChanged = contextChanged;
        }
    }

    private static final int CONFIRMATIONS = 2;
    private String shown;
    private String pending;
    private int count;
    private boolean skipped;
    private String lastContext;

    String shown() {
        return shown;
    }

    Step push(String decision, boolean chartVisible, String context) {
        return push(decision, chartVisible, context, false);
    }

    /**
     * {@code context} names the market on screen (asset + timeframe); a new one starts over.
     * A {@code strong} reading (high certainty, confirmed by the live market) needs no second look.
     */
    Step push(String decision, boolean chartVisible, String context, boolean strong) {
        int needed = strong ? 1 : CONFIRMATIONS;
        if (!chartVisible) return new Step(shown, null, false);
        boolean contextChanged = false;
        if (context != null && lastContext != null && !context.equals(lastContext)) {
            shown = null;
            pending = null;
            count = 0;
            skipped = false;
            contextChanged = true;
        }
        if (context != null) lastContext = context;
        if (shown == null) {
            // The very first trade direction waits for its confirmation like any change.
            if ("AGUARDAR".equals(decision) || needed <= 1) {
                shown = decision;
                return new Step(shown, null, true, contextChanged);
            }
            shown = "AGUARDAR";
            pending = decision;
            count = 1;
            return new Step(shown, pending, true, contextChanged);
        }
        if (decision.equals(shown)) {
            // One cautious reading in the middle of a confirmation does not cancel it:
            // the AI often hesitates for a frame while the opportunity is still there.
            if ("AGUARDAR".equals(decision) && pending != null && !skipped) {
                skipped = true;
                return new Step(shown, pending, false);
            }
            pending = null;
            count = 0;
            skipped = false;
            return new Step(shown, null, false);
        }
        if ("AGUARDAR".equals(decision)) {
            shown = decision;
            pending = null;
            count = 0;
            return new Step(shown, null, true);
        }
        if (decision.equals(pending)) count += 1;
        else {
            pending = decision;
            count = 1;
            skipped = false;
        }
        if (count >= needed) {
            shown = decision;
            pending = null;
            count = 0;
            skipped = false;
            return new Step(shown, null, true);
        }
        return new Step(shown, pending, false);
    }
}
