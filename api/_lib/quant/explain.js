// Plain-language guidance for people who have never traded.
// Turns the engine's numbers into "what to do now and why", in informal
// Angolan Portuguese. Pure function: same input, same text.

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, digits), maximumFractionDigits: digits });
}

const pct = v => Math.round(Math.abs(v) * 100) + '%';

function timeTo(minutes) {
  if (minutes == null) return '';
  if (minutes < 60) return `daqui a ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `daqui a ${h}h${String(minutes % 60).padStart(2, '0')}`;
}

function whyTrend(dir, snap, ctx) {
  const up = dir > 0;
  const lines = [
    up
      ? 'O preço está a subir de forma organizada, não é só um pulo. Os nossos cálculos mostram que esta subida tem "memória": quando o mercado está assim, a tendência costuma continuar mais um bocado.'
      : 'O preço está a descer de forma organizada, não é só uma queda isolada. Os cálculos mostram que esta descida tem "memória": quando o mercado está assim, a tendência costuma continuar mais um bocado.'
  ];
  if (Number.isFinite(snap?.flowImbalance)) {
    lines.push(up
      ? `Há mais dinheiro a comprar do que a vender: cerca de ${pct(snap.flowImbalance)} a mais do volume recente foi de compra.`
      : `Há mais dinheiro a vender do que a comprar: cerca de ${pct(snap.flowImbalance)} a mais do volume recente foi de venda.`);
  }
  if (Number.isFinite(snap?.vwap)) {
    lines.push(up
      ? 'O preço está acima do "preço médio do dia" (VWAP), sinal de que os compradores estão no controlo.'
      : 'O preço está abaixo do "preço médio do dia" (VWAP), sinal de que os vendedores estão no controlo.');
  }
  addContext(lines, dir, ctx);
  return lines;
}

function whyReversion(dir, snap, ctx) {
  const up = dir > 0;
  const lines = [
    up
      ? `O preço caiu demais e depressa: está ${Math.abs(snap?.vwapZ ?? 2).toFixed(1)} vezes mais longe do preço médio do que é normal. Neste tipo de mercado, quando estica assim, costuma voltar para o meio, como um elástico.`
      : `O preço subiu demais e depressa: está ${Math.abs(snap?.vwapZ ?? 2).toFixed(1)} vezes mais longe do preço médio do que é normal. Neste tipo de mercado, quando estica assim, costuma voltar para o meio, como um elástico.`,
    up
      ? 'E os vendedores já estão a perder força: nas últimas velas começou a entrar mais compra.'
      : 'E os compradores já estão a perder força: nas últimas velas começou a entrar mais venda.'
  ];
  addContext(lines, dir, ctx);
  return lines;
}

function addContext(lines, dir, ctx) {
  if (!ctx) return;
  if (Number.isFinite(ctx.score) && Math.abs(ctx.score) > 0.2) {
    lines.push(ctx.score * dir > 0
      ? 'O que está a acontecer agora (ordens a entrar, livro de ordens e notícias) também puxa para o mesmo lado.'
      : 'Atenção: o que está a acontecer agora (ordens, livro e notícias) puxa um pouco para o lado contrário. Usa sempre o stop.');
  }
  if (ctx.global && Math.abs(ctx.global.score) > 0.15) {
    lines.push(ctx.global.score > 0
      ? 'Lá fora, os mercados mundiais estão animados (bolsas a subir, medo baixo). Isso costuma ajudar as subidas.'
      : 'Lá fora, os mercados mundiais estão nervosos (bolsas a cair ou dólar forte). Isso costuma pesar nas subidas.');
  }
}

/** Describes what the chart really shows when the statistics find no edge. */
function whyNoise(snap) {
  const lines = [];
  const z = snap?.kalmanZ;
  const move = snap?.movePct;
  if (Number.isFinite(z) && Math.abs(z) >= 2 && Number.isFinite(move) && Math.abs(move) >= 0.15) {
    lines.push(z > 0
      ? `O preço vem a subir com força (${move >= 0 ? '+' : ''}${move.toFixed(2)}% nas últimas 60 velas), por isso o gráfico parece ter direção.`
      : `O preço vem a descer com força (${move.toFixed(2)}% nas últimas 60 velas), por isso o gráfico parece ter direção.`);
  }
  if (Number.isFinite(snap?.rangeHigh) && Number.isFinite(snap?.rangeLow) && snap.rangeHigh > snap.rangeLow) {
    lines.push(`Mas nas últimas 20 velas anda aos saltos entre ${money(snap.rangeLow)} e ${money(snap.rangeHigh)}, com velas grandes para os dois lados.`);
  }
  lines.push(lines.length
    ? 'Os cálculos não encontram "memória" neste movimento: subidas e descidas assim desfazem-se tão depressa como aparecem, e quem entra no meio é apanhado num desses saltos.'
    : 'O preço está aos saltos, sem uma direção clara. Os cálculos não encontram vantagem em entrar agora.');
  return lines;
}

function whyWait(snap, ctx, decision) {
  const lines = [];
  const risk = ctx?.eventRisk;
  if (risk?.blocked && risk.event) {
    lines.push(`Está a sair (ou vai sair agora) uma notícia muito importante: "${risk.event.title}" (${risk.event.currency}). Nestas alturas o preço salta para todos os lados em segundos e o stop pode nem funcionar ao preço certo.`);
    lines.push('Deixa a notícia sair e o mercado acalmar. Volta cerca de 30 minutos depois.');
    return lines;
  }
  switch (snap?.regime) {
    case 'chaotic':
      lines.push('O mercado está muito agitado agora: as velas estão bem maiores do que o normal. Entrar assim é arriscar muito para nada.');
      break;
    case 'noise':
      lines.push(...whyNoise(snap));
      break;
    case 'trend':
      lines.push('Existe tendência, mas os sinais ainda não estão todos alinhados (força do movimento, volume e preço médio). Melhor esperar confirmação do que entrar cedo demais.');
      break;
    case 'reversion':
      lines.push('O mercado anda de um lado para o outro, mas o preço ainda não esticou o suficiente para valer a pena apostar no regresso.');
      break;
    default:
      lines.push('Ainda não há informação suficiente para uma decisão segura.');
  }
  if ((decision?.reasons || []).some(r => /Contexto ao vivo contra/.test(r))) {
    lines.push('O gráfico até dava sinal, mas o dinheiro a entrar agora vai no sentido contrário. Quando o gráfico e o fluxo discordam, a IA prefere não arriscar.');
  }
  if (risk?.next && risk.minutesToNext != null && risk.minutesToNext < 180) {
    lines.push(`Fica atento: há uma notícia forte ${timeTo(risk.minutesToNext)}: "${risk.next.title}" (${risk.next.currency}).`);
  }
  return lines;
}

/**
 * @param {object} p
 * @param {object} p.decision  decide() output
 * @param {object} p.snapshot  quantSnapshot() output
 * @param {object} p.context   live context (may include eventRisk and global)
 * @param {object} p.plan      { side: 1|-1, entry, stop, target, open: bool, livePrice, unrealizedR }
 */
export function explainPlain({ decision, snapshot, context, plan }) {
  const dir = plan ? plan.side : decision?.direction || 0;
  const label = dir > 0 ? 'COMPRAR' : dir < 0 ? 'VENDER' : 'NÃO OPERAR';
  const tone = dir > 0 ? 'up' : dir < 0 ? 'down' : 'wait';

  if (!dir) {
    // In a choppy market, say where the box is so the person knows what to wait for.
    const box = !context?.eventRisk?.blocked && snapshot?.regime === 'noise'
      && Number.isFinite(snapshot?.rangeHigh) && Number.isFinite(snapshot?.rangeLow) && snapshot.rangeHigh > snapshot.rangeLow;
    return {
      action: label,
      tone,
      headline: context?.eventRisk?.blocked ? 'Não operes agora: notícia forte a sair' : box ? 'Preço aos saltos: espera que saia da zona' : 'Agora não é hora de entrar',
      why: whyWait(snapshot, context, decision),
      steps: [
        'Não abras nenhuma operação neste momento.',
        box ? `Fica atento aos limites: ${money(snapshot.rangeHigh)} em cima e ${money(snapshot.rangeLow)} em baixo. Só um fecho fora desta zona mostra uma direção, e mesmo aí espera pela confirmação da IA aqui.` : null,
        'Se já tens uma operação aberta, mantém o teu stop loss e não o afastes.',
        'A IA continua a analisar vela a vela; quando houver uma entrada boa, aparece aqui.'
      ].filter(Boolean),
      now: box
        ? `Fica de fora enquanto o preço andar entre ${money(snapshot.rangeLow)} e ${money(snapshot.rangeHigh)}.`
        : 'Fica de fora e espera pelo próximo sinal.'
    };
  }

  const up = dir > 0;
  const setup = plan?.setup || decision?.setup;
  const why = setup === 'reversion' ? whyReversion(dir, snapshot, context) : whyTrend(dir, snapshot, context);
  const risk = Math.abs(plan.entry - (plan.initialStop ?? plan.stop));
  const breakEven = plan.entry + dir * risk;
  const steps = [
    `${up ? 'Compra' : 'Vende'} perto de ${money(plan.entry)}.`,
    `Põe o stop loss em ${money(plan.initialStop ?? plan.stop)}. Se o preço ${up ? 'cair' : 'subir'} até aí, a operação fecha sozinha com uma perda pequena e controlada.`,
    `Põe o take profit (alvo) em ${money(plan.target)}. Aí ganhas o dobro do que arriscaste.`,
    `Quando o preço chegar a ${money(breakEven)}, move o stop para ${money(plan.entry)} (o preço de entrada). A partir daí já não perdes dinheiro.`,
    'Usa um tamanho pequeno: o ideal é arriscar no máximo 1% da tua conta por operação.'
  ];

  let now;
  if (plan.open) {
    const late = Number.isFinite(plan.livePrice) && risk > 0 && ((plan.livePrice - plan.entry) * dir) / risk > 0.35;
    now = late
      ? `A IA já entrou em ${money(plan.entry)} e o preço já andou a favor. Se ainda não entraste, não persigas o preço: espera um recuo para perto de ${money(plan.entry)} ou a próxima oportunidade.`
      : `A IA já está ${up ? 'comprada' : 'vendida'} desde ${money(plan.entry)}. O preço ainda está perto da entrada, por isso ainda dá para entrar com os mesmos stop e alvo.`;
  } else {
    now = `Sinal fresco: a IA vê uma boa oportunidade para ${up ? 'comprar' : 'vender'} agora.`;
  }

  return {
    action: label,
    tone,
    headline: up ? 'Aproveita para comprar: o mercado quer subir' : 'Aproveita para vender: o mercado quer descer',
    why,
    steps,
    now
  };
}

/** Trading plan the guidance talks about: the open position or a fresh signal. */
export function buildPlan(summary, signal, snapshot, price) {
  const open = summary?.open;
  if (open) {
    return { side: open.side === 'BUY' ? 1 : -1, entry: open.entry, stop: open.stop, initialStop: open.initialStop, target: open.target, open: true, livePrice: price, setup: open.setup };
  }
  if (signal?.direction && snapshot?.atr > 0) {
    const stop = price - signal.direction * 1.5 * snapshot.atr;
    return { side: signal.direction, entry: price, stop, initialStop: stop, target: price + signal.direction * 3 * snapshot.atr, open: false, livePrice: price, setup: signal.setup };
  }
  return null;
}

/**
 * Guidance for the photo analysis. Uses the live engine's plan when the
 * chart is a market we track; otherwise falls back to the vision model's
 * own informal explanation and levels.
 */
export function photoGuidance(verdict, vision, reading) {
  if (reading?.snapshot) {
    const decision = { direction: verdict.direction, setup: reading.signal?.setup, reasons: reading.signal?.reasons || [] };
    const plan = verdict.direction ? buildPlan(null, { direction: verdict.direction, setup: reading.signal?.setup || 'trend' }, reading.snapshot, reading.price) : null;
    const guidance = explainPlain({ decision, snapshot: reading.snapshot, context: reading.context, plan });
    if (plan) guidance.levels = { entry: money(plan.entry), stop: money(plan.initialStop ?? plan.stop), target: money(plan.target) };
    if (verdict.direction === 0 && verdict.agreement === 'diverge') {
      guidance.why.unshift('A foto e o mercado ao vivo não concordam: o gráfico da imagem sugere um lado, mas os dados em tempo real apontam para o outro. Quando há esta dúvida, o mais inteligente é não arriscar.');
    }
    if (vision.plain) guidance.why.push('Sobre a imagem: ' + vision.plain);
    return guidance;
  }
  const dir = verdict.direction;
  return {
    action: dir > 0 ? 'COMPRAR' : dir < 0 ? 'VENDER' : 'NÃO OPERAR',
    tone: dir > 0 ? 'up' : dir < 0 ? 'down' : 'wait',
    headline: verdict.headline,
    why: [vision.plain || vision.summary || 'A IA analisou o que é visível na imagem.', ...verdict.reasons].filter(Boolean),
    steps: dir
      ? [
          vision.entry ? `Entrada: ${vision.entry}.` : 'Entra só depois de confirmares o movimento no teu gráfico.',
          vision.stop ? `Stop loss: ${vision.stop}. É o ponto onde sais com uma perda pequena se a ideia falhar.` : 'Define sempre um stop loss antes de entrar.',
          vision.targets.length ? `Alvos para tirar lucro: ${vision.targets.join(', ')}.` : 'Define o alvo antes de entrar.',
          'Arrisca no máximo 1% da tua conta nesta operação.'
        ]
      : ['Não abras operação agora.', 'Tira outra foto daqui a umas velas ou quando o gráfico mostrar uma direção clara.'],
    now: dir ? 'Segue os passos acima e respeita o stop.' : 'Fica de fora por agora.'
  };
}
