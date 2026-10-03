import { quantSnapshot, decide, regimeLabel } from './signal.js';

// The AI instructor trades a simulated account candle by candle.
// Entries happen at the close of the signal candle; exits are checked on
// following candles against stop/target with the conservative rule that a
// candle touching both levels counts as a stop.

export const START_BALANCE = 1000;
export const RISK_PER_TRADE = 0.01;
const STOP_ATR = 1.5;
const TARGET_R = 2;
const MAX_BARS = 24;
const WARMUP = 200;
const MAX_TRADES = 200;
const MAX_LOG = 120;
const MAX_EQUITY_POINTS = 600;

export function emptyState(symbol, interval) {
  return {
    version: 1,
    symbol,
    interval,
    balance: START_BALANCE,
    position: null,
    trades: [],
    equity: [],
    log: [],
    lastTime: null,
    cycle: 0,
    startedAt: null,
    lastDecision: null
  };
}

function pushLog(state, time, kind, text) {
  state.log.push({ time, kind, text });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

const fmt = n => (Math.abs(n) >= 100 ? n.toFixed(2) : Math.abs(n) >= 1 ? n.toFixed(3) : n.toFixed(5));

function closePosition(state, candle, exitPrice, why) {
  const p = state.position;
  const risk = Math.abs(p.entry - p.initialStop);
  const move = (exitPrice - p.entry) * p.side;
  const r = risk > 0 ? move / risk : 0;
  const pnl = state.balance * RISK_PER_TRADE * r;
  state.balance += pnl;
  const trade = {
    side: p.side > 0 ? 'BUY' : 'SELL',
    entry: p.entry,
    exit: exitPrice,
    stop: p.initialStop,
    target: p.target,
    openedAt: p.openedAt,
    closedAt: candle.time,
    bars: p.bars,
    r: Number(r.toFixed(2)),
    pnl: Number(pnl.toFixed(2)),
    pnlPct: Number(((move / p.entry) * 100).toFixed(3)),
    outcome: r > 0.05 ? 'win' : r < -0.05 ? 'loss' : 'flat',
    exitReason: why,
    setup: p.setup
  };
  state.trades.push(trade);
  if (state.trades.length > MAX_TRADES) state.trades.splice(0, state.trades.length - MAX_TRADES);
  state.position = null;
  pushLog(state, candle.time, trade.outcome === 'win' ? 'win' : trade.outcome === 'loss' ? 'loss' : 'info',
    `FECHOU ${trade.side === 'BUY' ? 'COMPRA' : 'VENDA'} @ ${fmt(exitPrice)} · ${why} · ${trade.r >= 0 ? '+' : ''}${trade.r}R (${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)})`);
}

function manage(state, candle) {
  const p = state.position;
  p.bars += 1;
  const hitStop = p.side > 0 ? candle.low <= p.stop : candle.high >= p.stop;
  const hitTarget = p.side > 0 ? candle.high >= p.target : candle.low <= p.target;
  if (hitStop) return closePosition(state, candle, p.stop, p.stop === p.entry ? 'stop no zero' : 'stop');
  if (hitTarget) return closePosition(state, candle, p.target, 'alvo');
  if (p.bars >= MAX_BARS) return closePosition(state, candle, candle.close, 'tempo');
  // Move the stop to break-even once price has travelled 1R in our favour.
  const risk = Math.abs(p.entry - p.initialStop);
  const best = p.side > 0 ? candle.high - p.entry : p.entry - candle.low;
  if (p.stop !== p.entry && best >= risk) {
    p.stop = p.entry;
    pushLog(state, candle.time, 'info', 'Stop movido para o preço de entrada (+1R atingido).');
  }
}

/**
 * Advances the instructor over closed candles newer than state.lastTime.
 * `history` must be ascending and contain only closed candles.
 * `context` (live order flow / book / news) is applied only to a decision
 * on the newest candle, because it describes the market *now*.
 */
export function advance(state, history, { context = null } = {}) {
  const startIndex = state.lastTime == null
    ? WARMUP
    : history.findIndex(c => c.time > state.lastTime);
  if (startIndex < 0 || startIndex >= history.length) return state;
  if (state.startedAt == null) state.startedAt = history[Math.max(startIndex, 0)]?.time ?? null;

  for (let i = Math.max(startIndex, WARMUP); i < history.length; i++) {
    const candle = history[i];
    state.cycle += 1;
    if (state.position) manage(state, candle);

    const isNewest = i === history.length - 1;
    const snap = quantSnapshot(history.slice(0, i + 1));
    const decision = decide(snap, isNewest ? context : null);
    state.lastDecision = {
      time: candle.time,
      action: decision.action,
      confidence: decision.confidence,
      regime: snap?.regime ?? null,
      regimeLabel: regimeLabel(snap?.regime),
      reasons: decision.reasons
    };

    if (!state.position && decision.direction !== 0 && snap?.atr > 0) {
      const entry = candle.close;
      const stop = entry - decision.direction * STOP_ATR * snap.atr;
      const target = entry + decision.direction * TARGET_R * STOP_ATR * snap.atr;
      state.position = {
        side: decision.direction,
        entry,
        stop,
        initialStop: stop,
        target,
        openedAt: candle.time,
        bars: 0,
        setup: decision.setup,
        confidence: decision.confidence,
        reasons: decision.reasons
      };
      pushLog(state, candle.time, decision.direction > 0 ? 'buy' : 'sell',
        `${decision.direction > 0 ? 'COMPROU' : 'VENDEU'} @ ${fmt(entry)} · stop ${fmt(stop)} · alvo ${fmt(target)} · ${regimeLabel(snap.regime)} · confiança ${decision.confidence}%`);
    }

    state.equity.push({ time: candle.time, value: Number(state.balance.toFixed(2)) });
    if (state.equity.length > MAX_EQUITY_POINTS) state.equity.splice(0, state.equity.length - MAX_EQUITY_POINTS);
    state.lastTime = candle.time;
  }

  const scanned = history.length - Math.max(startIndex, WARMUP);
  if (scanned > 0) pushLog(state, state.lastTime, 'scan', `${scanned} vela(s) analisada(s) · regime ${state.lastDecision?.regimeLabel || '—'} · decisão ${state.lastDecision?.action || '—'}`);
  return state;
}

/** Aggregate statistics for display. */
export function summarize(state, livePrice = null) {
  const trades = state.trades;
  const wins = trades.filter(t => t.outcome === 'win').length;
  const losses = trades.filter(t => t.outcome === 'loss').length;
  let streak = 0;
  for (let i = trades.length - 1; i >= 0 && trades[i].outcome === 'win'; i--) streak++;
  const totalR = trades.reduce((s, t) => s + t.r, 0);
  const grossWin = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);

  let open = null;
  if (state.position) {
    const p = state.position;
    const price = Number.isFinite(livePrice) ? livePrice : p.entry;
    const risk = Math.abs(p.entry - p.initialStop);
    const r = risk > 0 ? ((price - p.entry) * p.side) / risk : 0;
    open = {
      side: p.side > 0 ? 'BUY' : 'SELL',
      entry: p.entry,
      stop: p.stop,
      target: p.target,
      openedAt: p.openedAt,
      bars: p.bars,
      confidence: p.confidence,
      reasons: p.reasons,
      setup: p.setup,
      livePrice: price,
      unrealizedR: Number(r.toFixed(2)),
      unrealizedPnl: Number((state.balance * RISK_PER_TRADE * r).toFixed(2)),
      unrealizedPct: Number((((price - p.entry) * p.side / p.entry) * 100).toFixed(3))
    };
  }

  return {
    startBalance: START_BALANCE,
    balance: Number(state.balance.toFixed(2)),
    pnl: Number((state.balance - START_BALANCE).toFixed(2)),
    pnlPct: Number((((state.balance - START_BALANCE) / START_BALANCE) * 100).toFixed(2)),
    trades: trades.length,
    wins,
    losses,
    winRate: trades.length ? Math.round((wins / trades.length) * 1000) / 10 : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    totalR: Number(totalR.toFixed(2)),
    streak,
    cycle: state.cycle,
    startedAt: state.startedAt,
    open
  };
}
