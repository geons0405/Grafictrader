import { rulesBlock } from '../ai-rules.js';
import { runText, parseJson } from '../vision.js';

// The judge: an AI model reads every analyst's numbers and reasons and gives
// the final verdict in plain Portuguese. Hard rules stay in code: a veto always
// means AGUARDAR, and the judge cannot flip a strong consensus to the other side.

const DECISIONS = ['COMPRAR', 'VENDER', 'AGUARDAR'];

export function judgePrompt({ symbol, interval, price, analysts, consensus, engine = null }) {
  const compact = analysts.map(a => ({ analista: a.name, pontuacao: a.score, confianca: a.confidence, inclina: a.lean, motivos: a.reasons }));
  const structure = engine ? `
Motor de inteligência (8 camadas quantitativas): regime ${engine.regime.code} (${engine.regime.label}); viés estrutural ${engine.fusion.structuralBias}; probabilidade de subir ${Math.round(engine.fusion.probabilityUp * 100)}%; movimento esperado ${engine.fusion.expectedMove ? engine.fusion.expectedMove.centerPct + '% ± ' + engine.fusion.expectedMove.rangePct + '%' : '—'}.
Alerta antecipado: ${engine.earlyWarning.state} (${Math.round(engine.earlyWarning.probability * 100)}%, direção ${engine.earlyWarning.direction}).
Intenção do último movimento: ${(engine.intent.shares || []).slice(0, 3).map(x => x.pct + '% ' + x.name).join('; ')}. ${(engine.intent.risks || []).join(' ')}` : '';
  return `És o juiz final do Grafictrader, uma mesa de análise de trading.
Ativo ${symbol}, tempo gráfico ${interval}, preço ${price}.${structure}
Oito analistas independentes calcularam o mercado. Pontuação de -1 (vender) a +1 (comprar); confiança de 0 a 1.
${JSON.stringify(compact)}
Consenso numérico: pontuação ${consensus.score}, concordância ${Math.round(consensus.agreement * 100)}%, sugestão do motor ${consensus.decision}.
Vetos ativos: ${consensus.vetoes.length ? consensus.vetoes.join(' | ') : 'nenhum'}.
Regras:
- Com qualquer veto, a decisão é AGUARDAR.
- Se os analistas mais confiantes discordam entre si, prefere AGUARDAR.
- Só COMPRAR ou VENDER quando a maioria dos analistas confiantes aponta no mesmo sentido.
- Não inventes dados que não estão acima. Não prometas lucro.
${rulesBlock()}
Responde APENAS com JSON:
{"decisao": "COMPRAR" | "VENDER" | "AGUARDAR", "confianca": 0-100, "resumo": "uma frase simples", "porque": ["até 3 razões em linguagem simples"], "riscos": ["até 2 riscos"], "decisivos": ["nomes dos analistas que mais pesaram"]}`;
}

/** Makes the judge's answer safe and consistent with the numbers. */
export function settleVerdict(raw, consensus) {
  const decision = DECISIONS.includes(raw?.decisao) ? raw.decisao : consensus.decision;
  let final = decision;
  const notes = [];
  if (consensus.vetoes.length && final !== 'AGUARDAR') {
    final = 'AGUARDAR';
    notes.push('Veto de risco aplicado.');
  }
  // The judge may be more careful than the numbers, never the opposite side of a strong consensus.
  if (final !== 'AGUARDAR' && Math.abs(consensus.score) >= 0.25 && Math.sign(consensus.score) !== (final === 'COMPRAR' ? 1 : -1)) {
    final = 'AGUARDAR';
    notes.push('O juiz contrariou um consenso forte: decisão suspensa.');
  }
  const confidence = final === 'AGUARDAR' ? 0 : Math.max(0, Math.min(100, Math.round(Number(raw?.confianca) || consensus.confidence)));
  const list = v => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 3) : []);
  return {
    decision: final,
    confidence,
    summary: String(raw?.resumo || '').slice(0, 300),
    why: list(raw?.porque),
    risks: list(raw?.riscos).slice(0, 2),
    decisive: list(raw?.decisivos),
    notes
  };
}

/** Asks the judge chain; falls back to the numeric consensus if no AI answers. */
export async function judge(input) {
  try {
    const answer = await runText(judgePrompt(input), { json: true, maxTokens: 1200, temperature: 0.1 });
    return { ...settleVerdict(parseJson(answer.text), input.consensus), judge: answer.provider };
  } catch (error) {
    const c = input.consensus;
    return {
      decision: c.decision,
      confidence: c.confidence,
      summary: c.decision === 'AGUARDAR' ? 'Os analistas não concordam o suficiente para entrar agora.' : `A maioria dos analistas aponta para ${c.decision.toLowerCase()}.`,
      why: [],
      risks: [],
      decisive: [],
      notes: [error?.setupRequired ? 'Sem IA configurada: veredito calculado pelo consenso.' : 'IA indisponível agora: veredito calculado pelo consenso.'],
      judge: 'Consenso numérico'
    };
  }
}
