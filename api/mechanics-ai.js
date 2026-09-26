const SYSTEM_PROMPT = `És o motor de interpretação do Grafictrader.
Recebes métricas calculadas pelo código a partir de OHLCV, trades e/ou order book.
O código calcula; tu interpretas. Não recalcules indicadores comuns e não inventes dados ausentes.

Objetivo: explicar qual mecanismo parece dominar o mercado AGORA, usando apenas a evidência recebida.
Não identifiques um algoritmo, instituição ou trader específico. Podes dizer que um padrão é "compatível com" fragmentação, absorção ou pressão de execução.
Não trates o resultado como certeza nem como recomendação financeira.
Distingue claramente:
- OBSERVAÇÃO: o que os dados mostram;
- MECANISMO: a explicação estrutural mais compatível;
- CONFLITO: evidências que contradizem essa leitura;
- IMPLICAÇÃO: o que precisa ser confirmado no próximo fluxo;
- LIMITAÇÃO: dados que faltam.

Responde em português de Angola, curto e técnico, neste formato:
MECANISMO: ...
OBSERVAÇÃO: ...
CONFLITO: ...
IMPLICAÇÃO: ...
LIMITAÇÃO: ...
CONFIANÇA: baixa/média/alta.`;

function extractText(data) {
  return data?.candidates?.flatMap(c => c?.content?.parts?.map(p => p?.text).filter(Boolean) || []).join('\n').trim() || '';
}

async function askGemini(payload, key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({
        contents:[{role:'user',parts:[{text:SYSTEM_PROMPT+'\\n\\nDADOS DO MERCADO:\\n'+JSON.stringify(payload)}]}],
        generationConfig:{temperature:0.15,maxOutputTokens:700}
      })
    }
  );
  const data=await response.json();
  if(!response.ok)throw new Error(data?.error?.message||'Falha no Gemini.');
  const text=extractText(data);
  if(!text)throw new Error('Gemini não devolveu interpretação.');
  return text;
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método não permitido.'});
  try{
    const key=process.env.GEMINI_API_KEY;
    if(!key)return res.status(503).json({ok:false,error:'GEMINI_API_KEY não configurada.',setupRequired:true});
    const body=req.body||{};
    if(!body.metrics||!body.state)return res.status(400).json({ok:false,error:'Dados mecânicos insuficientes.'});
    const payload={
      symbol:body.symbol,
      interval:body.interval,
      state:body.state,
      metrics:body.metrics,
      evidence:body.evidence||{},
      dataQuality:body.dataQuality||{},
      limitations:body.limitations||[]
    };
    const interpretation=await askGemini(payload,key);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({ok:true,provider:'Gemini',updatedAt:new Date().toISOString(),interpretation});
  }catch(error){
    console.error('[Mechanics AI]',error?.message||error);
    return res.status(502).json({ok:false,error:'A interpretação mecânica por IA está indisponível.'});
  }
}
