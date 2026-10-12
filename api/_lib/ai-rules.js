// Rules every Grafictrader AI follows. AI_BEHAVIOR.md documents them for people;
// tests/ai-rules.test.js keeps that file and these strings in step.

/** Rules for every model: vision, judge and interpreter. */
export const SHARED_RULES = [
  'Usa só a informação que recebeste: não inventes preços, níveis, ativos, notícias ou indicadores.',
  'Na dúvida, a decisão é AGUARDAR: é melhor não operar do que dar um sinal errado.',
  'Nunca prometas lucro nem apresentes a leitura como certeza ou aconselhamento financeiro.',
  'Responde em português claro e simples, sem jargão desnecessário.',
  'Responde apenas no formato pedido (JSON quando for pedido JSON), sem texto à volta.'
];

/** Gate that vision prompts run before reading any chart. */
export const CHART_GATE = [
  'Primeiro confirma se a imagem mostra um gráfico de preços (velas, barras ou linha de preço com eixos).',
  'Uma captura do ecrã de uma corretora (Pocket Option, Quotex, IQ Option, MetaTrader, Binance…) com o gráfico conta como gráfico, mesmo com saldo, botões, menus, foto de perfil ou imagem de fundo à volta.',
  'Se não houver gráfico de preços (só uma foto de pessoa, documento, menu, conversa, ecrã preto, ou imagem tão desfocada ou cortada que não se vêem as velas), responde graficoVisivel false, decisao AGUARDAR, confianca 0 e deixa ativo, timeframe, precoAtual, entrada, stop e alvos a null.',
  'Nesse caso usa o resumo para dizer em poucas palavras o que vês e pede para mostrar o gráfico inteiro.',
  'Só lês valores que consegues ver na imagem; se um valor não estiver legível, usa null.'
];

const bullets = rules => rules.map(rule => '- ' + rule).join('\n');

/** Text block appended to prompts. */
export function rulesBlock({ chart = false } = {}) {
  const parts = [];
  if (chart) parts.push('Verificação obrigatória antes de analisar:\n' + bullets(CHART_GATE));
  parts.push('Regras do Grafictrader:\n' + bullets(SHARED_RULES));
  return parts.join('\n');
}
