# Grafictrader

Aplicação web mobile-first de gráficos e inteligência de mercado cripto, com tema claro e escuro.

Não executa ordens e não é aconselhamento financeiro.

## Áreas

O menu inferior tem só duas áreas: **FOTO** (esquerda) e **LIVE** (direita). O botão no canto superior direito abre **Live Inteligente** e **Perfil**.

### FOTO

- A foto é tirada com a câmara ou carregada como imagem e é reduzida no cliente.
- A IA de visão (Gemini, com fallback OpenAI) devolve JSON estruturado: ativo, timeframe, decisão, entrada, stop, alvos, motivos e riscos.
- Se o ativo for um dos acompanhados (BTC, ETH, SOL, BNB, XRP, ADA, DOGE), a decisão é cruzada com o motor estatístico ao vivo e com o contexto (fluxo, livro de ordens, notícias).
- Veredito final: **COMPRAR**, **VENDER** ou **AGUARDAR** (instável ou sinais divergentes).

### LIVE · Minha corretora (modo principal)

A IA acompanha a corretora do próprio utilizador, seja ela qual for (MT5, XM, Exness, Quotex, IQ Option…), sem integrações.

- **Formas de mostrar a corretora:** partilha de ecrã no computador (`getDisplayMedia`), câmara no telemóvel, ou carregar um vídeo gravado.
- **Quando analisa:** só quando o gráfico muda (comparação de uma miniatura do frame), com no mínimo 8 s entre análises e uma análise de controlo a cada 45 s.
  - O relógio corre num Web Worker e a imagem é lida diretamente da faixa de vídeo (`ImageCapture`), por isso continua a funcionar com o separador em segundo plano.
- **`/api/watch`:**
  - Recebe o frame e a leitura anterior, para dar continuidade.
  - Devolve a decisão, a explicação informal e, quando reconhece o ativo, o cruzamento com o motor ao vivo.
  - Limite de 60 análises por 10 min por utilizador.
- **Estabilizador:**
  - Passar a "não operar" é imediato.
  - Mudar para comprar ou vender exige a mesma leitura duas vezes seguidas.
  - Frames sem gráfico nunca mudam a orientação.
- **Extras:**
  - Janela flutuante (Document Picture-in-Picture, Chrome no computador) por cima da corretora.
  - Voz e alertas do sistema quando a orientação muda.
  - Histórico das mudanças da sessão.
  - A sessão para sozinha ao fim de 45 min.

### LIVE · Mercado

O seletor no topo escolhe a fonte do gráfico:

- **TradingView**: widget oficial (cripto, forex, ouro, petróleo, índices). A marca TradingView do widget só sai num plano pago.
- **Binance**: todos os pares USDT (com pesquisa), em tempo real por WebSocket.
- **MetaTrader 5**: as velas da tua própria corretora, enviadas pelo EA `public/bridge/GrafictraderBridge.mq5` para `/api/mt5`.
  - A chave de ligação gera-se em Perfil > MetaTrader 5.
  - O EA só lê preços: não envia ordens.

No gráfico próprio (Lightweight Charts), o logótipo foi retirado. A atribuição exigida pela licença está por baixo do gráfico e em Perfil > Créditos.

O cartão da IA tem duas vistas:

- **Orientação**: COMPRAR, VENDER ou NÃO OPERAR, com entrada, stop loss e take profit. Inclui uma explicação informal para quem nunca operou: o que fazer agora, porquê e o passo a passo.
- **Resultados**: win rate, operações e histórico.

- Gráfico de velas em tempo real com dados Binance (WebSocket `data-stream.binance.vision`, com polling de reserva).
- **IA instrutora**: opera uma conta demo de $1.000 com risco de 1% por operação.
  - Entra no fecho da vela de sinal, com stop a 1,5×ATR e alvo a 2R.
  - Move o stop para a entrada depois de +1R e fecha por tempo ao fim de 24 velas.
- Entradas, saídas, stop e alvo aparecem no gráfico para o utilizador acompanhar e copiar por sua conta e risco.
- Com Redis, o estado da conta é persistente e cada decisão fica gravada com o contexto ao vivo do momento. Sem Redis, as operações são reconstruídas de forma determinística a partir das velas; todos os utilizadores veem as mesmas.

### Live Inteligente

Painel tipo terminal com:

- mercados globais: índices, VIX, dólar, câmbio, juros, ouro, petróleo e cripto;
- leitura de apetite ou aversão ao risco;
- calendário económico com contagem decrescente (ForexFactory);
- Fear & Greed cripto;

- saldo, P&L, posição e win rate;
- histórico de saldo e log de atividade;
- order book real;
- motor estatístico, contexto ao vivo e decisão atual;
- Market Mechanics com leitura IA;
- notícias ao vivo (GDELT, Finnhub, Marketaux);
- um cartão por ativo com o estado do instrutor.

### Motor estatístico (`api/_lib/quant`)

- Expoente de Hurst R/S com correção de Anis-Lloyd-Peters: persistência ou reversão.
- Variance ratio de Lo-MacKinlay: momentum nos retornos.
- Filtro de Kalman de tendência local: deriva escondida e o seu z-score.
- Entropia de permutação de Bandt-Pompe: previsibilidade da ordem das velas.
- Volatilidade Garman-Klass e o seu percentil: regime de volatilidade.
- Bulk Volume Classification e VPIN: pressão e toxicidade do fluxo.
- Desvio ao VWAP em desvios-padrão e autocorrelação.

O regime (tendência, reversão, ruído ou caos) decide o tipo de entrada. O contexto ao vivo pode vetar entradas.

Notícias de alto impacto nas moedas do ativo, de 15 min antes a 30 min depois, bloqueiam novas entradas. O USD conta sempre, porque mexe com quase tudo.

O win rate e o P&L mostrados são o histórico real destas operações simuladas. Não há ordens reais e o app não é aconselhamento financeiro.

## App Android

Descarregar: https://github.com/geons0405/Grafictrader/releases/download/android-latest/Grafictrader.apk

- A app (Capacitor, pasta `android/`) abre https://grafictrader.vercel.app, por isso as mudanças na web chegam à app sem a reinstalar.
- Em **LIVE › Minha corretora**, o botão "Analisar a corretora neste telemóvel" usa o plugin nativo `GrafictraderNative`:
  captura o ecrã com MediaProjection (serviço em primeiro plano), envia um frame a `/api/watch` só quando o gráfico muda
  e mostra COMPRAR / VENDER / NÃO OPERAR numa bolha flutuante por cima da corretora (toque para ver o que fazer, toque longo para abrir a app).
- Pede as permissões "Mostrar por cima de outras apps" e "Começar a gravar ou transmitir".
- O workflow `.github/workflows/android.yml` compila o APK e substitui a release `android-latest` a cada mudança em `android/`.
- O APK é de teste (assinatura de debug): para atualizar, desinstala a versão anterior se o Android recusar a instalação.

## Contas

Com `KV_REST_API_URL`/`KV_REST_API_TOKEN` configurados, as contas são reais:

- palavras-passe com hash scrypt guardadas no Redis;
- sessões em cookie `HttpOnly`, `SameSite=Lax` e `Secure`, válidas por 30 dias;
- registo, login e logout em `/api/auth?action=…`;
- as rotas de IA (`/api/analyze`, `/api/mechanics-ai`) exigem sessão válida.

Sem Redis, o app funciona em **modo local**: o perfil (só o nome) fica no dispositivo e o ecrã de login avisa disso.

## Proteções de custo e segurança

- Limite de pedidos: 10 análises de foto e 20 interpretações mecânicas por 10 min, por utilizador ou IP. Partilhado via Redis quando existe; caso contrário, por instância.
- `/api/mechanics-ai` recebe só `{ symbol, interval }` e recalcula as métricas no servidor, por isso não entra texto do cliente no prompt. Cada interpretação fica em cache 60 s.
- O cliente só pede nova interpretação quando o mecanismo muda ou a anterior tem mais de 2 min.
- Imagens limitadas a JPEG, PNG ou WebP com menos de 4 MB; a câmara reduz a captura para 1600 px.
- Links de notícias só abrem se forem `http(s)`.
- Símbolos e timeframes validados contra uma lista fechada.

## Variáveis de ambiente

Ver `.env.example`. Nunca colocar chaves de fornecedores no código do frontend.
Na Vercel, cada variável tem de estar ativa em **Production** (e Preview), com o nome exato (`..._API_KEY`).

| Variável | Para quê |
| --- | --- |
| `GROQ_API_KEY` | IA principal: lê gráficos (qwen3.8-27b) e é a juíza do conselho (gpt-oss-120b) |
| `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `UNOROUTER_API_KEY` | IAs de reserva, usadas por ordem quando a anterior falha ou atinge o limite |
| `AI_VISION_MODELS`, `AI_JUDGE_MODELS` | Opcionais: `provedor:modelo,...` para pôr modelos à frente (ex.: `nvidia:meta/llama-3.2-90b-vision-instruct`) |
| `KV_REST_API_URL` | `https://grafictrader-dados.floot.app/_api/kv` |
| `KV_REST_API_TOKEN` | O mesmo token guardado no Floot (`GRAFICTRADER_KV_TOKEN`) |
| `OPENAI_API_KEY`, `TWELVE_DATA_API_KEY`, `MARKETAUX_API_KEY`, `FINNHUB_API_KEY` | Opcionais |

Estado dos serviços: `GET /api/health` (o que está configurado) e `GET /api/health?probe=1` (faz uma chamada real a cada serviço; limitado a 5 por 10 minutos).

### Motor de Inteligência de Mercado

`GET /api/intelligence?engine=1&symbol=BTCUSDT&interval=5m` (painel **Market Intelligence Engine** na Live Inteligente; também entra no conselho como analista "Estrutural").

| Camada | Cálculos |
| --- | --- |
| 1. Microestrutura | CVD, desequilíbrio agressor e tendência do OFI, lambda de Kyle, absorção, icebergs, perfil de volume (POC, VAH, VAL, HVN, LVN), VWAP, varrimentos de liquidez, profundidade do livro a ±0,1/0,5/1% |
| 2. Entropia e informação | Shannon, permutação (3 e 4), entropia amostral e aproximada, informação mútua, transfer entropy, tendência da entropia |
| 3. Regimes | HMM gaussiano de 3 estados (Baum–Welch), ponto de mudança por razão de verosimilhança, regimes A–G |
| 4. Volatilidade | Realizada, Parkinson, Garman–Klass, Rogers–Satchell, Yang–Zhang, clustering, vol-da-vol, compressão → expansão |
| 5. Fractais | Hurst R/S, DFA, dimensão de Higuchi, Hurst generalizado H(1)–H(3) |
| 6. Wavelets | Análise multirresolução de Haar (curto, swing, estrutural), energia por escala, coerência com outro ativo |
| 7. Anomalias | Z robusto, Mahalanobis, Isolation Forest, resíduo face ao beta de outro ativo, divergência preço/fluxo |
| 8. Causalidade | Granger (valor-p F), lead-lag, transfer entropy e grafo entre o ativo, BTC, ETH, SOL e DXY |

**Fusão:** o peso de cada camada depende do regime e do seu IC (correlação com o retorno seguinte) numa validação walk-forward de ~40 pontos do histórico do próprio mercado. Resultado: viés estrutural (−100 a +100), confiança, probabilidade de subir e movimento esperado.
**Alerta antecipado:** compressão, entropia a descer, Hurst a subir, fluxo e volume a crescer, liquidez desequilibrada → estado (pré-rompimento, expansão, exaustão) e probabilidade.
**Intenção:** decompõe o último movimento em agressão, short covering ou liquidações (open interest da OKX), falta de liquidez, arrasto de outro ativo, varrimento de stops e ruído.

Limites: sem dados de opções não há volatilidade implícita nem skew; autoencoders e modelos treinados ficam de fora por correrem em funções serverless.

### Conselho de analistas e juíza IA

`GET /api/instructor?council=1&symbol=BTCUSDT&interval=5m` (separador **Conselho** no LIVE › Mercado):

| Analista | O que calcula |
| --- | --- |
| Estrutural (motor) | Leitura fundida das 8 camadas do motor, alerta antecipado e intenção |
| Noticiário | Tom das manchetes das últimas 12 h (mais peso às recentes) |
| Matemático | MACD, ROC 10/30, RSI, inclinação da EMA 20 |
| Estatístico | Regime: Hurst, razão de variância, entropia, VWAP z, Kalman |
| Comportamental | Medo e Ganância (contrário nos extremos), fluxo agressor, livro, VPIN |
| Tendencial | EMA 20/50 no tempo gráfico e em dois superiores |
| Algorítmico | Sinal do motor quant, pesado pelo historial de acertos |
| Macro e risco | Apetite ao risco global; notícia de alto impacto veta qualquer entrada |

O consenso ponderado e os motivos vão para a juíza IA, que dá o veredito final. O código mantém as regras duras: com veto a decisão é AGUARDAR, e a juíza não pode inverter um consenso forte. Sem IA, decide o consenso numérico.

### Escolha dos modelos (teste de 4/10/2026)

`/api/health?compare=provedor:modelo,...&chart=up|down|side` e `&task=reasoning`:

- Gráficos (alta, queda, lateral): Groq qwen3.8-27b acertou os três em menos de 1 s; NVIDIA Llama 3.2 Vision 90B e Gemini 3.8 Flash também acertaram, mais lentos ou muitas vezes ocupados.
- Raciocínio (subida forte com notícia forte daqui a 10 min → AGUARDAR): Groq gpt-oss-120b e qwen3.8-27b acertaram em 0,5 s; os modelos grandes da NVIDIA estavam sobrecarregados.

### Notícias em tempo real sem chave

- [rss-parser](https://github.com/rbren/rss-parser): CoinDesk, Cointelegraph, Investing.com, Yahoo Finance e pesquisa do Google News por ativo.
- [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2): notícias do Yahoo Finance por ativo.
- [sentiment](https://github.com/thisandagain/sentiment): tom de cada manchete (positivo, negativo, neutro), usado no contexto da IA instrutora.

### Base de dados (Floot)

Contas, sessões, limites de pedidos, estado da IA instrutora, biblioteca de padrões e dados do MT5 ficam
no projeto Floot **Grafictrader Dados** (Postgres). O endpoint `POST /_api/kv` fala o mesmo protocolo REST
do Upstash Redis (`GET`, `SET` com `EX`/`NX`, `DEL`, `INCR`, `EXPIRE`), por isso o código usa o mesmo
cliente (`api/_lib/redis.js`). Para trocar o token: muda-o no Floot (Resources) e em `KV_REST_API_TOKEN`
na Vercel ao mesmo tempo, e faz Redeploy.

## Desenvolvimento

```bash
npm install
npm test        # testes unitários (node:test)
npm run build   # build de produção (Vite)
npm run dev     # só frontend; as rotas /api precisam de `vercel dev`
```

O CI (`.github/workflows/ci.yml`) corre `npm ci`, `npm test` e `npm run build` em cada push.

## Estrutura

```text
api/                 funções serverless da Vercel
  _lib/auth.js       contas e sessões
  _lib/redis.js      cliente Upstash REST
  _lib/rate-limit.js limitador de pedidos
  _lib/mechanics/    motor de mecânica, memória e Pattern Library
  _lib/quant/        estatística avançada, decisão, IA instrutora, veredito da foto
  instructor.js      /api/instructor (um ativo) e ?desk=1 (todos)
  global.js          /api/global: mercados mundiais, calendário, Fear & Greed
  mt5.js             /api/mt5: ponte MetaTrader 5 (POST do EA, GET do app)
  watch.js           /api/watch: análise ao vivo de frames da corretora
  _lib/vision.js     chamadas à IA de visão (Gemini, fallback OpenAI)
public/bridge/       EA MQL5 para ligar o MetaTrader 5
  _lib/sources/      Binance, Twelve Data, GDELT, Finnhub, Marketaux
src/
  lib/               tema, sessão, indicadores, utilitários
  views/             ecrãs (shell, live-screen, watch, live, foto, intel/Live Inteligente, profile, sheet)
  styles.css         design system monocromático claro/escuro
tests/               testes unitários
```

## Fontes e repositórios de referência

- MetaTrader 5:
  - EA próprio em `public/bridge/` (via WebRequest).
  - Alternativas: [mt5-bridge (REST + WebSocket)](https://github.com/mobjoy0/mt5-bridge), [MetaApi SDK (cloud, pago com tier grátis)](https://github.com/metaapi/metaapi-javascript-sdk), [mt5-rest-api](https://github.com/DevRico003/mt5-rest-api).
- Binance:
  - WebSocket público + [Lightweight Charts](https://github.com/tradingview/lightweight-charts).
  - Exemplo de referência: [binance-tutorials](https://github.com/hackingthemarkets/binance-tutorials).
- TradingView: [widgets gratuitos](https://www.tradingview.com/widget/).
- Calendário: `nfs.faireconomy.media/ff_calendar_thisweek.json` (máx. ~2 pedidos por 5 min; o app guarda em cache 15 min).
- Mercados globais: endpoint público de gráficos do Yahoo Finance.
- Fear & Greed: [alternative.me](https://alternative.me/crypto/fear-and-greed-index/).
