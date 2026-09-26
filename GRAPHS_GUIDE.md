# Gráficos — guia de orientação

Este documento fixa as regras da área de **preços e gráficos** (ticker,
Market Pulse, sparklines nos cards de notícias, e o gráfico principal de
candlesticks). Foi criado depois de um bug real: a Binance a bloquear
geograficamente os pedidos vindos da function da Vercel, deixando tudo
o que depende de preço em "—" / OFFLINE.

## Regra de ouro: nunca chamar `api.binance.com` diretamente

- A fonte de preços é sempre `https://data-api.binance.vision` (mirror
  público de só-leitura da Binance, sem o bloqueio de "restricted location
  according to eligibility" que `api.binance.com` aplica nalgumas regiões).
- Se usares **CCXT**, tens de sobrepor a URL manualmente — o CCXT aponta
  para `api.binance.com` por defeito:
  ```ts
  exchange.urls['api']['public'] = 'https://data-api.binance.vision/api';
  ```
- Nunca hardcodar `api.binance.com` num componente novo. Se precisares de
  preços/candles, importa de `lib/sources/binance.ts` — não faças fetch
  direto à Binance a partir de outro sítio do código.

## Fallback obrigatório: Twelve Data

- `lib/sources/binance.ts` já deteta bloqueio geográfico (status 451 ou
  corpo da resposta com "restricted location" / "eligibility") e cai
  automaticamente para `lib/sources/twelvedata.ts`.
- Qualquer novo consumidor de preços (um novo widget, um novo gráfico) deve
  usar as funções já existentes (`getBinanceTicker`, `getSparkline`) em vez
  de reimplementar fetch + fallback do zero — a lógica de deteção de
  bloqueio só deve existir num sítio.
- `TWELVE_DATA_API_KEY` tem de estar configurada no Vercel (Production **e**
  Preview) para o fallback funcionar — sem ela, `twelvedata.ts` devolve `[])
  silenciosamente, e a UI mostra "—" mesmo com o fallback implementado.

## Regras específicas do Lightweight Charts (candlesticks)

Estas causam ecrã em branco silencioso se forem ignoradas:

1. **`'use client'`** obrigatório na primeira linha de qualquer ficheiro que
   importe `lightweight-charts` — a lib usa `document`/`window`, que não
   existem no lado do servidor no Next.js.
2. **`createChart(...)` só dentro de `useEffect`**, nunca no top-level do
   módulo nem no corpo do componente fora de um hook.
3. O container do gráfico (`<div ref={containerRef}>`) precisa de `width` e
   `height` definidos em CSS **antes** de `createChart` correr. Um container
   com altura 0 cria um canvas invisível sem erro nenhum na consola.
4. Fazer `chart.remove()` no cleanup do `useEffect` para evitar charts
   duplicados ao re-renderizar (comum em desenvolvimento com Fast Refresh).

## Checklist antes de dar como resolvido um bug de "gráfico não aparece"

1. Confirma no DevTools (não só na consola) se o `<div>` do gráfico existe
   na árvore e qual a altura real dele.
2. Consola do browser — procura `document is not defined` (falta `'use
   client'`) ou qualquer "Uncaught Error" acima do componente do gráfico.
3. `GET /api/ticker` diretamente no browser — se vier vazio ou com erro
   de "restricted location", o problema é a fonte de dados, não o componente.
4. Só depois de excluir os três pontos acima, assume que é bug de lógica no
   próprio componente.
