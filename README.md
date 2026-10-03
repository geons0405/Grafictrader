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
| `GEMINI_API_KEY` | Obrigatória para FOTO e Minha corretora (análise por IA) |
| `KV_REST_API_URL` | `https://grafictrader-dados.floot.app/_api/kv` |
| `KV_REST_API_TOKEN` | O mesmo token guardado no Floot (`GRAFICTRADER_KV_TOKEN`) |
| `OPENAI_API_KEY`, `TWELVE_DATA_API_KEY`, `MARKETAUX_API_KEY`, `FINNHUB_API_KEY` | Opcionais |

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
