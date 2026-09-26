# Live Intelligence — guia de orientação

Este documento fixa as regras da área de **notícias/eventos**. Qualquer alteração nesta área deve respeitar estas regras — foram definidas depois de um bug real ("0 eventos" persistente) causado por as violar.

## Regra de ouro: uma fonte falhar nunca derruba as outras

- Todo fetcher em `lib/sources/*.ts` tem o seu próprio `try/catch` e devolve `[]` em caso de erro. **Nunca** deixar um fetcher rebentar (throw) para fora da própria função.
- `getAllIntelligence()` usa **`Promise.allSettled`**, nunca `Promise.all`. Se alguém trocar isto de volta para `Promise.all`, uma única fonte mal configurada (ex: API key em falta) volta a zerar o feed inteiro.
- A resposta de `/api/intelligence` inclui sempre `activeSources` e `failedSources` — isto permite depurar em segundos, sem abrir os Vercel Runtime Logs. Não remover estes campos.

## Fontes atuais e as suas keys

| Fonte | Precisa de key? | Variável |
|---|---|---|
| Binance | Não | — |
| GDELT | Não | — |
| Marketaux | Sim | `MARKETAUX_API_KEY` |
| Finnhub | Sim | `FINNHUB_API_KEY` |

Uma fonte sem a key correspondente deve devolver `[]` com um `console.warn` explícito (não um erro), porque é um estado esperado, não uma falha.

## Adicionar uma nova fonte

1. Criar `lib/sources/<nome>.ts` com uma função `get<Nome>Events(): Promise<IntelEvent[]>`.
2. Seguir o mesmo padrão: try/catch, devolve `[]` em falha, warning se faltar key.
3. Mapear o resultado para o tipo `IntelEvent` (`lib/intelligence.ts`) — não inventar um formato novo por fonte.
4. Registar a fonte em `getAllIntelligence()` (array de promises + array `SOURCE_NAMES`, na mesma posição).
5. Se a fonte trouxer uma tag nova (além de BTC/CRYPTO/MACRO/NEWS/MARKET), adicionar ao tipo `IntelTag` **e** ao array `TABS` em `components/LiveIntelligence.tsx` — os dois têm de ficar sincronizados.

## Sentimento (bull/bear/neu)

- Se a fonte já vier com um score de sentimento (ex: Marketaux), normalizar para os 3 valores com o mesmo threshold usado em `marketaux.ts` (`> 0.15` bull, `< -0.15` bear, senão neutro) — não inventar escalas novas por fonte, para os badges na UI serem consistentes entre si.
- Se a fonte não trouxer sentimento (GDELT, Finnhub), usar `'neu'` em vez de tentar adivinhar por palavras-chave — isso é trabalho para o OpenAI, não para o fetcher.

## Checklist antes de dar como resolvido um bug de "feed vazio"

1. `GET /api/intelligence` — confere `failedSources` na resposta.
2. Testa a fonte suspeita isoladamente (URL direta no browser, sem passar pelo agregador).
3. Confirma as env vars no ambiente certo do Vercel (Production **e** Preview são separados).
4. Só depois disso, olha para o código — na maioria dos casos até agora foi configuração, não lógica.
