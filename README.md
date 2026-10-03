# Grafictrader

Aplicação web mobile-first de gráficos e inteligência de mercado cripto, com tema claro e escuro.

Não executa ordens e não é aconselhamento financeiro.

## Funcionalidades

- **Início (LIVE)**: gráfico de velas (TradingView Lightweight Charts) para BTC, ETH, SOL, BNB, XRP, ADA e DOGE em 1m, 5m, 15m, 1h e 4h.
  - Tempo real pelo WebSocket público `data-stream.binance.vision`; enquanto o stream não está ligado, o gráfico atualiza por polling de `/api/market` a cada 5 s.
  - Leitura técnica por regras objetivas: EMA 20/50, estrutura de swings, RSI de Wilder e momentum, com suporte/resistência e um índice de confluência.
- **Foto**: captura pela câmara ou carregamento de imagem, reduzida no cliente e analisada por IA multimodal (`/api/analyze`, Gemini com fallback OpenAI).
- **Live Intelligence**: pulso BTC/ETH, resumo de 24h, motor Market Mechanics (OHLCV + trades + order book), memória de estados, Pattern Library e interpretação por IA, mais feed de notícias (GDELT, Finnhub, Marketaux).
- **Perfil**: conta, tema (Sistema / Claro / Escuro) e terminar sessão.

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
  _lib/sources/      Binance, Twelve Data, GDELT, Finnhub, Marketaux
src/
  lib/               tema, sessão, indicadores, utilitários
  views/             ecrãs (shell, live, foto, intel, sheet)
  styles.css         design system monocromático claro/escuro
tests/               testes unitários
```
