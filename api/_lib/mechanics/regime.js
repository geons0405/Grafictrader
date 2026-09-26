const safeStd = values => {
  if (!values.length) return 0;
  const mean = values.reduce((a,b)=>a+b,0)/values.length;
  return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length);
};

export function calculateRegime(candles) {
  if (!Array.isArray(candles) || candles.length < 20) return { state: 'insufficient_data', change: null, stability: null };
  const closes = candles.map(c=>Number(c.close)).filter(Number.isFinite);
  if (closes.length < 20) return { state: 'insufficient_data', change: null, stability: null };
  const returns = closes.slice(1).map((c,i)=>closes[i] ? (c-closes[i])/closes[i] : 0);
  const split = Math.floor(returns.length/2);
  const a = returns.slice(0,split), b = returns.slice(split);
  const meanA = a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const meanB = b.reduce((x,y)=>x+y,0)/Math.max(1,b.length);
  const volA = safeStd(a), volB = safeStd(b);
  const meanScale = Math.max(1e-9, safeStd(returns));
  const change = Math.min(1, (Math.abs(meanB-meanA)/meanScale + Math.abs(volB-volA)/meanScale) / 2);
  const state = change >= 0.65 ? 'changed' : change >= 0.30 ? 'transition' : 'stable';
  return { state, change, stability: 1-change };
}