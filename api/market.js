const BINANCE_BASE='https://api.binance.com/api/v3';

async function json(path){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch(BINANCE_BASE+path,{signal:controller.signal,cache:'no-store'});
    const data=await r.json();
    if(!r.ok)throw new Error(data?.msg||`Binance HTTP ${r.status}`);
    return data;
  }finally{clearTimeout(timer);}
}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método não permitido.'});
  const symbol=String(req.query?.symbol||'BTCUSDT').toUpperCase();
  const interval=String(req.query?.interval||'5m');
  const allowed=['1m','5m','15m','1h','4h'];
  if(!/^[A-Z0-9]{6,12}$/.test(symbol)||!allowed.includes(interval))return res.status(400).json({ok:false,error:'Parâmetros inválidos.'});
  try{
    const [ticker,klines]=await Promise.all([
      json('/ticker/24hr?symbol='+encodeURIComponent(symbol)),
      json('/klines?'+new URLSearchParams({symbol,interval,limit:'120'}))
    ]);
    res.setHeader('Cache-Control','s-maxage=5, stale-while-revalidate=10');
    return res.status(200).json({
      ok:true,symbol,interval,updatedAt:new Date().toISOString(),
      ticker:{price:Number(ticker.last),change24h:Number(ticker.priceChangePercent),volume24h:Number(ticker.quoteVolume),high24h:Number(ticker.highPrice),low24h:Number(ticker.lowPrice)},
      candles:klines.map(k=>({time:k[0]/1000,open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5])}))
    });
  }catch(error){
    return res.status(502).json({ok:false,error:error?.message||'Mercado indisponível'});
  }
}
