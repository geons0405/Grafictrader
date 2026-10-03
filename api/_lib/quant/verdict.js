// Merges the vision model's chart reading with the live statistical engine
// into one orientation for the user: COMPRAR, VENDER or AGUARDAR.

const ASSET_ALIASES = [
  ['BTCUSDT', ['BTC', 'XBT', 'BITCOIN']],
  ['ETHUSDT', ['ETH', 'ETHEREUM']],
  ['SOLUSDT', ['SOL', 'SOLANA']],
  ['BNBUSDT', ['BNB']],
  ['XRPUSDT', ['XRP', 'RIPPLE']],
  ['ADAUSDT', ['ADA', 'CARDANO']],
  ['DOGEUSDT', ['DOGE', 'DOGECOIN']]
];

/** Maps text like "BTC/USDT", "ETHUSD" or "Bitcoin" to a supported Binance symbol. */
export function mapAsset(text) {
  if (!text) return null;
  const tokens = String(text).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ');
  for (const [symbol, names] of ASSET_ALIASES) {
    if (tokens.some(token => names.some(name => token === name || token.startsWith(name + 'USD') || token.startsWith(name + 'PERP')))) {
      return symbol;
    }
  }
  return null;
}

export function mapTimeframe(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/\s+/g, '');
  let m;
  let key = null;
  if ((m = t.match(/^m(\d+)$/)) || (m = t.match(/^(\d+)(m|min|mins|minuto|minutos)$/))) key = m[1] + 'm';
  else if ((m = t.match(/^h(\d+)$/)) || (m = t.match(/^(\d+)(h|hr|hora|horas)$/))) key = m[1] + 'h';
  return ['1m', '5m', '15m', '1h', '4h'].includes(key) ? key : null;
}

const VISION_ACTIONS = { COMPRAR: 1, COMPRA: 1, BUY: 1, VENDER: -1, VENDA: -1, SELL: -1 };

export function normalizeVision(raw = {}) {
  const action = String(raw.decisao || raw.decision || '').toUpperCase().trim();
  const direction = VISION_ACTIONS[action] ?? 0;
  const confidence = Math.max(0, Math.min(100, Number(raw.confianca ?? raw.confidence) || 0));
  const list = v => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 5) : v ? [String(v)] : []);
  return {
    asset: raw.ativo ? String(raw.ativo).slice(0, 30) : null,
    timeframe: raw.timeframe ? String(raw.timeframe).slice(0, 12) : null,
    trend: raw.tendencia ? String(raw.tendencia) : 'indefinida',
    direction,
    confidence,
    price: Number.isFinite(Number(raw.precoAtual)) ? Number(raw.precoAtual) : null,
    entry: raw.entrada ? String(raw.entrada).slice(0, 120) : null,
    stop: raw.stop ? String(raw.stop).slice(0, 120) : null,
    targets: list(raw.alvos),
    structure: raw.estrutura ? String(raw.estrutura).slice(0, 300) : null,
    patterns: list(raw.padroes),
    indicators: raw.indicadores ? String(raw.indicadores).slice(0, 300) : null,
    reasons: list(raw.motivos),
    risks: list(raw.riscos),
    summary: raw.resumo ? String(raw.resumo).slice(0, 300) : null,
    plain: raw.explicacaoSimples ? String(raw.explicacaoSimples).slice(0, 900) : null,
    imageQuality: raw.qualidadeImagem ? String(raw.qualidadeImagem) : null
  };
}

/**
 * vision: normalizeVision() output. reading: marketReading() output or null.
 * Returns { decision, direction, confidence, agreement, headline, reasons }.
 */
export function mergeVerdict(vision, reading) {
  const reasons = [];
  let direction = vision.direction;
  let confidence = vision.confidence;
  let agreement = 'sem dados ao vivo';

  if (vision.direction === 0 || vision.confidence < 45) {
    direction = 0;
    reasons.push(vision.direction === 0 ? 'A leitura visual não encontra uma entrada clara.' : 'A leitura visual tem confiança baixa.');
  }

  if (reading?.signal) {
    const q = reading.signal.direction;
    const ctx = reading.context?.score ?? 0;
    if (direction !== 0 && q === direction) {
      agreement = 'confirma';
      confidence = Math.min(95, Math.round((confidence + reading.signal.confidence) / 2 + 10));
      reasons.push(`O motor estatístico ao vivo confirma (${reading.signal.regimeLabel.toLowerCase()}).`);
    } else if (direction !== 0 && q === -direction) {
      agreement = 'diverge';
      reasons.push('O motor estatístico ao vivo aponta o sentido contrário: sinais divergentes.');
      direction = 0;
    } else if (direction !== 0) {
      agreement = 'neutro';
      confidence = Math.max(0, confidence - 10);
      reasons.push(`O motor ao vivo não tem sinal próprio agora (${reading.signal.regimeLabel.toLowerCase()}).`);
      if (ctx * direction < -0.35) {
        reasons.push('Fluxo, livro de ordens e notícias estão contra esta direção.');
        direction = 0;
      }
    } else {
      agreement = q === 0 ? 'neutro' : 'diverge';
    }
    if (reading.snapshot?.regime === 'chaotic') {
      reasons.push('Volatilidade extrema neste momento.');
      direction = 0;
    }
  }

  if (direction !== 0 && confidence < 50) {
    reasons.push('Confiança final abaixo de 50%.');
    direction = 0;
  }

  const decision = direction > 0 ? 'COMPRAR' : direction < 0 ? 'VENDER' : 'AGUARDAR';
  const headline = direction > 0
    ? 'Viés de compra: o gráfico tende a subir'
    : direction < 0
      ? 'Viés de venda: o gráfico tende a descer'
      : 'Mercado instável: melhor aguardar';
  return { decision, direction, confidence: direction === 0 ? Math.min(confidence, 40) : confidence, agreement, headline, reasons };
}
