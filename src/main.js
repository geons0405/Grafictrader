import { createChart, CandlestickSeries } from 'lightweight-charts';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
<div class="shell">
  <header class="topbar">
    <button class="icon-btn" id="backBtn" aria-label="Voltar">‹</button>
    <div class="title-wrap">
      <h1 id="pageTitle">Live</h1>
      <span id="pageSub">Análise de mercado</span>
    </div>
    <button class="icon-btn" id="settings" aria-label="Definições">⌾</button>
  </header>

  <main>
    <section id="live" class="screen active">
      <div class="feed-head">
        <div class="avatar">G</div>
        <div><b>Grafictrader AI</b><span>mercado em tempo real</span></div>
        <span class="live-dot">LIVE</span>
      </div>

      <div class="hero-card live-card">
        <div class="card-top">
          <div><strong>BTC/USDT</strong><span>Binance · 5 minutos</span></div>
          <strong id="price">—</strong>
        </div>
        <div id="chart"></div>
        <div class="tf">
          <button>1m</button><button class="active">5m</button><button>15m</button><button>1h</button><button>4h</button>
        </div>
      </div>

      <div class="reaction-row">
        <span>◉ <b id="trend">A analisar…</b></span>
        <span>RSI <b id="rsi">—</b></span>
        <span>ESTRUTURA <b id="structure">—</b></span>
      </div>

      <article class="insight">
        <div class="insight-icon">✦</div>
        <div><b>Grafictrader AI</b><p id="liveInsight">A acompanhar o mercado. A análise automática será executada por períodos.</p></div>
      </article>
      <p class="note">Dados públicos em tempo real · sem execução de ordens.</p>
    </section>

    <section id="foto" class="screen">
      <div class="feed-head">
        <div class="avatar">G</div>
        <div><b>Foto do gráfico</b><span>captura e análise por IA</span></div>
      </div>

      <div class="hero-card photo-card">
        <div class="camera">
          <video id="video" autoplay playsinline></video>
          <div class="camera-shade"></div>
          <div class="guide">
            <div class="guide-corners"></div>
            <b>Enquadra o gráfico inteiro</b>
            <span>Candles · preço · timeframe · indicadores</span>
          </div>
          <div class="camera-status" id="cameraStatus">CÂMERA PRONTA</div>
        </div>
        <div class="photo-controls">
          <button class="secondary-btn" id="startCam">Abrir câmera</button>
          <button class="primary-btn" id="snap" disabled><span>●</span> Capturar</button>
        </div>
      </div>

      <div id="analysis" class="analysis hidden"></div>
      <p class="note">A IA descreve o que é visível no gráfico; não garante resultados.</p>
    </section>
  </main>

  <nav class="bottom-nav" aria-label="Modo">
    <button class="nav-btn" data-mode="foto"><span class="nav-icon">＋</span><small>FOTO</small></button>
    <button class="nav-btn active" data-mode="live"><span class="nav-icon live-icon">◉</span><small>LIVE</small></button>
  </nav>
</div>`;

const chartEl = document.querySelector('#chart');
const chart = createChart(chartEl, {
  layout:{background:{color:'#0a0d11'},textColor:'#858e9d'},
  grid:{vertLines:{color:'#151a21'},horzLines:{color:'#151a21'}},
  rightPriceScale:{borderColor:'#1e2530'},
  timeScale:{borderColor:'#1e2530',timeVisible:true},
  width:chartEl.clientWidth,
  height:330
});
const series = chart.addSeries(CandlestickSeries,{
  upColor:'#f4f7fb',downColor:'#596474',borderVisible:false,
  wickUpColor:'#f4f7fb',wickDownColor:'#596474'
});

let marketData = [];
async function loadMarket(){
  const data=await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=180').then(r=>r.json());
  marketData=data;
  series.setData(data.map(k=>({time:k[0]/1000,open:+k[1],high:+k[2],low:+k[3],close:+k[4]})));
  const last=data.at(-1);
  updateMetrics(+last[4],data);
}
function updateMetrics(price,data){
  document.querySelector('#price').textContent='$'+price.toLocaleString('en-US',{maximumFractionDigits:2});
  const closes=data.map(x=>+x[4]);
  const delta=closes.at(-1)-closes.at(-20);
  const up=delta>=0;
  document.querySelector('#trend').textContent=up?'Alta':'Baixa';
  document.querySelector('#structure').textContent=up?'Higher highs':'Lower highs';
  const gains=[],losses=[];
  for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1];gains.push(Math.max(d,0));losses.push(Math.max(-d,0));}
  const ag=gains.slice(-14).reduce((a,b)=>a+b,0)/14;
  const al=losses.slice(-14).reduce((a,b)=>a+b,0)/14;
  const rsi=al===0?100:100-(100/(1+ag/al));
  document.querySelector('#rsi').textContent=rsi.toFixed(1);
  document.querySelector('#liveInsight').textContent=up
    ? 'Estrutura recente positiva. Confirmação depende das próximas velas e do contexto do timeframe.'
    : 'Estrutura recente negativa. Aguarda confirmação antes de interpretar uma reversão.';
}
loadMarket().catch(()=>document.querySelector('#trend').textContent='Sem dados');

const ws=new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_5m');
ws.onmessage=e=>{
  const k=JSON.parse(e.data).k;if(!k)return;
  series.update({time:k.t/1000,open:+k.o,high:+k.h,low:+k.l,close:+k.c});
  document.querySelector('#price').textContent='$'+(+k.c).toLocaleString('en-US',{maximumFractionDigits:2});
  if(marketData.length){
    const last=marketData.at(-1);
    if(last && +last[0]===k.t) marketData[marketData.length-1]=[k.t,k.o,k.h,k.l,k.c];
  }
};

document.querySelectorAll('.tf button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tf button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
});

let stream;
document.querySelector('#startCam').onclick=async()=>{
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    document.querySelector('#video').srcObject=stream;
    document.querySelector('#snap').disabled=false;
    document.querySelector('#cameraStatus').textContent='CÂMERA ATIVA';
  }catch(e){alert('Permite o acesso à câmera para usar FOTO.');}
};

document.querySelector('#snap').onclick=async()=>{
  const video=document.querySelector('#video');
  const canvas=document.createElement('canvas');
  canvas.width=video.videoWidth||1280; canvas.height=video.videoHeight||720;
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  const image=canvas.toDataURL('image/jpeg',0.82);
  const a=document.querySelector('#analysis');
  a.classList.remove('hidden');
  a.innerHTML='<h3>Análise da imagem</h3><p>A enviar o gráfico para a IA…</p>';
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Falha na análise');
    a.innerHTML='<div class="analysis-head"><b>Grafictrader AI</b><span>ANÁLISE</span></div><pre>'+escapeHtml(data.analysis)+'</pre><div class="tag">Análise multimodal ativa</div>';
  }catch(e){
    a.innerHTML='<h3>Análise da imagem</h3><p>'+escapeHtml(e.message)+'</p><div class="tag">Configuração do servidor necessária</div>';
  }
};
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function setMode(mode){
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelector('#'+mode).classList.add('active');
  document.querySelector('#pageTitle').textContent=mode==='live'?'Live':'Foto';
  document.querySelector('#pageSub').textContent=mode==='live'?'Análise de mercado':'Captura e análise por IA';
  if(mode==='live') setTimeout(()=>chart.applyOptions({width:chartEl.clientWidth}),30);
}
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelector('#backBtn').onclick=()=>setMode('live');
window.addEventListener('resize',()=>chart.applyOptions({width:chartEl.clientWidth}));
