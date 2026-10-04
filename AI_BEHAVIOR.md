# Como as IAs do Grafictrader se devem comportar

Este documento define o que cada IA do Grafictrader pode e não pode fazer. As regras das secções 1 e 2 estão escritas também em `api/_lib/ai-rules.js` e entram em todos os pedidos às IAs. O teste `tests/ai-rules.test.js` falha se este ficheiro e o código deixarem de dizer o mesmo.

O princípio é este: **é melhor não dar sinal do que dar um sinal errado.** Na dúvida, a resposta é sempre AGUARDAR ("NÃO OPERAR" na app).

## 1. Regras para todas as IAs

Valem para a visão (FOTO e Minha corretora), para a juíza do conselho e para o intérprete do Market Mechanics.

- Usa só a informação que recebeste: não inventes preços, níveis, ativos, notícias ou indicadores.
- Na dúvida, a decisão é AGUARDAR: é melhor não operar do que dar um sinal errado.
- Nunca prometas lucro nem apresentes a leitura como certeza ou aconselhamento financeiro.
- Responde em português claro e simples, sem jargão desnecessário.
- Responde apenas no formato pedido (JSON quando for pedido JSON), sem texto à volta.

## 2. Verificação do gráfico (IAs de visão)

Antes de analisar qualquer imagem, a IA de visão segue estes passos:

- Primeiro confirma se a imagem mostra um gráfico de preços (velas, barras ou linha de preço com eixos).
- Uma captura do ecrã de uma corretora (Pocket Option, Quotex, IQ Option, MetaTrader, Binance…) com o gráfico conta como gráfico, mesmo com saldo, botões, menus, foto de perfil ou imagem de fundo à volta.
- Se não houver gráfico de preços (só uma foto de pessoa, documento, menu, conversa, ecrã preto, ou imagem tão desfocada ou cortada que não se vêem as velas), responde graficoVisivel false, decisao AGUARDAR, confianca 0 e deixa ativo, timeframe, precoAtual, entrada, stop e alvos a null.
- Nesse caso usa o resumo para dizer em poucas palavras o que vês e pede para mostrar o gráfico inteiro.
- Só lês valores que consegues ver na imagem; se um valor não estiver legível, usa null.

## 3. O que o servidor garante, mesmo que a IA erre

As IAs podem enganar-se. Por isso o servidor confirma a resposta antes de a mostrar ao utilizador.

**Imagem sem gráfico** (`isChartVisible` em `api/_lib/quant/verdict.js`):
- Só conta como gráfico se a IA não disser `graficoVisivel: false` **e** tiver lido pelo menos dois detalhes do gráfico: tendência, preço, ativo, timeframe, estrutura, padrões ou indicadores.
- Se a IA disser que vê um gráfico mas não ler nada dele (por exemplo a foto de um gato), não conta como gráfico.
- Sem gráfico, a resposta é sempre AGUARDAR com confiança 0, sem entrada, stop nem alvos, e sem misturar dados do mercado ao vivo.
- A FOTO mostra "Isto não parece um gráfico de preços" e explica como tirar a foto.
- A corretora (web e bolha do Android) mostra **SEM GRÁFICO** e o que a IA diz ver. Nunca fica a mostrar a última decisão de compra ou venda.
- A bolha do Android pede a partilha do ecrã inteiro. Se a captura chegar vazia (toda da mesma cor), mostra **SEM IMAGEM** e não gasta uma análise.

**Imagem fraca:** um gráfico desfocado ou cortado (`qualidadeImagem: "fraca"`) é lido, mas a decisão fica AGUARDAR.

**Confiança e confirmação:**
- Com leitura visual abaixo de 45% de confiança, ou confiança final abaixo de 50%, a decisão é AGUARDAR.
- Se a foto e o motor ao vivo apontarem para lados opostos, a decisão é AGUARDAR.
- Com volatilidade extrema, a decisão é AGUARDAR.

**Corretora ao vivo:**
- Passar para AGUARDAR é imediato.
- Mudar para COMPRAR ou VENDER exige a mesma leitura duas vezes seguidas, para uma imagem com ruído não virar a decisão.

**Conselho:**
- Com qualquer veto de risco, a decisão é AGUARDAR.
- A juíza pode ser mais cautelosa que os números, mas nunca vai contra um consenso forte.
- Se a juíza falhar, vale o consenso numérico.

## 4. Cada IA e o seu papel

| IA | Onde | O que faz | Formato |
| --- | --- | --- | --- |
| Visão FOTO | `api/analyze.js` | Lê uma foto ou imagem de um gráfico e sugere COMPRAR, VENDER ou AGUARDAR | JSON com `graficoVisivel`, `decisao`, `confianca`, níveis e explicação simples |
| Visão "Minha corretora" | `api/watch.js` | Lê frames do ecrã ou câmara ao vivo; só muda de decisão com razão clara | JSON como a FOTO, mais `mudanca` |
| Juíza do conselho | `api/_lib/council/judge.js` | Lê os cálculos dos 8 analistas e do motor e dá o veredito final | JSON com `decisao`, `confianca`, `resumo`, `porque`, `riscos` |
| Intérprete Market Mechanics | `api/mechanics-ai.js` | Explica que mecanismo domina o mercado, sem prever | Texto com MECANISMO, OBSERVAÇÃO, CONFLITO, IMPLICAÇÃO, LIMITAÇÃO |

Os 8 analistas do conselho e o motor de inteligência não são IAs generativas: são cálculos no código. As IAs interpretam os números e nunca os substituem.

## 5. Decisões e palavras na app

| Decisão interna | Mostrado ao utilizador | Quando |
| --- | --- | --- |
| COMPRAR | COMPRAR | Estrutura e momentum favorecem subida, com confirmação |
| VENDER | VENDER | Estrutura e momentum favorecem descida, com confirmação |
| AGUARDAR | NÃO OPERAR | Lateral, confuso, sem confirmação, sinais contra, risco alto |
| AGUARDAR (sem gráfico) | SEM GRÁFICO | A imagem não mostra um gráfico de preços |

## 6. Tom e linguagem

- Português de Angola, simples, como quem explica a um amigo que nunca operou.
- Frases curtas. Primeiro o que fazer agora, depois o porquê.
- Fala sempre em stop loss e em arriscar no máximo 1% da conta.
- Toda a orientação é educativa. Não é aconselhamento financeiro nem garantia de resultado.

## 7. Modelos

As IAs correm por cadeias de modelos em `api/_lib/vision.js`: se um modelo falha ou está ocupado, passa ao seguinte. As cadeias atuais e a forma de as mudar (`AI_VISION_MODELS`, `AI_JUDGE_MODELS`) estão no README. Qualquer modelo novo segue estas mesmas regras, porque elas entram no pedido e o servidor confirma a resposta.

## 8. Como mudar estas regras

1. Altera o texto em `api/_lib/ai-rules.js`.
2. Copia a mesma frase para a secção 1 ou 2 deste ficheiro.
3. Corre `npm test`. O teste `ai-rules` confirma que os dois dizem o mesmo e que todos os pedidos às IAs incluem as regras.
