# Grafictrader Market Mechanics Engine

## Objetivo

Criar uma camada matemática própria do Grafictrader capaz de analisar **como o mercado está se movimentando**, e não apenas quais indicadores técnicos estão ativos.

O motor deve procurar evidências sobre o mecanismo dominante do movimento: eficiência do deslocamento, absorção, custo de deslocamento, memória de liquidez, organização/entropia, mudança de regime, pressão estrutural e possíveis assinaturas de execução.

**Não afirmar que o sistema identifica um algoritmo, instituição ou trader específico.** Quando houver apenas evidência indireta, usar linguagem como "compatível com", "sugere" ou "há evidência de".

## Princípio fundamental

Separar completamente:

1. **Cálculo determinístico** — JavaScript calcula métricas a partir de dados reais.
2. **Interpretação** — Gemini explica o significado contextual das métricas.
3. **Interface** — Grafictrader apresenta o estado e a explicação.

A Gemini **não deve inventar valores nem executar cálculos fundamentais que podem ser reproduzidos pelo código**.

## Arquitetura atual

O repositório é Vite + JavaScript + Vercel Functions. Não criar uma arquitetura Next.js/TypeScript incompatível.

Estrutura desejada:

```
api/
  _lib/
    mechanics/
      efficiency.js
      energy.js
      absorption.js
      displacement.js
      liquidity.js
      entropy.js
      regime.js
      execution.js
      memory.js
      index.js
  mechanics.js
```

O endpoint deve consumir dados do pipeline de mercado existente e respeitar a regra do projeto de não chamar `api.binance.com` diretamente.

## Fontes de dados

### Nível 1 — OHLCV

Disponível inicialmente através do endpoint de mercado existente.

Permite calcular:
- eficiência de preço;
- velocidade;
- aceleração;
- persistência;
- range expansion;
- deslocamento;
- custo aproximado do movimento;
- entropia baseada em retornos/direção;
- mudanças de regime;
- algumas formas de absorção aproximada.

### Nível 2 — Trades

Quando uma fonte confiável estiver disponível:
- agressão compradora/vendedora;
- sequência de prints;
- tamanho e fragmentação;
- impacto por volume;
- pressão de execução.

### Nível 3 — Order book

Quando disponível:
- profundidade;
- desequilíbrio bid/ask;
- replenishment;
- consumo de liquidez;
- cancelamentos;
- persistência de níveis;
- resistência de liquidez.

**Nunca preencher dados ausentes com valores inventados.**

## Métricas

### 1. Price Efficiency

Mede quanto do caminho percorrido pelo preço resultou em deslocamento líquido.

Conceito:

```
efficiency = abs(close - open) / sum(abs(close[i] - close[i-1]))
```

Calcular em uma janela configurável.

Interpretação:
- próximo de 1: movimento muito direcional;
- baixo: muito deslocamento desperdiçado/chop.

Normalizar para 0–100 somente depois do cálculo.

### 2. Movement Energy

Não é energia física.

É uma métrica composta do esforço direcional observado.

Combinar, com pesos explícitos e documentados:
- deslocamento normalizado;
- aceleração;
- eficiência;
- persistência;
- expansão de range.

Não usar indicadores técnicos tradicionais como substitutos.

### 3. Absorption

Procurar situações em que existe atividade significativa, mas o preço apresenta pouco deslocamento.

Com OHLCV, usar como proxy:
- volume relativo;
- range relativo;
- wick/rejection;
- deslocamento líquido.

Com trades/order book, melhorar usando:
- volume agressor;
- impacto;
- replenishment;
- profundidade.

O resultado deve informar também a qualidade da evidência:
`ohlcv_proxy`, `trade_based` ou `orderbook_based`.

### 4. Displacement Cost

Estimar quanto esforço/atividade foi necessário para produzir determinado deslocamento.

Exemplo conceitual:

```
displacementCost =
  normalizedActivity / max(abs(priceDisplacement), epsilon)
```

Quanto maior o custo, maior a atividade necessária para produzir pouco deslocamento.

Não interpretar automaticamente como bullish ou bearish.

### 5. Liquidity Memory

Não chamar simplesmente de suporte/resistência.

Procurar regiões históricas em que o preço:
- desacelerou;
- rejeitou;
- acelerou;
- retornou;
- produziu deslocamentos anormais.

Criar zonas e medir persistência/reincidência.

Quando não houver histórico suficiente, retornar `insufficient_data`.

### 6. Market Entropy

Medir o grau de organização/desorganização dos movimentos.

Uma primeira implementação pode usar distribuição das direções dos retornos ou estados discretizados de retorno/range.

Não interpretar "alta entropia" como automaticamente bullish/bearish.

### 7. Regime Change

Detectar mudança no comportamento estatístico do mercado.

Comparar janela recente contra janela anterior usando, quando possível:
- volatilidade;
- eficiência;
- range;
- velocidade;
- autocorrelação/direcionalidade;
- distribuição dos retornos.

Retornar:
- `stable`;
- `transition`;
- `changed`.

A mudança de regime deve ser baseada em diferença mensurável, não em uma vela isolada.

### 8. Structural Pressure

Estimar se o mercado está acumulando condições para expansão/rejeição.

Combinar evidências independentes:
- eficiência;
- absorção;
- custo de deslocamento;
- concentração de liquidez;
- persistência;
- mudança de regime.

Nunca transformar isso diretamente em "vai subir" ou "vai cair".

### 9. Execution Signature

Objetivo: identificar padrões de comportamento **compatíveis com execução sistemática/fragmentada**, sem alegar identificar o algoritmo.

Exemplos de sinais:
- fragmentação temporal;
- repetição de tamanhos;
- impacto pequeno e persistente;
- replenishment;
- sequência direcional;
- relação entre agressão e deslocamento.

Só ativar análises avançadas quando trades/order book estiverem disponíveis.

### 10. Market State

O motor deve sintetizar as métricas em um estado mecânico, por exemplo:

- `DIRECTIONAL_EXPANSION`
- `ABSORPTION`
- `LIQUIDITY_CONFLICT`
- `RANGE_ROTATION`
- `REGIME_TRANSITION`
- `LOW_INFORMATION`

O estado deve ser consequência de regras explícitas e auditáveis.

## Contrato de saída

O endpoint deve devolver estrutura semelhante a:

```json
{
  "symbol": "BTCUSDT",
  "interval": "5m",
  "timestamp": 0,
  "dataQuality": {
    "candles": 120,
    "trades": false,
    "orderBook": false
  },
  "state": "DIRECTIONAL_EXPANSION",
  "metrics": {
    "priceEfficiency": 84,
    "movementEnergy": 77,
    "absorption": 31,
    "displacementCost": 42,
    "liquidityResistance": 68,
    "marketOrderliness": 79,
    "regimeStability": 73
  },
  "evidence": [],
  "limitations": []
}
```

Os números acima são apenas exemplo de formato. Não usar esses valores como dados reais.

## Regras para Gemini

A Gemini recebe somente métricas e evidências calculadas pelo backend.

Ela deve:
- explicar relações entre as métricas;
- identificar o mecanismo dominante;
- explicar conflitos entre sinais;
- indicar quais evidências sustentam a interpretação;
- declarar limitações;
- evitar inventar order flow, order book ou níveis que não foram fornecidos.

Ela não deve:
- transformar uma métrica em certeza;
- chamar um algoritmo específico pelo nome sem evidência;
- inventar dados;
- apresentar uma previsão como fato;
- substituir os cálculos determinísticos.

## Qualidade e confiança

Separar:
- **qualidade dos dados**;
- **força da evidência**;
- **confiança da interpretação**.

Não usar uma única pontuação para esconder falta de dados.

Exemplo:

```
DATA QUALITY: 72/100
EVIDENCE: MODERATE
INTERPRETATION: MODERATE

ORDER BOOK: unavailable
TRADES: unavailable
```

## Fallbacks

Se Binance estiver indisponível, continuar usando o fallback já existente, como Twelve Data, quando suportado.

Se trades não estiverem disponíveis:
- não executar métricas trade-based.

Se order book não estiver disponível:
- não executar métricas order-book-based.

O feed nunca deve apresentar ausência de dados como se fosse ausência de atividade.

## Testes obrigatórios

Criar testes para:
1. tendência fortemente direcional;
2. mercado lateral;
3. alta atividade com baixo deslocamento;
4. baixa atividade;
5. mudança clara de regime;
6. dados insuficientes;
7. candles inválidos;
8. valores NaN/Infinity;
9. divisão por zero;
10. fallback de fonte.

Cada métrica deve ser determinística para o mesmo conjunto de dados.

## Evolução futura

Depois da primeira versão:
1. trades reais;
2. order book real;
3. memória histórica persistente;
4. comparação de estados estruturais;
5. detecção de replenishment;
6. análise de impacto de execução;
7. atualização em tempo real;
8. calibração dos pesos usando dados históricos.

O objetivo final não é criar "mais um indicador".

É construir um **Market Mechanics Engine** que tente responder:

> "Qual mecanismo parece estar produzindo o movimento atual e quais evidências observáveis sustentam essa interpretação?"

Sem prometer prever o futuro e sem transformar inferências em fatos.
