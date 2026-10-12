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
    private String lastContext;

    String shown() {
        return shown;
    }

    /** {@code context} names the market on screen (asset + timeframe); a new one starts over. */
    Step push(String decision, boolean chartVisible, String context) {
        if (!chartVisible) return new Step(shown, null, false);
        boolean contextChanged = false;
        if (context != null && lastContext != null && !context.equals(lastContext)) {
            shown = null;
            pending = null;
            count = 0;
            contextChanged = true;
        }
        if (context != null) lastContext = context;
        if (shown == null) {
            // The very first trade direction waits for its confirmation like any change.
            if ("AGUARDAR".equals(decision)) {
                shown = decision;
                return new Step(shown, null, true, contextChanged);
            }
            shown = "AGUARDAR";
            pending = decision;
            count = 1;
            return new Step(shown, pending, true, contextChanged);
        }
        if (decision.equals(shown)) {
            pending = null;
            count = 0;
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
        }
        if (count >= CONFIRMATIONS) {
            shown = decision;
            pending = null;
            count = 0;
            return new Step(shown, null, true);
        }
        return new Step(shown, pending, false);
    }
}
