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

        Step(String shown, String pending, boolean changed) {
            this.shown = shown;
            this.pending = pending;
            this.changed = changed;
        }
    }

    private static final int CONFIRMATIONS = 2;
    private String shown;
    private String pending;
    private int count;

    String shown() {
        return shown;
    }

    Step push(String decision, boolean chartVisible) {
        if (!chartVisible) return new Step(shown, null, false);
        if (shown == null || decision.equals(shown)) {
            boolean changed = shown == null;
            shown = decision;
            pending = null;
            count = 0;
            return new Step(shown, null, changed);
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
