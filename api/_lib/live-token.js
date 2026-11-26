export const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';

export function resolveLiveModel(value) {
  const model = String(value || DEFAULT_LIVE_MODEL).trim().replace(/^models\//, '');
  return /^[a-z0-9][a-z0-9._-]{2,100}$/i.test(model) ? model : DEFAULT_LIVE_MODEL;
}

export function buildLiveTokenRequest(model = DEFAULT_LIVE_MODEL, now = Date.now()) {
  const safeModel = resolveLiveModel(model);
  return {
    uses: 1,
    expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
    newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    liveConnectConstraints: {
      model: `models/${safeModel}`,
      config: {
        responseModalities: ['AUDIO'],
        sessionResumption: {}
      }
    }
  };
}

export function buildLiveSystemInstruction(market = null) {
  const marketContext = market
    ? `\n\nCONTEXTO DO MOTOR GRAFICTRADER (instantâneo obtido ao iniciar/reiniciar a sessão; pode ficar desatualizado):\n${JSON.stringify(market).slice(0, 7000)}\nTrata estes valores como dados do motor, nunca os alteres. Se o utilizador pedir cotação atualizada, explica que precisas de atualizar a análise; não finjas que o instantâneo é tempo real.`
    : '\n\nNão foi possível obter um instantâneo do mercado no início da sessão. Não inventes preços, indicadores nem sinais.';
  return `És o GraficTrader Live, um assistente de voz natural e profissional, especializado em explicar mercados e a utilização do GraficTrader. Fala sempre em português claro, de preferência português europeu, com respostas curtas e naturais que soem bem em voz alta. Escuta até o utilizador terminar; não interrompas frases com pausas normais. Responde à pergunta concreta e mantém o contexto desta sessão.

Usa os dados do motor GraficTrader como única fonte para decisões e métricas de mercado. Distingue claramente dados confirmados de explicações gerais. Nunca inventes cotações, indicadores, notícias, resultados ou decisões. Só podes mencionar COMPRA ou VENDA se os dados fornecidos pelo motor mostrarem explicitamente essa decisão; caso contrário, diz AGUARDAR / NÃO OPERAR. Nunca prometas lucros nem percentagens de acerto, não dês aconselhamento financeiro personalizado e não executes ordens. Se não tiveres dados suficientes ou recentes, diz isso com clareza. Não afirmes que monitorizas o mercado em segundo plano. Nunca peças nem reveles palavras-passe, chaves API ou credenciais da corretora.\n${marketContext}`;
}
