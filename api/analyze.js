import { requireUserIfConfigured } from './_lib/auth.js';
import { rateLimit, sendRateLimited } from './_lib/rate-limit.js';
import { clientIp } from './_lib/validate.js';

// Vercel rejects bodies above 4.5 MB; the client downsizes captures well below this.
const MAX_IMAGE_CHARS = 4_000_000;
const IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const ANALYSIS_PROMPT = `Analisa esta imagem de um gráfico de trading de forma objetiva e educativa.
Responde em português de Angola, sem prometer resultados e sem dizer que uma entrada é garantida.
Identifica, apenas se forem visíveis: ativo, timeframe, tendência, estrutura de mercado, suporte/resistência, RSI/MACD/EMAs ou outros indicadores, sinais de continuação ou reversão e cenários alternativos.
Não inventes valores, indicadores ou níveis que não estejam visíveis.
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
CONFIANÇA VISUAL: baixa/média/alta`;

function extractGeminiText(data) {
  return data?.candidates?.flatMap(candidate =>
    candidate?.content?.parts?.map(part => part?.text).filter(Boolean) || []
  ).join('\n').trim() || '';
}

function extractOpenAIText(data) {
  return data?.output_text ||
    data?.output?.flatMap(item =>
      item?.content?.filter(part => part?.type === 'output_text').map(part => part?.text) || []
    ).join('\n').trim() || '';
}

async function analyzeWithGemini(image, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) throw new Error('Imagem inválida para Gemini.');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: ANALYSIS_PROMPT },
            {
              inline_data: {
                mime_type: match[1],
                data: match[2]
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1200
        }
      })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Falha na análise com Gemini.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const analysis = extractGeminiText(data);
  if (!analysis) throw new Error('Gemini não devolveu uma análise.');
  return { analysis, provider: 'Gemini' };
}

async function analyzeWithOpenAI(image, key) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: ANALYSIS_PROMPT },
          { type: 'input_image', image_url: image }
        ]
      }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || 'Falha na análise com OpenAI.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const analysis = extractOpenAIText(data);
  if (!analysis) throw new Error('OpenAI não devolveu uma análise.');
  return { analysis, provider: 'OpenAI' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const { image } = req.body || {};
    if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS) {
      return res.status(413).json({ error: 'Imagem demasiado grande ou inválida.' });
    }
    if (!IMAGE_PATTERN.test(image)) {
      return res.status(400).json({ error: 'Imagem inválida.' });
    }

    const access = await requireUserIfConfigured(req, res);
    if (!access.ok) return;

    const limit = await rateLimit('analyze', access.user?.email || clientIp(req), { limit: 10, windowSeconds: 600 });
    if (!limit.allowed) return sendRateLimited(res, limit);

    const geminiKey = process.env.GEMINI_API_KEY;
    const openAIKey = process.env.OPENAI_API_KEY;

    if (!geminiKey && !openAIKey) {
      return res.status(503).json({
        error: 'Nenhuma IA de análise está configurada. Configure GEMINI_API_KEY (recomendado) ou OPENAI_API_KEY no Vercel.',
        setupRequired: true
      });
    }

    if (geminiKey) {
      try {
        const result = await analyzeWithGemini(image, geminiKey);
        return res.status(200).json(result);
      } catch (error) {
        console.error('[Gemini] Falha na análise:', error?.message || error);
        if (!openAIKey) {
          return res.status(error?.status || 502).json({
            error: 'O Gemini não conseguiu analisar a imagem.',
            provider: 'Gemini'
          });
        }
      }
    }

    if (openAIKey) {
      try {
        const result = await analyzeWithOpenAI(image, openAIKey);
        return res.status(200).json(result);
      } catch (error) {
        console.error('[OpenAI] Falha na análise:', error?.message || error);
        return res.status(error?.status || 502).json({
          error: 'Nenhum provedor de IA conseguiu analisar a imagem.',
          provider: 'fallback'
        });
      }
    }

    return res.status(503).json({ error: 'Serviço de análise indisponível.' });
  } catch (error) {
    console.error('[Analyze] Erro interno:', error);
    return res.status(500).json({ error: 'Erro interno ao analisar a imagem.' });
  }
}
