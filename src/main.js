import { createChart, CandlestickSeries } from 'lightweight-charts';
import { createIcons, ArrowLeft, Settings, Radio, Sparkles, Plus, Camera, TrendingUp, TrendingDown } from 'lucide';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
<div class="shell">
  <header class="topbar">
    <button class="icon-btn" id="backBtn" aria-label="Voltar"><i data-lucide="arrow-left" aria-hidden="true"></i></button>
    <div class="title-wrap"><h1 id="pageTitle">Live</h1><span id="pageSub">Mercado em tempo real</span></div>
    <button class="icon-btn" id="settings" aria-label="Definições"><i data-lucide="settings" aria-hidden="true"></i></button>
  </header>

  <main>
    <section id="live" class="screen active">
      <div class="feed-head">
        <div class="avatar" aria-label="Grafictrader">G</div>
        <div><b>Grafictrader AI</b><span>dados de mercado em tempo real</span></div>
        <span class="live-dot" id="connection">A LIGAR</span>
      </div>

      <div class="hero-card live-card">
        <div class="asset-bar">
          <div class="asset-select-wrap">
            <span class="mini-label">ATIVO</span>
            <select id="assetSelect" aria-label="Escolher ativo">
              <option value="BTCUSDT">BTC/USDT</option>
              <option value="ETHUSDT">ETH/USDT</option>
              <option value="BNBUSDT">BNB/USDT</option>
              <option value="SOLUSDT">SOL/USDT</option>
              <option value="XRPUSDT">XRP/USDT</option>
              <option value="ADAUSDT">ADA/USDT</option>
              <option value="DOGEUSDT">DOGE/USDT</option>
            </select>
          </div>
          <div class="asset-price"><strong id="price">—</strong><span id="change">—</span></div>
        </div>
        <div class="market-meta"><span id="exchange">Binance</span><span>•</span><span id="intervalLabel">5 minutos</span><span>•</span><span id="streamState">A aguardar dados</span></div>
        <div id="chart"></div>
        <div class="tf">
          <button data-interval="1m">1m</button><button class="active" data-interval="5m">5m</button><button data-interval="15m">15m</button><button data-interval="1h">1h</button><button data-interval="4h">4h</button>
        </div>
      </div>

      <div class="reaction-row">
        <span class="metric trend-metric"><i id="trendIcon" data-lucide="trending-up" aria-hidden="true"></i><b id="trend">A analisar…</b></span>
        <span class="metric">RSI <b id="rsi">—</b></span>
        <span class="metric">ESTRUTURA <b id="structure">—</b></span>
      </div>

      <article class="insight">
        <div class="insight-icon"><i data-lucide="sparkles" aria-hidden="true"></i></div>
        <div><b>Grafictrader AI · LIVE</b><p id="liveInsight">Escolhe um ativo e timeframe. O gráfico recebe novas cotações automaticamente enquanto a ligação estiver ativa.</p></div>
      </article>
      <article class="live-result" id="liveResult">
        <div class="analysis-head"><b>Leitura do mercado</b><span>AO VIVO</span></div>
        <div class="live-summary" id="liveSummary">A aguardar dados suficientes para gerar a leitura.</div>
        <div class="scenario-grid">
          <div><b>CENÁRIO A</b><span id="liveScenarioA">Continuação da estrutura atual após confirmação.</span></div>
          <div><b>CENÁRIO B</b><span id="liveScenarioB">Reversão se a estrutura perder o suporte relevante.</span></div>
        </div>
        <div class="live-foot"><span>RSI <b id="liveRsiState">—</b></span><span>ESTRUTURA <b id="liveStructureState">—</b></span><span>LEITURA <b id="liveConfidence">—</b></span></div>
      </article>
      <p class="note">Dados públicos da Binance · sem execução de ordens.</p>
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
          <div class="guide"><div class="guide-corners"></div><b>Enquadra o gráfico inteiro</b><span>Candles · preço · timeframe · indicadores</span></div>
          <div class="camera-status" id="cameraStatus">CÂMERA PRONTA</div>
        </div>
        <div class="photo-controls">
          <button class="secondary-btn" id="startCam">Abrir câmera</button>
          <button class="primary-btn" id="snap" disabled><i data-lucide="camera" aria-hidden="true"></i> Capturar</button>
        </div>
      </div>
      <div id="analysis" class="analysis hidden"></div>
      <p class="note">A IA descreve o que é visível no gráfico; não garante resultados.</p>
    </section>
  </main>

  <nav class="bottom-nav" aria-label="Modo">
    <button class="nav-btn" data-mode="foto"><span class="nav-icon"><i data-lucide="plus" aria-hidden="true"></i></span><small>FOTO</small></button>
    <button class="nav-btn active" data-mode="live"><span class="nav-icon live-icon"><i data-lucide="radio" aria-hidden="true"></i></span><small>LIVE</small></button>
  </nav>
</div>`;

const chartEl = document.querySelector('#chart');
const chart = createChart(chartEl, {
  layout:{background:{color:'#0b1118'},textColor:'#7f8c9b'},
  grid:{vertLines:{color:'#18222d'},horzLines:{color:'#18222d'}},
  rightPriceScale:{borderColor:'#25313e',textColor:'#8f9baa'},
  timeScale:{borderColor:'#25313e',timeVisible:true},
  crosshair:{mode:1,vertLine:{color:'#405061',width:1,labelBackgroundColor:'#1c2733'},horzLine:{color:'#405061',width:1,labelBackgroundColor:'#1c2733'}},
  width:chartEl.clientWidth,height:340
});
const series = chart.addSeries(CandlestickSeries,{
  upColor:'#16a34a',downColor:'#ef4444',borderUpColor:'#16a34a',borderDownColor:'#ef4444',
  wickUpColor:'#16a34a',wickDownColor:'#ef4444'
});

let symbol='BTCUSDT';
let interval='5m';
let marketData=[];
let dayChange=null;
let ws=null;
let reconnectTimer=null;
let pollTimer=null;

const fmtPrice = value => '$'+Number(value).toLocaleString('en-US',{maximumFractionDigits:Number(value)<10?4:2});
const intervalNames = { '1m':'1 minuto','5m':'5 minutos','15m':'15 minutos','1h':'1 hora','4h':'4 horas' };

async function loadMarket(){
  clearTimeout(pollTimer);
  marketData=[];
  series.setData([]);
  const [data,ticker]=await Promise.all([
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=180`,{cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('Falha ao obter dados');
      return r.json();
    }),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,{cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('Falha ao obter ticker');
      return r.json();
    })
  ]);
  dayChange=Number(ticker.priceChangePercent);
  marketData=data;
  series.setData(data.map(k=>({time:k[0]/1000,open:+k[1],high:+k[2],low:+k[3],close:+k[4]})));
    updateMetrics(+data.at(-1)[4],data);
  document.querySelector('#streamState').textContent='Dados carregados';
  schedulePoll();
}

function schedulePoll(){
  pollTimer=setTimeout(async()=>{
    try{
      const data=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=2`,{cache:'no-store'}).then(r=>r.json());
      const k=data.at(-1);
      if(k){
        const candle={time:k[0]/1000,open:+k[1],high:+k[2],low:+k[3],close:+k[4]};
        series.update(candle);
        const idx=marketData.findIndex(x=>+x[0]===+k[0]);
        if(idx>=0) marketData[idx]=k; else marketData.push(k);
        updateMetrics(+k[4],marketData);
      }
    }catch{}
    schedulePoll();
  },5000);
}

function updateMetrics(price,data){
  document.querySelector('#price').textContent=fmtPrice(price);
  const closes=data.map(x=>+x[4]).slice(-60);
  const first=closes[0] ?? price;
  const change=Number.isFinite(dayChange)?dayChange:(first?((price-first)/first)*100:0);
  const changeEl=document.querySelector('#change');
  changeEl.textContent=(change>=0?'+':'')+change.toFixed(2)+'%';
  changeEl.classList.toggle('positive',change>=0);
  changeEl.classList.toggle('negative',change<0);
  const delta=closes.length>20?closes.at(-1)-closes.at(-20):0;
  const up=delta>=0;
  const trendEl=document.querySelector('#trend');
  const structureEl=document.querySelector('#structure');
  trendEl.textContent=up?'Alta':'Baixa';
  const trendIcon=document.querySelector('#trendIcon');
  trendIcon.setAttribute('data-lucide',up?'trending-up':'trending-down');
  createIcons({icons:{TrendingUp,TrendingDown},attrs:{'aria-hidden':'true'}});
  trendEl.classList.toggle('positive',up);
  trendEl.classList.toggle('negative',!up);
  structureEl.textContent=up?'Higher highs':'Lower highs';
  structureEl.classList.toggle('positive',up);
  structureEl.classList.toggle('negative',!up);
  const gains=[],losses=[];
  for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1];gains.push(Math.max(d,0));losses.push(Math.max(-d,0));}
  const ag=gains.slice(-14).reduce((a,b)=>a+b,0)/Math.max(gains.slice(-14).length,1);
  const al=losses.slice(-14).reduce((a,b)=>a+b,0)/Math.max(losses.slice(-14).length,1);
  const rsi=al===0?100:100-(100/(1+ag/al));
  const rsiEl=document.querySelector('#rsi');
  rsiEl.textContent=rsi.toFixed(1);
  rsiEl.classList.toggle('positive',rsi>=50 && rsi<70);
  rsiEl.classList.toggle('negative',rsi<50);
  rsiEl.classList.toggle('oversold',rsi<30);
  rsiEl.classList.toggle('overbought',rsi>70);
  const rsiState=rsi>=70?'Sobrecompra':rsi<=30?'Sobrevenda':rsi>=50?'Zona positiva':'Zona negativa';
  const structureState=up?'Higher highs':'Lower highs';
  const confidence=closes.length>=30?'Média':'Baixa';
  document.querySelector('#liveInsight').textContent=up?'A estrutura recente favorece alta; confirma com as próximas velas e respeita o contexto do timeframe.':'A estrutura recente favorece baixa; confirma com as próximas velas antes de interpretar uma reversão.';
  document.querySelector('#liveSummary').textContent=up?'Preço com impulso recente de alta. A leitura fica mais frágil se o RSI estiver esticado ou se a estrutura perder o último suporte.':'Preço com pressão recente de baixa. A leitura fica mais frágil se o preço recuperar a última resistência e formar máximos ascendentes.';
  document.querySelector('#liveScenarioA').textContent=up?'Continuação da alta se o preço mantiver a estrutura e superar a resistência local.':'Continuação da baixa se o preço mantiver máximos/mínimos descendentes e perder o suporte local.';
  document.querySelector('#liveScenarioB').textContent=up?'Correção/reversão se perder o suporte local ou a estrutura mudar para máximos descendentes.':'Recuperação se recuperar a resistência local e a estrutura passar para máximos ascendentes.';
  document.querySelector('#liveRsiState').textContent=rsiState+' · '+rsi.toFixed(1);
  document.querySelector('#liveStructureState').textContent=structureState;
  document.querySelector('#liveConfidence').textContent=confidence;
}

function closeSocket(){
  if(ws){ws.onclose=null;ws.onerror=null;ws.close();ws=null;}
  clearTimeout(reconnectTimer);
}
function connectSocket(){
  closeSocket();
  const streamName=`${symbol.toLowerCase()}@kline_${interval}`;
  ws=new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);
  ws.onopen=()=>{
    document.querySelector('#connection').textContent='LIVE';
    document.querySelector('#streamState').textContent='Ligação em tempo real';
    document.querySelector('#connection').classList.add('connected');
  };
  ws.onmessage=e=>{
    const k=JSON.parse(e.data).k;
    if(!k)return;
    const candle={time:k.t/1000,open:+k.o,high:+k.h,low:+k.l,close:+k.c};
    series.update(candle);
    const idx=marketData.findIndex(x=>+x[0]===+k.t);
    const row=[k.t,k.o,k.h,k.l,k.c];
    if(idx>=0) marketData[idx]=row; else marketData.push(row);
    updateMetrics(+k.c,marketData);
    document.querySelector('#streamState').textContent=k.x?'Vela fechada · ao vivo':'Vela em formação · ao vivo';
  };
  ws.onerror=()=>{
    document.querySelector('#connection').textContent='A RECONECTAR';
    document.querySelector('#connection').classList.remove('connected');
  };
  ws.onclose=()=>{
    document.querySelector('#connection').textContent='A RECONECTAR';
    document.querySelector('#connection').classList.remove('connected');
    reconnectTimer=setTimeout(connectSocket,3000);
  };
}

async function selectMarket(){
  document.querySelector('#connection').textContent='A LIGAR';
  document.querySelector('#connection').classList.remove('connected');
  document.querySelector('#intervalLabel').textContent=intervalNames[interval];
  document.querySelector('#assetSelect').value=symbol;
  closeSocket();
  try{await loadMarket();connectSocket();}catch(e){
    document.querySelector('#connection').textContent='SEM DADOS';
    document.querySelector('#streamState').textContent='Verifica a ligação à internet';
    schedulePoll();
  }
}

createIcons({icons:{ArrowLeft,Settings,Radio,Sparkles,Plus,Camera,TrendingUp,TrendingDown}});

document.querySelector('#settings').onclick=()=>{
  const btn=document.querySelector('#settings');
  const active=btn.classList.toggle('active');
  btn.setAttribute('aria-pressed',String(active));
  document.querySelector('#liveInsight').textContent=active?'Definições rápidas: os dados são apenas leitura e nenhuma ordem é executada.':'Escolhe um ativo e timeframe. O gráfico recebe novas cotações automaticamente enquanto a ligação estiver ativa.';
};

document.querySelector('#assetSelect').onchange=e=>{symbol=e.target.value;selectMarket();};
document.querySelectorAll('.tf button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tf button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  interval=b.dataset.interval;
  selectMarket();
});
selectMarket();

let stream;
document.querySelector('#startCam').onclick=async()=>{
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    document.querySelector('#video').srcObject=stream;
    document.querySelector('#snap').disabled=false;
    document.querySelector('#cameraStatus').textContent='CÂMERA ATIVA';
    document.querySelector('.camera').classList.add('active');
  }catch(e){document.querySelector('.camera-status').textContent='CÂMERA BLOQUEADA';alert('Permite o acesso à câmera para usar FOTO.');}
};

document.querySelector('#snap').onclick=async()=>{
  const video=document.querySelector('#video'),canvas=document.createElement('canvas');
  canvas.width=video.videoWidth||1280;canvas.height=video.videoHeight||720;
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  const image=canvas.toDataURL('image/jpeg',0.82),a=document.querySelector('#analysis'),photoCard=document.querySelector('.photo-card');
  a.classList.remove('hidden');photoCard.classList.add('captured');
  a.innerHTML='<div class="analysis-head"><b>Grafictrader AI</b><span>PROCESSANDO</span></div><div class="analysis-loading"><div class="loading-dot"></div><b>A ler o gráfico…</b><span>Tendência · estrutura · níveis · indicadores · cenários</span></div>';
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})}),data=await r.json();
    if(!r.ok)throw new Error(data.error||'Falha na análise');
    a.innerHTML=renderPhotoResult(image,parseAnalysis(String(data.analysis||'')));
    document.querySelector('#retryPhoto').onclick=()=>{a.classList.add('hidden');photoCard.classList.remove('captured');document.querySelector('#cameraStatus').textContent='CÂMERA ATIVA';};
  }catch(e){
    a.innerHTML='<div class="analysis-head"><b>Grafictrader AI</b><span>ERRO</span></div><p class="analysis-empty">'+escapeHtml(e.message)+'</p><button class="secondary-btn retry-btn" id="retryPhoto">Tentar novamente</button><div class="tag">Verifica a configuração do servidor</div>';
    document.querySelector('#retryPhoto').onclick=()=>{a.classList.add('hidden');photoCard.classList.remove('captured');};
  }
};
function parseAnalysis(raw){
  const labels=['RESUMO','TENDÊNCIA','ESTRUTURA','NÍVEIS','INDICADORES','CENÁRIO A','CENÁRIO B','RISCO','CONFIANÇA VISUAL'],result={raw},lines=raw.split(/\r?\n/);let current=null;
  labels.forEach(x=>result[x]='Não identificado na imagem.');
  lines.forEach(line=>{const match=line.match(/^\s*([^:]+):\s*(.*)$/);if(!match)return;const label=match[1].trim().toUpperCase();if(labels.includes(label)){current=label;result[label]=match[2].trim()||'Não identificado na imagem.';}else if(current){result[current]+=' '+line.trim();}});
  return result;
}
function renderPhotoResult(image,p){
  const cards=[['TENDÊNCIA',p['TENDÊNCIA']],['ESTRUTURA',p['ESTRUTURA']],['NÍVEIS',p['NÍVEIS']],['INDICADORES',p['INDICADORES']],['CENÁRIO A',p['CENÁRIO A']],['CENÁRIO B',p['CENÁRIO B']],['RISCO',p['RISCO']],['CONFIANÇA VISUAL',p['CONFIANÇA VISUAL']]];
  return '<div class="analysis-head"><b>Grafictrader AI</b><span>ANÁLISE CONCLUÍDA</span></div><div class="captured-preview"><img src="'+image+'" alt="Gráfico capturado"><div><b>Imagem analisada</b><span>Leitura multimodal da captura</span></div></div><div class="analysis-summary"><small>RESUMO</small><strong>'+escapeHtml(p.RESUMO)+'</strong></div><div class="analysis-result">'+cards.map(([title,value])=>'<div class="analysis-section"><b>'+title+'</b><span>'+escapeHtml(value)+'</span></div>').join('')+'</div><button class="secondary-btn retry-btn" id="retryPhoto">Nova análise</button><div class="tag">Análise multimodal ativa · sem garantia de resultado</div>';
}

function escapeHtml(value){return String(value).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}

function setMode(mode){
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelector('#'+mode).classList.add('active');
  document.querySelector('#pageTitle').textContent=mode==='live'?'Live':'Foto';
  document.querySelector('#pageSub').textContent=mode==='live'?'Mercado em tempo real':'Captura e análise por IA';
  if(mode==='live') setTimeout(()=>chart.applyOptions({width:chartEl.clientWidth}),30);
}
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelector('#backBtn').onclick=()=>setMode('live');
window.addEventListener('resize',()=>chart.applyOptions({width:chartEl.clientWidth}));
