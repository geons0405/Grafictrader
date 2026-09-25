import { createChart, CandlestickSeries } from 'lightweight-charts';
import './styles.css';

const app = document.querySelector('#app');
app.innerHTML = `
<div class="shell">
  <header><div class="brand">Grafictrader</div><button id="settings">⚙</button></header>
  <main>
    <div class="mode"><button class="active" data-mode="live">LIVE</button><button data-mode="foto">FOTO</button></div>
    <section id="live" class="screen active">
      <div class="symbol"><div><b>BTC/USDT</b><span>Binance · 5m</span></div><strong id="price">—</strong></div>
      <div class="chart-card"><div id="chart"></div></div>
      <div class="tf"><button>1m</button><button class="active">5m</button><button>15m</button><button>1h</button><button>4h</button></div>
      <div class="cards">
        <article><span>Tendência</span><b id="trend">A analisar…</b></article>
        <article><span>RSI</span><b id="rsi">—</b></article>
        <article><span>Estrutura</span><b id="structure">—</b></article>
      </div>
      <p class="note">Dados públicos em tempo real. Esta versão não executa ordens.</p>
    </section>
    <section id="foto" class="screen">
      <div class="camera"><video id="video" autoplay playsinline></video><div class="guide">Enquadra o gráfico inteiro<br><small>Candles · preço · timeframe · indicadores</small></div></div>
      <div class="foto-actions"><button id="startCam">Abrir câmera</button><button id="snap" disabled>Capturar</button></div>
      <div id="analysis" class="analysis hidden"></div>
    </section>
  </main>
  <nav><button class="selected">⌂<small>Início</small></button><button>◷<small>Histórico</small></button><button>◎<small>Perfil</small></button></nav>
</div>`;

const chart = createChart(document.querySelector('#chart'), {
  layout:{background:{color:'#0b0e13'},textColor:'#8d96a5'},
  grid:{vertLines:{color:'#171b22'},horzLines:{color:'#171b22'}},
  rightPriceScale:{borderColor:'#222833'},
  timeScale:{borderColor:'#222833',timeVisible:true},
  width:document.querySelector('#chart').clientWidth,
  height:360
});
const series = chart.addSeries(CandlestickSeries,{upColor:'#39d98a',downColor:'#ff5c6c',borderVisible:false,wickUpColor:'#39d98a',wickDownColor:'#ff5c6c'});

async function loadMarket(){
  const data=await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=180').then(r=>r.json());
  series.setData(data.map(k=>({time:k[0]/1000,open:+k[1],high:+k[2],low:+k[3],close:+k[4]})));
  const last=data.at(-1);
  updateMetrics(+last[4], data);
}
function updateMetrics(price,data){
  document.querySelector('#price').textContent='$'+price.toLocaleString('en-US',{maximumFractionDigits:2});
  const closes=data.map(x=>+x[4]);
  const delta=closes.at(-1)-closes.at(-20);
  document.querySelector('#trend').textContent=delta>=0?'Alta':'Baixa';
  document.querySelector('#structure').textContent=delta>=0?'Higher highs':'Lower highs';
  const gains=[],losses=[];
  for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1]; gains.push(Math.max(d,0)); losses.push(Math.max(-d,0));}
  const ag=gains.slice(-14).reduce((a,b)=>a+b,0)/14, al=losses.slice(-14).reduce((a,b)=>a+b,0)/14;
  const rsi=al===0?100:100-(100/(1+ag/al));
  document.querySelector('#rsi').textContent=rsi.toFixed(1);
}
loadMarket().catch(()=>document.querySelector('#trend').textContent='Sem dados');
const ws=new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_5m');
ws.onmessage=e=>{const k=JSON.parse(e.data).k;if(!k)return;series.update({time:k.t/1000,open:+k.o,high:+k.h,low:+k.l,close:+k.c});document.querySelector('#price').textContent='$'+(+k.c).toLocaleString('en-US',{maximumFractionDigits:2});};
window.addEventListener('resize',()=>chart.applyOptions({width:document.querySelector('#chart').clientWidth}));

let stream;
document.querySelector('#startCam').onclick=async()=>{try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});document.querySelector('#video').srcObject=stream;document.querySelector('#snap').disabled=false;}catch(e){alert('Permite o acesso à câmera para usar FOTO.');}};
document.querySelector('#snap').onclick=()=>{const a=document.querySelector('#analysis');a.classList.remove('hidden');a.innerHTML='<h3>Análise da imagem</h3><p>Captura recebida. A análise multimodal será ligada na próxima etapa.</p><div class="tag">Modo FOTO pronto</div>';};
document.querySelectorAll('.mode button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.mode button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));document.querySelector('#'+b.dataset.mode).classList.add('active');});
document.querySelectorAll('.tf button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tf button').forEach(x=>x.classList.remove('active'));b.classList.add('active');});
