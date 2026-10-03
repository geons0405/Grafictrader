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

### LIVE

- Gráfico de velas em tempo real com dados Binance (WebSocket `data-stream.binance.vision`, com polling de reserva).
- **IA instrutora**: opera uma conta demo de $1.000 com risco de 1% por operação.
  - Entra no fecho da vela de sinal, com stop a 1,5×ATR e alvo a 2R.
  - Move o stop para a entrada depois de +1R e fecha por tempo ao fim de 24 velas.
- Entradas, saídas, stop e alvo aparecem no gráfico para o utilizador acompanhar e copiar por sua conta e risco.
- Com Redis, o estado da conta é persistente e cada decisão fica gravada com o contexto ao vivo do momento. Sem Redis, as operações são reconstruídas de forma determinística a partir das velas; todos os utilizadores veem as mesmas.

### Live Inteligente

Painel tipo terminal com:

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

O win rate e o P&L mostrados são o histórico real destas operações simuladas. Não há ordens reais e o app não é aconselhamento financeiro.

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
  _lib/sources/      Binance, Twelve Data, GDELT, Finnhub, Marketaux
src/
  lib/               tema, sessão, indicadores, utilitários
  views/             ecrãs (shell, live, foto, intel/Live Inteligente, sheet)
  styles.css         design system monocromático claro/escuro
tests/               testes unitários
```
