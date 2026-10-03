# Pattern Library

A Pattern Library persistente transforma as famílias detectadas pelo Mechanical Engine numa memória histórica por ativo e timeframe.

## Persistência

O adaptador usa Redis REST compatível com Upstash/Vercel KV:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Sem estas variáveis, o endpoint continua funcional, mas a biblioteca fica marcada como não configurada.

## Chave

Cada combinação possui uma biblioteca independente:

`grafictrader:pattern-library:{SYMBOL}:{INTERVAL}`

Exemplo:

`grafictrader:pattern-library:BTCUSDT:5m`

## Escrita

- `/api/mechanics` atualiza a biblioteca, no máximo, uma vez a cada 30 s por ativo e timeframe.
- Essa porta de escrita (`SET NX EX`) também serializa pedidos simultâneos, que antes se sobrepunham e perdiam atualizações.
- A memória usa 240 velas, ou seja, 12 janelas de 20 velas.
- As famílias só comparam janelas que terminam antes do padrão atual; janelas sobrepostas inflacionavam a semelhança.

## Identidade de uma família

A impressão digital combina a sequência de estados com três métricas em faixas baixa, média e alta (`L`, `M`, `H`): eficiência, energia e pressão estrutural.

Antes, oito métricas em passos de 5 pontos tornavam quase todas as observações únicas, e nenhuma família acumulava histórico.

## O que é guardado

Cada família mantém:

- assinatura mecânica;
- número de ocorrências;
- primeira e última observação;
- similaridade;
- sequência de estados observada;
- resultados históricos resolvidos em 3, 6 e 12 barras.

Os resultados históricos são descrições retrospectivas das ocorrências já observadas. Não são probabilidades, previsões nem recomendações.

## Resolução de outcomes

Só são usadas velas **fechadas**: a última vela da Binance ainda está em formação e não serve como entrada nem como alvo.

Quando uma família é observada, o sistema regista:

- preço de entrada;
- tempo da observação;
- assinatura da família.

Nas chamadas seguintes, quando existem candles suficientes, calcula a variação percentual após:

- 3 barras;
- 6 barras;
- 12 barras.

A biblioteca agrega:

- amostras;
- ocorrências positivas;
- negativas;
- neutras;
- retorno médio;
- retorno absoluto médio.

O limiar neutro é ±0,02 ponto percentual.

## Limites

- máximo de 100 famílias por ativo/timeframe;
- máximo de 240 observações recentes;
- observações são mantidas apenas numa janela suficiente para resolver os horizontes configurados.

## Regra de interpretação

A IA pode explicar como uma família se comportou historicamente quando existem amostras resolvidas, mas não deve converter esse histórico em previsão futura. O valor da biblioteca é memória quantitativa e comparação estrutural.
