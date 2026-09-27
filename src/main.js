import { createChart, CandlestickSeries } from 'lightweight-charts';
import { createIcons, ArrowLeft, Settings, Radio, Sparkles, Plus, Camera, TrendingUp, TrendingDown, ArrowRight, LogIn, UserPlus, Home } from 'lucide';
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
    <section id="home" class="screen landing-screen active">
      <div class="landing-brand">
        <div class="landing-mark">G</div>
        <span>GRAFICTRADER</span>
      </div>
      <div class="landing-hero">
        <span class="eyebrow">AI MARKET INTELLIGENCE</span>
        <h2>Entende o mercado.<br><em>Não apenas o gráfico.</em></h2>
        <p>Analisa gráficos com IA, acompanha o mercado em tempo real e transforma dados em contexto mecânico.</p>
      </div>
      <div class="landing-preview">
        <div class="preview-top"><span>BTC/USDT</span><b>LIVE</b></div>
        <div class="preview-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="preview-insight"><span>GRAFICTRADER AI</span><strong>Leitura estrutural ativa</strong></div>
      </div>
      <div class="landing-actions">
        <button class="primary-btn landing-primary" id="landingLogin"><i data-lucide="log-in"></i> Entrar</button>
        <button class="secondary-btn landing-secondary" id="landingRegister"><i data-lucide="user-plus"></i> Criar conta</button>
      </div>
      <p class="landing-note">Acesso à plataforma · análise de mercado · sem execução automática de ordens.</p>
    </section>

    <section id="login" class="screen auth-screen">
      <div class="auth-card">
        <button class="auth-back" data-route="home"><i data-lucide="arrow-left"></i><span>Voltar</span></button>
        <div class="auth-brand"><div class="landing-mark">G</div><span>GRAFICTRADER</span></div>
        <span class="eyebrow">BEM-VINDO DE VOLTA</span>
        <h2>Entrar na sua conta</h2>
        <p class="auth-copy">Acede ao teu espaço de análise e continua a acompanhar o mercado.</p>
        <form id="loginForm" class="auth-form">
          <label>Email<input type="email" id="loginEmail" placeholder="nome@email.com" autocomplete="email" required></label>
          <label>Palavra-passe<input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password" required></label>
          <button class="primary-btn" type="submit">Entrar <i data-lucide="arrow-right"></i></button>
        </form>
        <p class="auth-switch">Ainda não tens conta? <button type="button" data-route="register">Criar conta</button></p>
        <p class="auth-message" id="loginMessage"></p>
      </div>
    </section>

    <section id="register" class="screen auth-screen">
      <div class="auth-card">
        <button class="auth-back" data-route="home"><i data-lucide="arrow-left"></i><span>Voltar</span></button>
        <div class="auth-brand"><div class="landing-mark">G</div><span>GRAFICTRADER</span></div>
        <span class="eyebrow">COMEÇA AGORA</span>
        <h2>Criar a tua conta</h2>
        <p class="auth-copy">Cria o teu espaço Grafictrader para guardar preferências e acompanhar as tuas análises.</p>
        <form id="registerForm" class="auth-form">
          <label>Nome<input type="text" id="registerName" placeholder="O teu nome" autocomplete="name" required></label>
          <label>Email<input type="email" id="registerEmail" placeholder="nome@email.com" autocomplete="email" required></label>
          <label>Palavra-passe<input type="password" id="registerPassword" placeholder="Mínimo 8 caracteres" minlength="8" autocomplete="new-password" required></label>
          <button class="primary-btn" type="submit">Criar conta <i data-lucide="arrow-right"></i></button>
        </form>
        <p class="auth-switch">Já tens conta? <button type="button" data-route="login">Entrar</button></p>
        <p class="auth-message" id="registerMessage"></p>
      </div>
    </section>

    <section id="live" class="screen">
      <div class="feed-head">
        <div class="avatar" aria-label="Grafictrader">G</div>
        <div><b>Grafictrader AI</b><span>dados de mercado em tempo real</span></div>
        <span class="live-dot" id="connection">A LIGAR</span>
      </div>

      <div class="live-stage" id="liveStage">
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

        <article class="live-result" id="liveResult">
        <div class="analysis-head">
          <div class="result-title"><div class="insight-icon"><i data-lucide="sparkles" aria-hidden="true"></i></div><b>Leitura do mercado</b></div>
          <span>AO VIVO</span>
        </div>
        <div class="live-result-scroll" id="liveResultScroll">
          <div class="result-metrics">
            <span class="result-metric trend-metric"><i id="trendIcon" data-lucide="trending-up" aria-hidden="true"></i><small>TENDÊNCIA</small><b id="trend">A analisar…</b></span>
            <span class="result-metric"><small>RSI</small><b id="rsi">—</b></span>
            <span class="result-metric"><small>ESTRUTURA</small><b id="structure">—</b></span>
          </div>
          <div class="live-ai">
            <div class="live-ai-label">Grafictrader AI · LIVE</div>
            <p id="liveInsight">Escolhe um ativo e timeframe. O gráfico recebe novas cotações automaticamente enquanto a ligação estiver ativa.</p>
          </div>
          <div class="live-summary" id="liveSummary">A aguardar dados suficientes para gerar a leitura.</div>
          <div class="scenario-grid">
            <div class="scenario-block">
              <b>CENÁRIO A</b>
              <span id="liveScenarioA">Continuação da estrutura atual após confirmação.</span>
            </div>
            <div class="scenario-block">
              <b>CENÁRIO B</b>
              <span id="liveScenarioB">Reversão se a estrutura perder o suporte relevante.</span>
            </div>
          </div>
          <div class="live-foot"><span>CONFIANÇA DA LEITURA <b id="liveConfidence">—</b></span></div>
        </div>
        </article>
      </div>
      <p class="note">Dados públicos de mercado · Binance Vision com fallback automático · sem execução de ordens.</p>
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
  layout:{background:{color:'#0b1118'},textColor:'#7f8c9b',attributionLogo:true},
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

let marketSource='';

async function fetchMarketApi(){
  const response=await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,{cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok) throw new Error(data.error||'Mercado indisponível');
  return data;
}

async function loadMarket(){
  clearTimeout(pollTimer);
  marketData=[];
  series.setData([]);
  const data=await fetchMarketApi();
  const candles=Array.isArray(data.candles)?data.candles:[];
  if(!candles.length) throw new Error('Nenhum candle disponível para este ativo.');
  marketSource=data.source||'Market data';
  dayChange=Number(data.ticker?.change24h);
  marketData=candles.map(k=>[k.time*1000,String(k.open),String(k.high),String(k.low),String(k.close)]);
  series.setData(candles.map(k=>({time:k.time,open:+k.open,high:+k.high,low:+k.low,close:+k.close})));
  updateMetrics(+candles.at(-1).close,marketData);
  document.querySelector('#exchange').textContent=marketSource;
  document.querySelector('#streamState').textContent=marketSource==='Binance'?'Dados carregados · Binance Vision':'Dados carregados · fallback '+marketSource;
  schedulePoll();
  return data;
}

function schedulePoll(){
  clearTimeout(pollTimer);
  pollTimer=setTimeout(async()=>{
    try{
      const data=await fetchMarketApi();
      const candles=Array.isArray(data.candles)?data.candles:[];
      const k=candles.at(-1);
      if(k){
        marketSource=data.source||marketSource;
        dayChange=Number(data.ticker?.change24h);
        const candle={time:k.time,open:+k.open,high:+k.high,low:+k.low,close:+k.close};
        series.update(candle);
        const idx=marketData.findIndex(x=>+x[0]===+k.time*1000);
        const row=[k.time*1000,String(k.open),String(k.high),String(k.low),String(k.close)];
        if(idx>=0) marketData[idx]=row; else marketData.push(row);
        updateMetrics(+k.close,marketData);
        document.querySelector('#exchange').textContent=marketSource;
        document.querySelector('#streamState').textContent=marketSource==='Binance'?'Dados atualizados · Binance Vision':'Dados atualizados · fallback '+marketSource;
      }
    }catch(error){
      document.querySelector('#streamState').textContent='Dados temporariamente indisponíveis · a tentar novamente';
    }
    if(document.querySelector('#live.active')) schedulePoll();
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
  document.querySelector('#liveConfidence').textContent=confidence;
  document.querySelector('#liveResult').classList.add('has-data');
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
  try{const data=await loadMarket();
    // O gráfico usa o endpoint server-side resiliente; evita depender do WebSocket
    // regional da Binance. A atualização por polling continua mesmo em fallback.
    closeSocket();
    document.querySelector('#connection').textContent=(data.source||'').toLowerCase().includes('binance')?'LIVE':'FALLBACK';
    document.querySelector('#connection').classList.add('connected');
  }catch(e){
    document.querySelector('#connection').textContent='SEM DADOS';
    document.querySelector('#streamState').textContent='Fontes de mercado indisponíveis · a tentar novamente';
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

let scrollFrame=null;
const liveStage=document.querySelector('#liveStage');
const liveCard=document.querySelector('.live-card');
const SHRINK_RANGE=200;
const MAX_CHART=340;
const MIN_CHART=250;
let livePhaseTwo=false;
let stageStickyOrigin=0;

function documentTop(el){
  let top=0,node=el;
  while(node){top+=node.offsetTop||0;node=node.offsetParent;}
  return top;
}

function captureStickyOrigins(){
  const topbar=document.querySelector('.topbar');
  const stickyTop=topbar?.offsetHeight||78;
  document.querySelectorAll('.hero-card').forEach(card=>{
    card.dataset.stickyOrigin=String(documentTop(card));
    card.style.setProperty('--sticky-top',stickyTop+'px');
  });
  if(liveStage){
    stageStickyOrigin=documentTop(liveStage);
    liveStage.style.setProperty('--sticky-top',stickyTop+'px');
  }
}

function resizeChartToContainer(){
  if(!chartEl?.clientWidth || !chartEl?.clientHeight)return;
  const width=Math.round(chartEl.clientWidth);
  const height=Math.max(MIN_CHART,Math.round(chartEl.clientHeight));
  chart.resize(width,height,true);
  series.priceScale().applyOptions({autoScale:true});
}

function setLivePhase(phaseTwo){
  if(!liveStage)return;
  livePhaseTwo=phaseTwo;
  liveStage.classList.toggle('result-phase-2',phaseTwo);
  const resultScroll=document.querySelector('#liveResultScroll');
  resultScroll?.classList.toggle('is-inner-scroll',phaseTwo);
  if(phaseTwo){
    // A fase 2 fica presa dentro do viewport; o scroll passa para o conteúdo.
    document.documentElement.classList.add('live-handoff');
    document.body.classList.add('live-handoff');
  }else{
    document.documentElement.classList.remove('live-handoff');
    document.body.classList.remove('live-handoff');
    if(resultScroll)resultScroll.scrollTop=0;
  }
}

function updateLiveLayout(){
  if(!liveStage || !liveCard || !document.querySelector('#live.active'))return;
  const topbar=document.querySelector('.topbar');
  const stickyTop=topbar?.offsetHeight||78;
  const start=Math.max(0,stageStickyOrigin-stickyTop);
  const progress=Math.min(Math.max((window.scrollY-start)/SHRINK_RANGE,0),1);
  const chartHeight=Math.round(MAX_CHART-(MAX_CHART-MIN_CHART)*progress);

  // Só o gráfico muda de altura. O resultado nunca recebe top/translateY
  // calculado por JS; o flexbox reposiciona-o automaticamente.
  liveStage.style.setProperty('--sticky-progress',progress.toFixed(3));
  chartEl.style.height=chartHeight+'px';

  const phaseTwo=progress>=1;
  if(phaseTwo!==livePhaseTwo)setLivePhase(phaseTwo);
  resizeChartToContainer();
}

function updateStickyCards(){
  if(scrollFrame)return;
  scrollFrame=requestAnimationFrame(()=>{
    document.querySelectorAll('.hero-card').forEach(card=>{
      if(card===liveCard)return;
      const topbar=document.querySelector('.topbar');
      const stickyTop=topbar?.offsetHeight||78;
      const origin=Number(card.dataset.stickyOrigin||documentTop(card));
      const start=Math.max(0,origin-stickyTop);
      const progress=Math.min(Math.max((window.scrollY-start)/180,0),1);
      card.style.setProperty('--sticky-progress',progress.toFixed(3));
      card.classList.toggle('is-compact',progress>=.02);
    });
    updateLiveLayout();
    scrollFrame=null;
  });
}

let touchStartY=null;

window.addEventListener('wheel',event=>{
  if(!livePhaseTwo)return;
  if(event.deltaY<0){
    setLivePhase(false);
    requestAnimationFrame(updateLiveLayout);
  }
},{passive:true});

window.addEventListener('touchstart',event=>{
  if(!livePhaseTwo || !event.touches[0])return;
  touchStartY=event.touches[0].clientY;
},{passive:true});

window.addEventListener('touchmove',event=>{
  if(!livePhaseTwo || touchStartY===null || !event.touches[0])return;
  const currentY=event.touches[0].clientY;
  const deltaY=currentY-touchStartY;
  const resultScroll=document.querySelector('#liveResultScroll');
  // Swipe para baixo no topo do conteúdo = regressar à fase 1.
  if(deltaY>12 && (!resultScroll || resultScroll.scrollTop<=0)){
    setLivePhase(false);
    touchStartY=null;
    requestAnimationFrame(updateLiveLayout);
  }
},{passive:true});

window.addEventListener('touchend',()=>{touchStartY=null;},{passive:true});

const chartResizeObserver=new ResizeObserver(entries=>{
  if(!entries[0])return;
  resizeChartToContainer();
});
chartResizeObserver.observe(chartEl);
window.addEventListener('scroll',updateStickyCards,{passive:true});
window.addEventListener('load',()=>{captureStickyOrigins();updateStickyCards();});
function setMode(mode){
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelector('#'+mode).classList.add('active');
  if(mode!=='live')setLivePhase(false);
  document.querySelector('#pageTitle').textContent=mode==='live'?'Live':'Foto';
  document.querySelector('#pageSub').textContent=mode==='live'?'Mercado em tempo real':'Captura e análise por IA';
  setTimeout(()=>{captureStickyOrigins();updateStickyCards();if(mode==='live')resizeChartToContainer();},30);
}
function hasAuthSession(){
  return sessionStorage.getItem('grafictrader.auth')==='1';
}
function showRoute(route){
  const allowed=['home','login','register','live','foto'];
  let target=allowed.includes(route)?route:'home';
  if((target==='live'||target==='foto')&&!hasAuthSession()) target='login';
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelector('#'+target)?.classList.add('active');
  document.body.classList.toggle('landing-view',target==='home');
  document.body.classList.toggle('auth-view',target==='login'||target==='register');
  document.querySelector('.topbar').style.display=(target==='home'||target==='login'||target==='register')?'none':'';
  document.querySelector('.bottom-nav').style.display=(target==='home'||target==='login'||target==='register')?'none':'';
  if(target==='live'||target==='foto') setMode(target);
  if(location.hash!=='#'+target) history.replaceState(null,'','#'+target);
  window.scrollTo(0,0);
  createIcons({icons:{ArrowLeft,Settings,Radio,Sparkles,Plus,Camera,TrendingUp,TrendingDown,ArrowRight,LogIn,UserPlus,Home}});
}
document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>showRoute(b.dataset.route));
document.querySelector('#landingLogin').onclick=()=>showRoute('login');
document.querySelector('#landingRegister').onclick=()=>showRoute('register');
document.querySelector('#loginForm').onsubmit=e=>{
  e.preventDefault();
  if(!e.currentTarget.reportValidity()) return;
  sessionStorage.setItem('grafictrader.auth','1');
  showRoute('live');
};
document.querySelector('#registerForm').onsubmit=e=>{
  e.preventDefault();
  if(!e.currentTarget.reportValidity()) return;
  sessionStorage.setItem('grafictrader.auth','1');
  showRoute('live');
};
window.addEventListener('hashchange',()=>showRoute(location.hash.slice(1)));
showRoute(location.hash.slice(1)||'home');

document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelector('#backBtn').onclick=()=>setMode('live');
window.addEventListener('resize',()=>{captureStickyOrigins();updateStickyCards();resizeChartToContainer();});

/* =========================================================
   LIVE INTELLIGENCE — terminal de trading
   Backend: /api/intelligence + /api/ticker
   ========================================================= */
const intelligencePanel=document.createElement('section');
intelligencePanel.id='intelligencePanel';
intelligencePanel.className='intelligence-panel';
intelligencePanel.setAttribute('aria-hidden','true');
intelligencePanel.innerHTML=`
  <div class="intel-shell">
    <header class="intel-topbar">
      <button class="icon-btn" id="intelClose" aria-label="Fechar"><i data-lucide="arrow-left"></i></button>
      <div class="intel-brand"><b>LIVE INTELLIGENCE</b><span>MARKET TERMINAL · REAL-TIME FLOW</span></div>
      <span class="intel-live-dot"><i></i> LIVE</span>
    </header>

    <div class="intel-ticker-wrap">
      <div class="intel-ticker-label">MARKET</div>
      <div class="intel-ticker" id="intelTicker"><span>BTC/USDT —</span><span>ETH/USDT —</span></div>
    </div>

    <div class="intel-status-row">
      <span id="intelStatus">A ligar às fontes…</span>
      <span id="intelUpdated">—</span>
    </div>

    <div class="intel-pulse" id="intelPulse">
      <div class="pulse-card"><small>BTC/USDT</small><b id="pulseBtcPrice">—</b><span id="pulseBtcChange">—</span></div>
      <div class="pulse-card"><small>ETH/USDT</small><b id="pulseEthPrice">—</b><span id="pulseEthChange">—</span></div>
      <div class="pulse-card"><small>MARKET PULSE</small><b id="pulseState">—</b><span id="pulseRange">24H</span></div>
    </div>
    <section class="intel-market-board">
      <div class="intel-board-head">
        <div><b id="intelAssetLabel">BTC/USDT</b><span> · MARKET STRUCTURE</span></div>
        <div class="intel-board-price"><b id="intelMarketPrice">—</b><span id="intelMarketChange">—</span></div>
      </div>
      <div class="intel-chart-wrap"><div id="intelMarketChart"></div></div>
      <div class="intel-metrics-grid">
        <div><small>TENDÊNCIA</small><b id="intelTrend">—</b></div>
        <div><small>RSI 14</small><b id="intelRsi">—</b></div>
        <div><small>ESTRUTURA</small><b id="intelStructure">—</b></div>
        <div><small>24H HIGH</small><b id="intelHigh">—</b></div>
        <div><small>24H LOW</small><b id="intelLow">—</b></div>
        <div><small>VOLUME 24H</small><b id="intelVolume">—</b></div>
      </div>
      <section class="mechanics-board" aria-live="polite">
        <div class="mechanics-head">
          <div><b>MARKET MECHANICS</b><span id="mechanicsState">A ANALISAR</span></div>
          <small id="mechanicsQuality">OHLCV · —</small>
        </div>
        <div class="mechanics-grid">
          <div><small>PRICE EFFICIENCY</small><b id="mechEfficiency">—</b></div>
          <div><small>MOVEMENT ENERGY</small><b id="mechEnergy">—</b></div>
          <div><small>ABSORPTION</small><b id="mechAbsorption">—</b></div>
          <div><small>DISPLACEMENT COST</small><b id="mechDisplacement">—</b></div>
          <div><small>LIQUIDITY RESISTANCE</small><b id="mechLiquidity">—</b></div>
          <div><small>ORDERLINESS</small><b id="mechOrderliness">—</b></div>
          <div><small>REGIME STABILITY</small><b id="mechRegime">—</b></div>
          <div><small>STRUCTURAL PRESSURE</small><b id="mechPressure">—</b></div>
          <div><small>TRADE FLOW</small><b id="mechTradeFlow">—</b></div>
          <div><small>ORDER BOOK</small><b id="mechBook">—</b></div>
          <div><small>SPREAD</small><b id="mechSpread">—</b></div>
          <div><small>EXECUTION SIGNATURE</small><b id="mechExecution">—</b></div>
        </div>
        <div class="mechanics-note" id="mechanicsNote">A recolher evidência mecânica do mercado…</div>
        <div class="mechanics-memory" id="mechanicsMemory">MEMÓRIA · a aguardar histórico…</div>
        <div class="mechanics-ai" id="mechanicsAi">IA mecânica a aguardar dados…</div>
      </section>
    </section>

    <div class="intel-tags" id="intelTags">
      <button class="intel-tag active" data-tag="ALL">TODOS</button>
      <button class="intel-tag" data-tag="BTC">#BTC</button>
      <button class="intel-tag" data-tag="CRYPTO">#CRYPTO</button>
      <button class="intel-tag" data-tag="MACRO">#MACRO</button>
      <button class="intel-tag" data-tag="NEWS">#NEWS</button>
      <button class="intel-tag" data-tag="MARKET">#MARKET</button>
    </div>

    <div class="intel-feed-head">
      <div><b id="intelCount">0 eventos</b><span> · fluxo mais recente</span></div>
      <button id="intelRefresh" class="intel-refresh">↻ Atualizar</button>
    </div>

    <div class="intel-feed" id="intelFeed" aria-live="polite">
      <div class="intel-empty"><b>A carregar acontecimentos…</b><span>O terminal continua a tentar as fontes individualmente.</span></div>
    </div>
  </div>

  <div class="intel-detail" id="intelDetail" aria-hidden="true">
    <div class="intel-detail-card">
      <button class="intel-detail-close" id="intelDetailClose" aria-label="Fechar detalhe">×</button>
      <div id="intelDetailContent"></div>
    </div>
  </div>
`;
document.querySelector('.shell').appendChild(intelligencePanel);
createIcons({icons:{ArrowLeft,Settings,Radio,Sparkles,Plus,Camera,TrendingUp,TrendingDown,ArrowRight,LogIn,UserPlus,Home}});

let intelligenceEvents=[];
let intelligenceTag='ALL';
let intelligenceTimer=null;
let tickerTimer=null;
let marketTimer=null;
let mechanicsTimer=null;
let mechanicsLoading=false;
let intelligenceLoading=false;
let intelMarketChart=null;
let intelCandleSeries=null;

function formatIntelTime(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return 'agora';
  return d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function intelSourceIcon(source=''){
  const s=source.toLowerCase();
  if(s.includes('binance'))return '◈';
  if(s.includes('marketaux'))return '◉';
  if(s.includes('finnhub'))return '◌';
  if(s.includes('gdelt'))return '◎';
  return '◆';
}
function sentimentLabel(sentiment){
  return sentiment==='bullish'?'BULLISH':sentiment==='bearish'?'BEARISH':'NEUTRO';
}
function sentimentClass(sentiment){return sentiment==='bullish'?'bullish':sentiment==='bearish'?'bearish':'neutral';}
function eventTags(event){
  if(Array.isArray(event.tags))return event.tags;
  return event.tag?[event.tag]:[];
}
function formatTerminalPrice(value){
  const n=Number(value);
  if(!Number.isFinite(n))return '—';
  return '$'+n.toLocaleString('en-US',{maximumFractionDigits:n<10?4:2});
}
function sparklineSvg(values){
  if(!Array.isArray(values)||values.length<2)return '';
  const nums=values.map(Number).filter(Number.isFinite);
  if(nums.length<2)return '';
  const min=Math.min(...nums),max=Math.max(...nums),range=max-min||1;
  const points=nums.map((v,i)=>{
    const x=(i/(nums.length-1))*100;
    const y=28-((v-min)/range)*24;
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  return '<svg class="intel-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="Sparkline"><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="1.7" vector-effect="non-scaling-stroke"/></svg>';
}

function initIntelMarketChart(){
  const el=document.querySelector('#intelMarketChart');
  if(!el||intelMarketChart)return;
  intelMarketChart=createChart(el,{
    layout:{background:{color:'#080d13'},textColor:'#657382',attributionLogo:true},
    grid:{vertLines:{color:'#111b24'},horzLines:{color:'#111b24'}},
    rightPriceScale:{borderColor:'#1d2833',textColor:'#778594'},
    timeScale:{borderColor:'#1d2833',timeVisible:true,secondsVisible:false},
    crosshair:{mode:1}
  });
  intelCandleSeries=intelMarketChart.addSeries(CandlestickSeries,{
    upColor:'#24d17b',downColor:'#ff5f6d',borderUpColor:'#24d17b',borderDownColor:'#ff5f6d',
    wickUpColor:'#24d17b',wickDownColor:'#ff5f6d'
  });
  new ResizeObserver(()=>{
    if(el.clientWidth&&el.clientHeight)intelMarketChart.resize(el.clientWidth,el.clientHeight);
  }).observe(el);
}
function calcIntelRsi(candles){
  const closes=candles.map(x=>x.close).filter(Number.isFinite);
  if(closes.length<15)return null;
  let gain=0,loss=0;
  for(let i=closes.length-14;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    gain+=Math.max(d,0);loss+=Math.max(-d,0);
  }
  return loss===0?100:100-(100/(1+gain/loss));
}
async function loadIntelMarket(){
  try{
    const currentSymbol=symbol||'BTCUSDT', currentInterval=interval||'5m';
    const r=await fetch('/api/market?symbol='+encodeURIComponent(currentSymbol)+'&interval='+encodeURIComponent(currentInterval),{cache:'no-store'});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||'Mercado indisponível');
    initIntelMarketChart();
    intelCandleSeries.setData(data.candles);
    intelMarketChart.timeScale().fitContent();
    const t=data.ticker,candles=data.candles,last=candles.at(-1),previous=candles.at(-20)||candles[0];
    const trend=last&&previous&&last.close>=previous.close?'ALTA':'BAIXA';
    const rsi=calcIntelRsi(candles);
    document.querySelector('#intelAssetLabel').textContent=currentSymbol.replace('USDT','/USDT');
    document.querySelector('#intelMarketPrice').textContent=formatTerminalPrice(t.price);
    const change=document.querySelector('#intelMarketChange');
    change.textContent=(t.change24h>=0?'+':'')+t.change24h.toFixed(2)+'%';
    change.className=t.change24h>=0?'up':'down';
    document.querySelector('#intelTrend').textContent=trend;
    document.querySelector('#intelTrend').className=trend==='ALTA'?'up':'down';
    document.querySelector('#intelRsi').textContent=rsi==null?'—':rsi.toFixed(1);
    document.querySelector('#intelStructure').textContent=trend==='ALTA'?'HIGHER HIGHS':'LOWER HIGHS';
    document.querySelector('#intelHigh').textContent=formatTerminalPrice(t.high24h);
    document.querySelector('#intelLow').textContent=formatTerminalPrice(t.low24h);
    document.querySelector('#intelVolume').textContent='$'+Number(t.volume24h).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:2});
  }catch(error){
    const state=document.querySelector('#intelStructure');
    if(state)state.textContent='SEM DADOS';
  }finally{
    clearTimeout(marketTimer);
    if(intelligencePanel.classList.contains('open'))marketTimer=setTimeout(loadIntelMarket,10000);
  }
}

function renderIntelTicker(tickers){
  const ticker=document.querySelector('#intelTicker');
  if(!ticker)return;
  ticker.innerHTML=tickers.map(item=>{
    const cls=item.change24h>=0?'up':'down';
    return '<span><b>'+escapeHtml(item.symbol.replace('USDT','/USDT'))+'</b> '+formatTerminalPrice(item.price)+' <em class="'+cls+'">'+(item.change24h>=0?'+':'')+Number(item.change24h||0).toFixed(2)+'%</em></span>';
  }).join('') || '<span>Binance · sem dados</span>';
  if(tickers.length) ticker.innerHTML+=ticker.innerHTML;
}
function updatePulse(tickers){
  const btc=tickers.find(x=>x.symbol==='BTCUSDT'),eth=tickers.find(x=>x.symbol==='ETHUSDT');
  if(btc){
    document.querySelector('#pulseBtcPrice').textContent=formatTerminalPrice(btc.price);
    const el=document.querySelector('#pulseBtcChange');el.textContent=(btc.change24h>=0?'+':'')+btc.change24h.toFixed(2)+'%';el.className=btc.change24h>=0?'up':'down';
  }
  if(eth){
    document.querySelector('#pulseEthPrice').textContent=formatTerminalPrice(eth.price);
    const el=document.querySelector('#pulseEthChange');el.textContent=(eth.change24h>=0?'+':'')+eth.change24h.toFixed(2)+'%';el.className=eth.change24h>=0?'up':'down';
  }
  const avg=tickers.length?tickers.reduce((sum,x)=>sum+Number(x.change24h||0),0)/tickers.length:0;
  document.querySelector('#pulseState').textContent=avg>0.15?'RISK ON':avg<-0.15?'RISK OFF':'MIXED';
}

function renderIntelFeed(){
  const feed=document.querySelector('#intelFeed');
  const visible=intelligenceTag==='ALL'?intelligenceEvents:intelligenceEvents.filter(e=>eventTags(e).includes(intelligenceTag));
  document.querySelector('#intelCount').textContent=visible.length+' evento'+(visible.length===1?'':'s');
  if(!visible.length){
    feed.innerHTML='<div class="intel-empty"><b>Nenhum evento encontrado</b><span>Experimenta outra tag ou atualiza o fluxo.</span></div>';
    return;
  }
  feed.innerHTML=visible.map((event,index)=>{
    const tags=eventTags(event);
    return '<button class="intel-event '+sentimentClass(event.sentiment)+'" data-intel-index="'+index+'" type="button">'+
      '<div class="intel-event-top"><span class="intel-source-icon">'+intelSourceIcon(event.source)+'</span><span class="intel-event-source">'+escapeHtml(event.source||'Fonte')+'</span><span class="intel-event-time">'+formatIntelTime(event.timestamp)+'</span><span class="intel-sentiment '+sentimentClass(event.sentiment)+'">'+sentimentLabel(event.sentiment)+'</span></div>'+
      '<div class="intel-event-main"><div><div class="intel-event-title">'+escapeHtml(event.headline||event.title||'Evento de mercado')+'</div>'+
      (event.summary?'<div class="intel-event-summary">'+escapeHtml(event.summary)+'</div>':'')+
      '<div class="intel-event-bottom">'+tags.map(tag=>'<span>#'+escapeHtml(tag)+'</span>').join('')+(event.symbol?'<span>'+escapeHtml(event.symbol.replace('USDT','/USDT'))+'</span>':'')+'</div></div>'+
      sparklineSvg(event.sparkline)+'</div></button>';
  }).join('');
  feed.querySelectorAll('.intel-event').forEach(button=>{
    button.onclick=()=>{
      const current=intelligenceTag==='ALL'?intelligenceEvents:intelligenceEvents.filter(e=>eventTags(e).includes(intelligenceTag));
      openIntelDetail(current[Number(button.dataset.intelIndex)]);
    };
  });
}

function openIntelDetail(event){
  if(!event)return;
  const detail=document.querySelector('#intelDetail');
  document.querySelector('#intelDetailContent').innerHTML=
    '<div class="intel-detail-kicker"><span class="intel-source-icon">'+intelSourceIcon(event.source)+'</span> '+escapeHtml(event.source||'Fonte')+' · '+escapeHtml(sentimentLabel(event.sentiment))+'</div>'+
    '<h2>'+escapeHtml(event.headline||event.title||'Evento')+'</h2>'+
    '<div class="intel-detail-meta">'+formatIntelTime(event.timestamp)+(event.symbol?' · '+escapeHtml(event.symbol.replace('USDT','/USDT')):'')+'</div>'+
    '<p>'+escapeHtml(event.summary||'Sem descrição disponível.')+'</p>'+
    '<div class="intel-detail-tags">'+eventTags(event).map(tag=>'<button class="intel-tag" data-detail-tag="'+escapeHtml(tag)+'">#'+escapeHtml(tag)+'</button>').join('')+'</div>'+
    (event.metrics?'<div class="intel-metrics">'+Object.entries(event.metrics).filter(([,v])=>Number.isFinite(Number(v))).map(([k,v])=>'<span><small>'+escapeHtml(k)+'</small><b>'+escapeHtml(Number(v).toLocaleString('en-US',{maximumFractionDigits:2}))+'</b></span>').join('')+'</div>':'')+
    (event.url?'<a class="intel-source-link" href="'+escapeHtml(event.url)+'" target="_blank" rel="noopener noreferrer">Abrir fonte original ↗</a>':'');
  detail.classList.add('open');detail.setAttribute('aria-hidden','false');
  detail.querySelectorAll('[data-detail-tag]').forEach(btn=>btn.onclick=()=>{
    intelligenceTag=btn.dataset.detailTag;
    document.querySelectorAll('#intelTags .intel-tag').forEach(x=>x.classList.toggle('active',x.dataset.tag===intelligenceTag));
    closeIntelDetail();renderIntelFeed();
  });
}
function closeIntelDetail(){
  const detail=document.querySelector('#intelDetail');detail.classList.remove('open');detail.setAttribute('aria-hidden','true');
}

function renderMechanics(data){
  const m=data?.metrics||{};
  const set=(id,v)=>{const el=document.querySelector('#'+id);if(el)el.textContent=v==null?'—':v+'%';};
  set('mechEfficiency',m.priceEfficiency);set('mechEnergy',m.movementEnergy);
  set('mechAbsorption',m.absorption);set('mechDisplacement',m.displacementCost);
  set('mechLiquidity',m.liquidityResistance);set('mechOrderliness',m.marketOrderliness);
  set('mechRegime',m.regimeStability);set('mechPressure',m.structuralPressure);
  const signed=(id,v)=>{const el=document.querySelector('#'+id);if(el)el.textContent=v==null?'—':(v>0?'+':'')+v+'%';};
  signed('mechTradeFlow',m.tradeFlow);signed('mechBook',m.orderBookImbalance);
  const spread=document.querySelector('#mechSpread');if(spread)spread.textContent=m.spreadBps==null?'—':m.spreadBps+' bps';
  set('mechExecution',m.executionSignature);
  const state=document.querySelector('#mechanicsState');
  if(state)state.textContent=String(data?.state||'LOW_INFORMATION').replaceAll('_',' ');
  const quality=document.querySelector('#mechanicsQuality');
  if(quality)quality.textContent=(data?.dataQuality?.trades?'TRADES':'OHLCV')+' · '+Number(data?.dataQuality?.candles||0)+' candles'+(data?.dataQuality?.orderBook?' · BOOK':'');
  const note=document.querySelector('#mechanicsNote');
  const ev=data?.evidence||{};
  if(note){
    if(data?.state==='DIRECTIONAL_EXPANSION') note.textContent='Movimento eficiente e persistente, com expansão de energia direcional.';
    else if(data?.state==='ABSORPTION') note.textContent='Há evidência de atividade elevada com deslocamento relativamente contido. É um proxy OHLCV, não fluxo direto.';
    else if(data?.state==='LIQUIDITY_CONFLICT') note.textContent='Existem zonas recorrentes de reação no histórico recente; liquidez real ainda não está disponível.';
    else if(data?.state==='REGIME_TRANSITION') note.textContent='O comportamento estatístico recente diverge da janela anterior. O regime está em transição.';
    else if(data?.state==='RANGE_ROTATION') note.textContent='O movimento apresenta baixa organização direcional e maior rotação entre estados.';
    else if(data?.state==='MICRO_ABSORPTION') note.textContent='Fluxo agressor e deslocamento de preço sugerem absorção. A leitura usa os trades observados neste instante.';
    else if(data?.state==='ORDER_BOOK_IMBALANCE') note.textContent='A profundidade imediata do livro está desequilibrada. Isto descreve liquidez disponível agora, não uma intenção garantida.';
    else note.textContent='A evidência disponível ainda não é suficiente para classificar um mecanismo dominante.';
  }
}
  const mem=document.querySelector('#mechanicsMemory');
  const memory=data?.memory;
  if(mem){
    if(!memory?.available) mem.textContent='MEMÓRIA · histórico insuficiente';
    else {
      const transition=memory.transition ? memory.transition.from.replaceAll('_',' ')+' → '+memory.transition.to.replaceAll('_',' ') : 'sem transição de estado';
      const pattern=memory.pattern?.sequence?.length ? ' · padrão '+memory.pattern.sequence.map(x=>x.replaceAll('_',' ')).join(' → ') : '';
      const family=memory.patternFamily ? ' · família '+memory.patternFamily.label+' · '+memory.patternFamily.avgSimilarity+'% semelhante' : '';
      const library=data?.patternLibrary;
      const historical=library?.available && library?.patterns?.length ? ' · biblioteca '+library.patterns.length+' famílias' : '';
      mem.textContent='MEMÓRIA · '+transition+' · '+memory.durationBars+' barras · mudança '+memory.changeScore+'%'+pattern+family+historical;
    }
  }
async function loadMechanicsAI(data){
  if(mechanicsAiLoading||!data?.ok)return;
  mechanicsAiLoading=true;
  const el=document.querySelector('#mechanicsAi');
  if(el)el.textContent='A IA está a interpretar o mecanismo…';
  try{
    const r=await fetch('/api/mechanics-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await r.json();
    if(!r.ok||!result.ok)throw new Error(result.error||'Interpretação indisponível');
    if(el)el.textContent=result.interpretation||'Sem interpretação disponível.';
  }catch(error){
    if(el)el.textContent='Interpretação IA indisponível neste momento.';
  }finally{
    mechanicsAiLoading=false;
    clearTimeout(mechanicsAiTimer);
    if(intelligencePanel.classList.contains('open')) mechanicsAiTimer=setTimeout(()=>loadMechanicsAI(data),30000);
  }
}
async function loadMechanics(){
  if(mechanicsLoading)return;
  mechanicsLoading=true;
  try{
    const currentSymbol=symbol||'BTCUSDT',currentInterval=interval||'5m';
    const r=await fetch('/api/mechanics?symbol='+encodeURIComponent(currentSymbol)+'&interval='+encodeURIComponent(currentInterval),{cache:'no-store'});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||'Mecânica indisponível');
    renderMechanics(data);
    loadMechanicsAI(data);
  }catch(error){
    const state=document.querySelector('#mechanicsState'); if(state)state.textContent='OFFLINE';
    const note=document.querySelector('#mechanicsNote'); if(note)note.textContent='Motor mecânico indisponível neste momento.';
  }finally{
    mechanicsLoading=false;
    clearTimeout(mechanicsTimer);
    if(intelligencePanel.classList.contains('open')) mechanicsTimer=setTimeout(loadMechanics,10000);
  }
}
async function loadTicker(){
  try{
    const r=await fetch('/api/ticker',{cache:'no-store'}),data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||'Ticker indisponível');
    renderIntelTicker(data.data||[]);updatePulse(data.data||[]);
  }catch(error){
    document.querySelector('#intelTicker').innerHTML='<span>TICKER OFFLINE · '+escapeHtml(error.message)+'</span>';
    document.querySelector('#pulseState').textContent='OFFLINE';
  }finally{
    clearTimeout(tickerTimer);
    if(intelligencePanel.classList.contains('open'))tickerTimer=setTimeout(loadTicker,10000);
  }
}

async function loadIntelligence(){
  if(intelligenceLoading)return;
  intelligenceLoading=true;
  document.querySelector('#intelStatus').textContent='A atualizar fontes individualmente…';
  try{
    const response=await fetch('/api/intelligence?symbol='+encodeURIComponent(symbol||'BTCUSDT'),{cache:'no-store'});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Falha no feed');
    intelligenceEvents=Array.isArray(data.events)?data.events:[];
    renderIntelFeed();
    const active=Array.isArray(data.activeSources)?data.activeSources.length:0;
    const total=Number(data.sourceCount||4);
    document.querySelector('#intelStatus').textContent='● '+active+'/'+total+' fontes ativas'+(data.failedSources?.length?' · '+data.failedSources.length+' com falha':'');
    document.querySelector('#intelUpdated').textContent='ATUALIZADO '+formatIntelTime(data.updatedAt);
    if(Array.isArray(data.failedSources)&&data.failedSources.length){
      document.querySelector('#intelStatus').title=data.failedSources.map(x=>x.source+': '+x.error).join(' | ');
    }else document.querySelector('#intelStatus').title='Todas as fontes responderam.';
  }catch(error){
    document.querySelector('#intelStatus').textContent='AGREGADOR OFFLINE · '+error.message;
  }finally{
    intelligenceLoading=false;
    clearTimeout(intelligenceTimer);
    if(intelligencePanel.classList.contains('open'))intelligenceTimer=setTimeout(loadIntelligence,30000);
  }
}

function openIntelligence(){
  intelligencePanel.classList.add('open');intelligencePanel.setAttribute('aria-hidden','false');document.body.classList.add('intel-open');
  loadTicker();loadIntelligence();loadMechanics();
}
function closeIntelligence(){
  intelligencePanel.classList.remove('open');intelligencePanel.setAttribute('aria-hidden','true');closeIntelDetail();document.body.classList.remove('intel-open');
  clearTimeout(intelligenceTimer);clearTimeout(tickerTimer);clearTimeout(mechanicsTimer);
}
document.querySelector('#settings').onclick=openIntelligence;
document.querySelector('#intelClose').onclick=closeIntelligence;
document.querySelector('#intelDetailClose').onclick=closeIntelDetail;
document.querySelector('#intelDetail').onclick=e=>{if(e.target.id==='intelDetail')closeIntelDetail();};
document.querySelector('#intelRefresh').onclick=()=>{loadTicker();loadIntelligence();loadMechanics();};
document.querySelectorAll('#intelTags .intel-tag').forEach(button=>button.onclick=()=>{
  intelligenceTag=button.dataset.tag;
  document.querySelectorAll('#intelTags .intel-tag').forEach(x=>x.classList.toggle('active',x===button));
  renderIntelFeed();
});
const originalBackHandler=document.querySelector('#backBtn').onclick;
document.querySelector('#backBtn').onclick=()=>{
  if(intelligencePanel.classList.contains('open'))closeIntelligence();
  else if(originalBackHandler)originalBackHandler();
};
