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

// Quotes that are not the US dollar: a pair like ETH/BTC or BTC/BRL is a
// different market from ETHUSDT/BTCUSDT and its prices must not be mixed in.
const OTHER_QUOTES = new Set(['BTC', 'XBT', 'BITCOIN', 'ETH', 'ETHEREUM', 'BNB', 'SOL', 'EUR', 'EURO', 'BRL', 'REAL', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF',
  'TRY', 'RUB', 'INR', 'AOA', 'ZAR', 'NGN', 'MXN', 'ARS', 'IDR', 'KRW', 'CNY', 'UAH', 'PLN']);

// Real forex pairs and gold, read from Yahoo Finance (see sources/yahoo.js).
const FOREX = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURJPY', 'GBPJPY', 'EURGBP']);
const GOLD = new Set(['XAU', 'XAUUSD', 'GOLD', 'OURO']);

function mapForex(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const one = tokens[i];
    const two = one.length === 3 ? one + (tokens[i + 1] || '') : null;
    if (FOREX.has(one)) return one;
    if (two && FOREX.has(two)) return two;
    // Gold only against the dollar (or with no quote written).
    if (GOLD.has(one) && (!tokens[i + 1] || tokens[i + 1] === 'USD' || one === 'XAUUSD')) return 'XAUUSD';
  }
  return null;
}

/** Maps text like "BTC/USDT", "ETHUSD" or "Bitcoin" to a supported Binance symbol; null for non-dollar pairs. */
export function mapAsset(text) {
  if (!text) return null;
  const tokens = String(text).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ');
  // Broker OTC prices (binary options at weekends, "Bitcoin OTC") are the broker's own
  // synthetic feed: the real market says nothing about them.
  if (tokens.includes('OTC') || tokens.some(t => t.endsWith('OTC'))) return null;
  const forex = mapForex(tokens);
  if (forex) return forex;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    for (const [symbol, names] of ASSET_ALIASES) {
      const name = names.find(n => token === n) || names.filter(n => token.startsWith(n)).sort((a, b) => b.length - a.length)[0];
      if (!name) continue;
      const rest = token.slice(name.length);
      if (rest && !rest.startsWith('USD') && !rest.startsWith('PERP')) {
        if (OTHER_QUOTES.has(rest)) return null; // ETHBTC, BTCEUR…
        continue; // a longer word that only starts like the name
      }
      if (!rest && OTHER_QUOTES.has(tokens[i + 1])) return null; // "ETH / BTC", "Bitcoin / Euro"
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

const presentText = v => typeof v === 'string' && v.trim() !== '' && !['null', 'nenhum', 'nenhuma', 'n/a'].includes(v.trim().toLowerCase());

/** The trade already open on screen, as the model read it: { side: 1 | -1, price } or null. */
function readPosition(p) {
  if (!p || typeof p !== 'object') return null;
  const word = String(p.lado || p.side || '').toUpperCase();
  const side = /COMPRA|BUY|CALL|ACIMA/.test(word) ? 1 : /VENDA|SELL|PUT|ABAIXO/.test(word) ? -1 : 0;
  if (!side) return null;
  const price = Number(p.preco ?? p.price);
  return { side, price: Number.isFinite(price) && price > 0 ? price : null };
}

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
    position: readPosition(raw.posicaoAberta),
    waitFor: presentText(raw.esperarPor) ? String(raw.esperarPor).slice(0, 160) : null,
    manage: presentText(raw.gestaoPosicao) ? String(raw.gestaoPosicao).slice(0, 240) : null,
    imageQuality: typeof raw.qualidadeImagem === 'string' && raw.qualidadeImagem.trim() ? raw.qualidadeImagem.trim().toLowerCase() : null
  };
}

const TRENDS = ['alta', 'baixa', 'lateral'];

/**
 * Whether the model really read a price chart. The model's own flag is not
 * enough: it must also have read at least two chart details (trend, price,
 * asset, timeframe, structure, patterns or indicators), so a photo of anything
 * else never turns into a trade.
 */
export function isChartVisible(raw = {}) {
  // Model output is untrusted: normalise the flag and count only readable scalar values.
  const flag = typeof raw.graficoVisivel === 'string' ? raw.graficoVisivel.trim().toLowerCase() : raw.graficoVisivel;
  if (flag === false || flag === 0 || ['false', 'não', 'nao', 'no', '0'].includes(flag)) return false;
  const present = v => (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null';
  const evidence = [
    TRENDS.includes(String(typeof raw.tendencia === 'string' ? raw.tendencia : '').trim().toLowerCase()),
    present(raw.precoAtual) && Number.isFinite(Number(raw.precoAtual)),
    present(raw.ativo),
    present(raw.timeframe),
    present(raw.estrutura),
    Array.isArray(raw.padroes) && raw.padroes.some(present),
    present(raw.indicadores)
  ].filter(Boolean).length;
  return evidence >= 2;
}

/** A blurry or cut chart is read but never traded on. Mutates and returns the reading. */
export function guardImageQuality(vision) {
  if (vision.imageQuality === 'fraca') {
    vision.direction = 0;
    vision.confidence = Math.min(vision.confidence, 30);
  }
  return vision;
}

/** Neutral reading for an image that is not a chart: no side, no levels, no asset. */
export function noChartVision(raw = {}) {
  const base = normalizeVision({ resumo: raw.resumo, qualidadeImagem: raw.qualidadeImagem });
  return { ...base, direction: 0, confidence: 0, trend: 'indefinida' };
}

/** Verdict shown when the image is not a chart. */
export function noChartVerdict() {
  return {
    decision: 'AGUARDAR',
    direction: 0,
    confidence: 0,
    agreement: 'sem dados ao vivo',
    headline: 'Isto não parece um gráfico de preços',
    reasons: ['A IA não encontrou um gráfico na imagem, por isso não dá nenhuma orientação de compra ou venda.']
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
    reasons.push(vision.direction === 0 ? 'No gráfico não se vê uma entrada clara.' : 'O gráfico ainda não mostra o sinal com certeza suficiente.');
  }

  if (reading?.signal) {
    const q = reading.signal.direction;
    const ctx = reading.context?.score ?? 0;
    if (direction !== 0 && q === direction) {
      agreement = 'confirma';
      confidence = Math.min(95, Math.round((confidence + reading.signal.confidence) / 2 + 10));
      reasons.push('Os dados ao vivo do mercado confirmam.');
    } else if (direction !== 0 && q === -direction) {
      agreement = 'diverge';
      // The chart on the person's screen leads; the live data only blocks a weak reading
      // when it is itself sure of the opposite side.
      if (vision.confidence >= 70 || (reading.signal.confidence ?? 0) < 55) {
        confidence = Math.max(0, confidence - 10);
        reasons.push('Os dados ao vivo não concordam totalmente: usa sempre o stop.');
      } else {
        reasons.push('Os dados ao vivo apontam com força para o lado contrário.');
        direction = 0;
      }
    } else if (direction !== 0) {
      // The live engine is cautious and rarely has its own signal: no signal is not a "no".
      agreement = 'neutro';
      if (ctx * direction < -0.35) {
        reasons.push('As ordens a entrar e as notícias estão contra este lado.');
        direction = 0;
      }
    } else {
      agreement = q === 0 ? 'neutro' : 'diverge';
    }
    if (reading.snapshot?.regime === 'chaotic') {
      reasons.push('O preço está a saltar demasiado neste momento.');
      direction = 0;
    }
  }

  if (direction !== 0 && confidence < 50) {
    reasons.push('A certeza é baixa (menos de 50%).');
    direction = 0;
  }

  const decision = direction > 0 ? 'COMPRAR' : direction < 0 ? 'VENDER' : 'AGUARDAR';
  const headline = direction > 0
    ? 'O gráfico tende a subir'
    : direction < 0
      ? 'O gráfico tende a descer'
      : 'Mercado instável: melhor aguardar';
  // Strong enough to show at once, without waiting for a second reading.
  const strong = direction !== 0 && ((agreement === 'confirma' && confidence >= 70) || (agreement !== 'diverge' && confidence >= 80));
  return { decision, direction, confidence: direction === 0 ? Math.min(confidence, 40) : confidence, agreement, headline, reasons, strong };
}

/** Plain guidance for an image that is not a chart. `source` is 'foto' or 'ecrã'. */
export function noChartGuidance(vision = {}, source = 'foto') {
  const saw = vision.summary ? `A IA vê: ${vision.summary}` : 'A IA não reconhece velas, barras ou linha de preço nesta imagem.';
  return {
    action: 'SEM GRÁFICO',
    tone: 'wait',
    headline: 'Isto não parece um gráfico de preços',
    why: [saw, 'Sem um gráfico visível não há leitura de mercado, por isso a IA não dá sinal de compra nem de venda.'],
    steps: source === 'ecrã'
      ? ['Mostra o gráfico da corretora inteiro no ecrã partilhado ou na câmara.', 'Garante que se vêem as velas, o preço e o timeframe.']
      : ['Fotografa ou carrega o ecrã com o gráfico da corretora.', 'Enquadra o gráfico inteiro: velas, eixo do preço e timeframe.', 'Evita reflexos e imagens tremidas.'],
    now: source === 'ecrã'
      ? 'Mostra o gráfico da corretora inteiro, bem enquadrado, para a IA conseguir analisar.'
      : 'Tira uma foto ao gráfico da corretora para receberes a orientação.',
    levels: null
  };
}
