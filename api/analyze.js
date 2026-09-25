export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const { image } = req.body || {};
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Imagem inválida.' });
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return res.status(503).json({
        error: 'OPENAI_API_KEY não configurada no Vercel.',
        setupRequired: true
      });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Analisa esta imagem de um gráfico de trading de forma objetiva e educativa.
Responde em português de Angola, sem prometer resultados e sem dizer que uma entrada é garantida.
Identifica, se forem visíveis: ativo, timeframe, tendência, estrutura de mercado, suporte/resistência, RSI/MACD/EMAs ou outros indicadores visíveis, sinais de continuação ou reversão e cenários alternativos.
Se a imagem não permitir uma conclusão confiável, diz exatamente o que falta.
Formato:
RESUMO: uma frase
TENDÊNCIA: ...
ESTRUTURA: ...
NÍVEIS: ...
INDICADORES: ...
CENÁRIO A: ...
CENÁRIO B: ...
RISCO: ...
CONFIANÇA VISUAL: baixa/média/alta`
            },
            {
              type: 'input_image',
              image_url: image
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Falha na análise da imagem.'
      });
    }

    const text = data.output_text || data.output?.flatMap(item =>
      item.content?.filter(part => part.type === 'output_text').map(part => part.text) || []
    ).join('\n') || 'Não foi possível obter uma análise.';
    
    return res.status(200).json({ analysis: text });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao analisar a imagem.' });
  }
}
