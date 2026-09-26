export function calculateMarketEntropy(candles) {
  if (!Array.isArray(candles) || candles.length < 8) return { value: null, orderliness: null };
  const closes = candles.map(c=>Number(c.close)).filter(Number.isFinite);
  if (closes.length < 8) return { value: null, orderliness: null };
  const dirs = [];
  for (let i=1;i<closes.length;i++) {
    const d=Math.sign(closes[i]-closes[i-1]);
    dirs.push(d);
  }
  const counts = { up: dirs.filter(d=>d>0).length, down: dirs.filter(d=>d<0).length, flat: dirs.filter(d=>d===0).length };
  const n = dirs.length || 1;
  const probs = [counts.up/n, counts.down/n, counts.flat/n].filter(p=>p>0);
  const h = -probs.reduce((sum,p)=>sum+p*Math.log2(p),0);
  const maxH = Math.log2(3);
  const entropy = maxH ? h/maxH : 0;
  return { value: entropy, orderliness: 1-entropy };
}