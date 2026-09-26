export function calculateLiquidityMemory(candles) {
  if (!Array.isArray(candles) || candles.length < 20) return { value:null, zones:[], evidence:'insufficient_data' };
  const rows=candles.map(c=>({high:Number(c.high),low:Number(c.low),close:Number(c.close)}))
    .filter(c=>Object.values(c).every(Number.isFinite));
  if(rows.length<20)return{value:null,zones:[],evidence:'insufficient_data'};
  const min=Math.min(...rows.map(r=>r.low)), max=Math.max(...rows.map(r=>r.high));
  const span=max-min;
  if(!(span>0))return{value:0,zones:[],evidence:'flat_market'};
  const bins=12, counts=Array(bins).fill(0), reactions=Array(bins).fill(0);
  rows.forEach((r,i)=>{
    const prices=[r.high,r.low,r.close];
    prices.forEach(p=>{const idx=Math.max(0,Math.min(bins-1,Math.floor((p-min)/span*bins)));counts[idx]++;});
    if(i>0){
      const prev=rows[i-1];
      const move=Math.abs(r.close-prev.close);
      const range=Math.max(r.high-r.low,1e-12);
      if(move/range<0.35){
        const idx=Math.max(0,Math.min(bins-1,Math.floor((r.close-min)/span*bins)));
        reactions[idx]++;
      }
    }
  });
  const maxScore=Math.max(...counts.map((c,i)=>c+reactions[i]*2),1);
  const zones=counts.map((count,i)=>({i,count,reactions:reactions[i],score:(count+reactions[i]*2)/maxScore}))
    .filter(z=>z.score>=0.45)
    .map(z=>({price:min+(z.i+0.5)*span/bins,score:z.score,reactions:z.reactions}));
  const value=zones.length?Math.max(...zones.map(z=>z.score)):0;
  return{value,zones,evidence:'ohlcv_liquidity_proxy'};
}