// Practical levels for someone watching their broker: where to wait for a better
// entry when the trend is clear but the price has run too far, and how to manage
// a trade already open on screen (where the stop goes, when to close).
// Pure functions on closed candles: same input, same answer.

const ema = (values, period) => {
  const k = 2 / (period + 1);
  let e = values[0];
  return values.map(v => (e = v * k + e * (1 - k)));
};

function atrOf(candles, period = 14) {
  const rows = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const prev = rows[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }
  return rows.length > 1 ? sum / (rows.length - 1) : 0;
}

/**
 * Trend and stretch of the last candles.
 * trend: 1 up, -1 down, 0 none (20/50 averages apart and the 20 still moving that way).
 * stretched: the price ran more than 1.5 ATR past the 20 average, or the last candle alone
 * moved 2 ATR in the trend's direction: entering now is chasing the price.
 * zone: where a pullback would offer a better entry (the 20 average).
 * stop: beyond the last swing on the other side of the zone.
 */
export function trendState(candles) {
  if (!Array.isArray(candles) || candles.length < 60) return null;
  const closes = candles.map(c => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const atr = atrOf(candles);
  if (!(atr > 0)) return null;
  const last = candles.at(-1);
  const fast = e20.at(-1);
  const slow = e50.at(-1);
  const slope = fast - e20.at(-11);
  let trend = 0;
  if (fast - slow > 0.3 * atr && slope > 0 && last.close > slow) trend = 1;
  else if (slow - fast > 0.3 * atr && slope < 0 && last.close < slow) trend = -1;
  const recent = candles.slice(-10);
  const swingHigh = Math.max(...recent.map(c => c.high));
  const swingLow = Math.min(...recent.map(c => c.low));
  const run = trend ? ((last.close - fast) * trend) / atr : 0;
  const lastMove = trend ? ((last.close - last.open) * trend) / atr : 0;
  const stretched = Boolean(trend) && (run > 1.5 || lastMove > 2);
  const zone = fast;
  const stop = trend > 0 ? Math.min(swingLow, zone - atr) - 0.2 * atr : trend < 0 ? Math.max(swingHigh, zone + atr) + 0.2 * atr : null;
  return { trend, stretched, atr, price: last.close, ema20: fast, ema50: slow, swingHigh, swingLow, zone, stop };
}

/**
 * Advice for a trade the person already has open.
 * position: { side: 1 buy | -1 sell, price: entry or null }; verdict: the reading's direction;
 * state: trendState() of the same market. `money` writes a price as the market shows it.
 * Returns { action: 'fechar' | 'proteger' | 'manter', stop, target, text } or null.
 */
export function manageOpen(position, state, verdictDirection, money) {
  if (!position?.side || !state) return null;
  const side = position.side;
  const { atr, price } = state;
  const entry = Number.isFinite(position.price) && Math.abs(position.price - price) < 60 * atr ? position.price : null;
  const word = side > 0 ? 'COMPRA' : 'VENDA';
  const opened = entry != null ? ` a ${money(entry)}` : '';
  // Structure stop: beyond the last swing against the trade, with a small buffer.
  const structureStop = side > 0 ? state.swingLow - 0.3 * atr : state.swingHigh + 0.3 * atr;
  const against = state.trend === -side;
  if (verdictDirection === -side || against) {
    return {
      action: 'fechar',
      stop: structureStop,
      target: null,
      text: `Tens uma ${word}${opened}, mas o mercado virou contra ti${state.trend === -side ? ` (o preço agora vem a ${side > 0 ? 'cair' : 'subir'})` : ''}. O mais seguro é fechar já. Se quiseres esperar, põe o stop em ${money(structureStop)}.`
    };
  }
  // The trade's risk: how far its stop sits on the losing side of the entry, never less
  // than a normal stop (1.5 average candles). When the last swing is already past the
  // entry, the trade is in profit and the swing can hold the stop.
  const lossSide = entry != null && (entry - structureStop) * side > 0;
  const risk = Math.max(1.5 * atr, lossSide ? Math.abs(entry - structureStop) : 0);
  const gained = entry != null ? (price - entry) * side : 0;
  if (entry != null && gained >= 0.8 * risk) {
    // In profit by about one stop's distance: protect it.
    const target = entry + side * 2 * risk;
    if ((price - target) * side >= 0) {
      return {
        action: 'fechar',
        stop: entry,
        target: null,
        text: `A tua ${word}${opened} já chegou ao alvo (${money(target)}). Bom momento para fechar e guardar o lucro.`
      };
    }
    if (!lossSide) {
      return {
        action: 'proteger',
        stop: structureStop,
        target,
        text: `A tua ${word}${opened} já está a ganhar bem. Muda o stop para ${money(structureStop)}: assim, mesmo que o preço volte, já sais com lucro. Podes tirar o lucro em ${money(target)}.`
      };
    }
    return {
      action: 'proteger',
      stop: entry,
      target,
      text: `A tua ${word}${opened} já está a ganhar. Muda o stop para ${money(entry)}, o preço a que entraste: assim, aconteça o que acontecer, já não perdes. Podes tirar o lucro em ${money(target)}.`
    };
  }
  const target = (entry ?? price) + side * 2 * risk;
  return {
    action: 'manter',
    stop: structureStop,
    target,
    text: `A tua ${word}${opened}: põe o stop em ${money(structureStop)} (${side > 0 ? 'logo abaixo do ponto mais baixo recente' : 'logo acima do ponto mais alto recente'}) e tira o lucro em ${money(target)}. Se o preço chegar ao stop, a operação fecha sozinha com uma perda pequena.`
  };
}

/**
 * One or two sentences for the bubble when there is a trend but entering now is late,
 * or null. side is the direction of the trend the person would trade.
 */
export function pullbackAdvice(state, money) {
  if (!state?.trend || !state.stretched) return null;
  const down = state.trend < 0;
  return {
    side: state.trend,
    zone: state.zone,
    stop: state.stop,
    text: `O preço vem a ${down ? 'cair' : 'subir'}, mas já ${down ? 'caiu' : 'subiu'} muito de uma vez: entrar agora é chegar atrasado. Espera que ${down ? 'volte a subir um pouco' : 'volte a descer um pouco'}, até perto de ${money(state.zone)}, e aí ${down ? 'vende' : 'compra'}. Põe o stop (onde sais se correr mal) ${down ? 'acima' : 'abaixo'} de ${money(state.stop)}.`
  };
}
