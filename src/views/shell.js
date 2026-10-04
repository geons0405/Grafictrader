import { ASSETS, INTERVALS } from '../lib/store.js';


const timeframeButtons = INTERVALS.map(item =>
  `<button type="button" data-interval="${item.value}">${item.label}</button>`
).join('');

const themeButtons = `
  <button type="button" data-theme-choice="system"><i data-lucide="monitor"></i>Sistema</button>
  <button type="button" data-theme-choice="light"><i data-lucide="sun"></i>Claro</button>
  <button type="button" data-theme-choice="dark"><i data-lucide="moon"></i>Escuro</button>`;

export const shellTemplate = `
<div class="app">
  <!-- LANDING -->
  <section id="home" class="screen landing" data-public>
    <div class="landing-top">
      <div class="brand"><span class="brand-mark">G</span><span>Grafictrader</span></div>
      <button class="round-btn" type="button" data-theme-toggle aria-label="Alternar tema"><i data-lucide="moon" class="when-light"></i><i data-lucide="sun" class="when-dark"></i></button>
    </div>
    <div class="landing-hero">
      <span class="eyebrow">AI Market Intelligence</span>
      <h1>Entende o mercado.<br><span class="muted-text">Não apenas o gráfico.</span></h1>
      <p>Fotografa um gráfico e recebe a orientação da IA: comprar, vender ou aguardar. No LIVE, acompanha a IA a operar em tempo real.</p>
    </div>
    <div class="landing-preview" aria-hidden="true">
      <div class="preview-card">
        <small>BTC/USDT</small>
        <strong>Leitura ao vivo</strong>
        <div class="preview-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="preview-card preview-ring">
        <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" class="ring-track" pathLength="100"/><circle cx="32" cy="32" r="26" class="ring-value" pathLength="100" style="--value:72"/></svg>
        <small>Confiança</small>
      </div>
    </div>
    <div class="landing-actions">
      <button class="btn btn-primary" type="button" data-route="login"><i data-lucide="log-in"></i>Entrar</button>
      <button class="btn btn-soft" type="button" data-route="register"><i data-lucide="user-plus"></i>Criar conta</button>
    </div>
    <p class="fine-print">Apenas análise · sem execução de ordens · não é aconselhamento financeiro.</p>
  </section>

  <!-- LOGIN -->
  <section id="login" class="screen auth" data-public>
    <button class="round-btn back" type="button" data-route="home" aria-label="Voltar"><i data-lucide="arrow-left"></i></button>
    <div class="auth-head">
      <span class="brand-mark">G</span>
      <h1>Bem-vindo de volta</h1>
      <p>Entra para continuar a acompanhar o mercado.</p>
    </div>
    <div class="notice" data-local-notice hidden>
      <b>Modo local</b>
      <span>As contas no servidor ainda não estão configuradas. Podes criar um perfil que fica guardado só neste dispositivo.</span>
      <button class="btn btn-primary" type="button" data-route="register">Criar perfil local</button>
    </div>
    <form id="loginForm" class="form" data-server-only novalidate>
      <label class="field"><i data-lucide="mail"></i><input type="email" name="email" placeholder="Email" autocomplete="email" required></label>
      <label class="field"><i data-lucide="lock"></i><input type="password" name="password" placeholder="Palavra-passe" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit">Entrar<i data-lucide="arrow-right"></i></button>
      <p class="form-message" role="alert"></p>
    </form>
    <p class="switch">Ainda não tens conta? <button type="button" data-route="register">Criar conta</button></p>
  </section>

  <!-- REGISTER -->
  <section id="register" class="screen auth" data-public>
    <button class="round-btn back" type="button" data-route="home" aria-label="Voltar"><i data-lucide="arrow-left"></i></button>
    <div class="auth-head">
      <span class="brand-mark">G</span>
      <h1 data-register-title>Criar a tua conta</h1>
      <p data-register-copy>Guarda as tuas preferências e acede de qualquer dispositivo.</p>
    </div>
    <form id="registerForm" class="form" novalidate>
      <label class="field"><i data-lucide="user"></i><input type="text" name="name" placeholder="Nome" autocomplete="name" maxlength="60" required></label>
      <label class="field" data-server-only><i data-lucide="mail"></i><input type="email" name="email" placeholder="Email" autocomplete="email" required></label>
      <label class="field" data-server-only><i data-lucide="lock"></i><input type="password" name="password" placeholder="Palavra-passe (mín. 8)" minlength="8" autocomplete="new-password" required></label>
      <button class="btn btn-primary" type="submit"><span data-register-cta>Criar conta</span><i data-lucide="arrow-right"></i></button>
      <p class="form-message" role="alert"></p>
    </form>
    <p class="switch" data-server-only>Já tens conta? <button type="button" data-route="login">Entrar</button></p>
  </section>

  <!-- FOTO -->
  <section id="foto" class="screen">
    <header class="page-head">
      <div><h1>Foto</h1><p>Fotografa ou carrega um gráfico e recebe a orientação da IA</p></div>
      <button class="round-btn" type="button" data-open-menu aria-label="Menu"><i data-lucide="sliders-horizontal"></i></button>
    </header>
    <article class="card camera-card">
      <div class="camera" id="camera">
        <video id="video" autoplay playsinline muted></video>
        <div class="camera-guide"><b>Enquadra o gráfico inteiro</b><small>Velas · preço · timeframe · indicadores</small></div>
        <span class="camera-status" id="cameraStatus">Câmara desligada</span>
        <button class="stage-btn camera-close" type="button" id="closeCam" aria-label="Fechar câmara"><i data-lucide="x"></i></button>
      </div>
      <div class="camera-actions">
        <button class="btn btn-soft" type="button" id="startCam"><i data-lucide="camera"></i>Abrir câmara</button>
        <button class="btn btn-primary" type="button" id="snap" disabled>Fotografar</button>
      </div>
      <label class="btn btn-ghost upload-file"><i data-lucide="upload"></i>Carregar imagem do gráfico<input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp" hidden></label>
    </article>
    <div id="analysis" class="analysis" hidden></div>
    <p class="fine-print">Orientação educativa gerada por IA. Não é aconselhamento financeiro nem garantia de resultado.</p>
  </section>

  <!-- LIVE -->
  <section id="live" class="screen">
    <header class="live-top">
      <div class="segmented live-mode" role="tablist" aria-label="Modo do LIVE">
        <button type="button" data-live-mode="broker">Minha corretora</button>
        <button type="button" data-live-mode="market">Mercado</button>
      </div>
      <button class="round-btn" type="button" data-open-menu aria-label="Menu"><i data-lucide="sliders-horizontal"></i></button>
    </header>

    <div class="live-pane" data-live-pane="broker">
      <article class="card watch-card">
        <div class="watch-stage" id="watchStage">
          <video id="watchVideo" autoplay playsinline muted></video>
          <span class="watch-overlay" id="watchOverlay">—</span>
          <button class="stage-btn watch-expand" type="button" id="watchExpand" aria-label="Ver em ecrã inteiro"><i data-lucide="maximize-2"></i></button>
          <div class="watch-hud" id="watchHud">
            <p class="watch-hud-now" id="watchHudNow">A preparar a primeira análise…</p>
            <small class="watch-hud-status" id="watchHudStatus"></small>
            <div class="watch-hud-actions">
              <button class="btn btn-soft" type="button" id="watchMin"><i data-lucide="minimize-2"></i>Ver análise</button>
              <button class="btn btn-primary" type="button" id="watchHudStop"><i data-lucide="x"></i>Parar</button>
            </div>
          </div>
          <div class="watch-empty" id="watchEmpty">
            <b>A IA acompanha a tua corretora ao vivo</b>
            <ol>
              <li>Abre a tua corretora (qualquer uma: MT5, XM, Exness, Quotex, IQ Option…).</li>
              <li>No computador, toca em <b>Partilhar ecrã</b> e escolhe a janela da corretora. No telemóvel, usa a <b>câmara</b> apontada ao gráfico.</li>
              <li>Continua a operar na corretora: a IA analisa sempre que o gráfico muda e avisa-te.</li>
            </ol>
          </div>
        </div>
        <div class="watch-controls" id="watchStarts">
          <button class="btn btn-primary" type="button" id="watchNative" hidden><i data-lucide="smartphone"></i>Analisar a corretora neste telemóvel</button>
          <p class="fine-print left" id="watchNativeHint" hidden>Abre depois a tua corretora: a IA vê o ecrã e mostra COMPRAR, VENDER ou NÃO OPERAR numa bolha por cima dela. Toca na bolha para ver o que fazer.</p>
          <button class="btn btn-primary" type="button" id="watchShare"><i data-lucide="monitor"></i>Partilhar ecrã</button>
          <button class="btn btn-soft" type="button" id="watchCamera"><i data-lucide="camera"></i>Usar câmara</button>
          <label class="btn btn-ghost"><i data-lucide="upload"></i>Carregar vídeo<input type="file" id="watchFile" accept="video/*" hidden></label>
          <p class="fine-print left" id="watchShareHint" hidden>Neste dispositivo o navegador não deixa partilhar o ecrã. Usa a câmara apontada ao gráfico, ou abre o Grafictrader no computador.</p>
        </div>
        <button class="btn btn-soft" type="button" id="watchStop" hidden><i data-lucide="x"></i>Parar análise</button>
        <div class="watch-tools">
          <button type="button" class="chip-toggle" id="watchPip" hidden><i data-lucide="image"></i>Janela flutuante</button>
          <button type="button" class="chip-toggle" id="watchVoice"><i data-lucide="radio"></i>Voz</button>
          <button type="button" class="chip-toggle" id="watchAlerts"><i data-lucide="sparkles"></i>Alertas</button>
        </div>
        <small class="muted-line" id="watchStatus">Escolhe como queres mostrar a tua corretora.</small>
      </article>

      <article class="card instructor" id="watchResult" hidden aria-live="polite">
        <header class="card-head"><b class="instructor-title"><i data-lucide="bot"></i>IA ao vivo</b><small>análise da tua corretora</small></header>
        <div class="position">
          <span class="badge" id="watchBadge">—</span>
          <div class="position-main"><b id="watchTitle">—</b><small id="watchSub">—</small></div>
        </div>
        <p class="watch-pending" id="watchPending" hidden></p>
        <div class="levels levels-3" id="watchLevels" hidden>
          <div><small>Entrar em</small><b id="wlEntry">—</b></div>
          <div><small>Stop loss</small><b id="wlStop" class="neg">—</b></div>
          <div><small>Take profit</small><b id="wlTarget" class="pos">—</b></div>
        </div>
        <div class="guide">
          <div class="guide-now"><small>O que fazer agora</small><p id="watchNow">—</p></div>
          <p class="watch-change" id="watchChange" hidden></p>
          <div class="guide-block"><small>Porquê</small><div id="watchWhy"></div></div>
          <div class="guide-block"><small>Passo a passo</small><ol id="watchSteps"></ol></div>
        </div>
        <div class="guide-block"><small>Mudanças nesta sessão</small><div class="ops" id="watchHistory"></div></div>
        <p class="fine-print left">Orientação educativa gerada por IA a partir do que aparece no teu ecrã. Não é aconselhamento financeiro; decide sempre com o teu stop loss.</p>
      </article>
    </div>

    <div class="live-pane" data-live-pane="market" hidden>
    <header class="live-head">
      <button class="asset-pill" type="button" id="assetPicker" aria-label="Escolher ativo"><span id="assetLabel">BTC/USDT</span><i data-lucide="chevron-down"></i></button>
      <div class="live-quote"><strong id="price">—</strong><span class="delta" id="change">—</span></div>
    </header>
    <div class="segmented source-switch" id="sources" role="tablist" aria-label="Fonte do gráfico">
      <button type="button" data-source="tradingview">TradingView</button>
      <button type="button" data-source="binance">Binance</button>
      <button type="button" data-source="mt5">MetaTrader 5</button>
    </div>
    <div class="segmented" id="timeframes" role="tablist" aria-label="Timeframe">${timeframeButtons}</div>
    <article class="card chart-card">
      <header class="card-head"><b><span class="dot" id="liveDot"></span><span id="connection">A ligar</span></b><small id="chartMeta">Binance · 5 minutos</small></header>
      <div id="chart" class="chart"></div>
      <div id="tvChart" class="chart tv-chart" hidden></div>
      <div id="chartNotice" class="chart-notice" hidden></div>
    </article>

    <article class="card instructor" id="instructor" aria-live="polite">
      <header class="card-head">
        <b class="instructor-title"><i data-lucide="bot"></i>IA instrutora</b>
        <small id="instructorMode">a carregar…</small>
      </header>
      <div class="segmented view-switch" role="tablist" aria-label="Vista da IA">
        <button type="button" class="active" data-view="guide">Orientação</button>
        <button type="button" data-view="council">Conselho</button>
        <button type="button" data-view="results">Resultados</button>
      </div>

      <div class="view" data-pane="guide">
        <div class="position" id="positionBox">
          <span class="badge" id="positionBadge">—</span>
          <div class="position-main">
            <b id="positionTitle">A preparar a IA…</b>
            <small id="positionSub">A analisar o mercado.</small>
          </div>
          <div class="position-pnl"><strong id="positionPnl"></strong><small id="positionPnlSub"></small></div>
        </div>
        <div class="levels levels-3" id="positionLevels" hidden>
          <div><small>Entrar em</small><b id="lvEntry">—</b></div>
          <div><small>Stop loss</small><b id="lvStop" class="neg">—</b></div>
          <div><small>Take profit</small><b id="lvTarget" class="pos">—</b></div>
        </div>
        <div class="guide" id="guide">
          <div class="guide-now"><small>O que fazer agora</small><p id="guideNow">—</p></div>
          <div class="guide-block"><small>Porquê</small><div id="guideWhy"></div></div>
          <div class="guide-block"><small>Passo a passo</small><ol id="guideSteps"></ol></div>
          <details class="guide-tech"><summary>Detalhes técnicos</summary><ul class="reasons" id="instructorReasons"></ul></details>
        </div>
      </div>

      <div class="view" data-pane="council" hidden>
        <div class="position">
          <span class="badge" id="councilBadge">—</span>
          <div class="position-main">
            <b id="councilTitle">O conselho ainda não reuniu</b>
            <small id="councilSub">7 analistas calculam; uma IA juíza decide.</small>
          </div>
        </div>
        <div class="levels levels-3" id="councilLevels" hidden>
          <div><small>Entrar em</small><b id="clEntry">—</b></div>
          <div><small>Stop loss</small><b id="clStop" class="neg">—</b></div>
          <div><small>Take profit</small><b id="clTarget" class="pos">—</b></div>
        </div>
        <div class="guide">
          <div class="guide-block"><small>Porque a juíza decidiu assim</small><div id="councilWhy"></div></div>
          <div class="guide-block"><small>Analistas</small><div class="council-list" id="councilAnalysts"></div></div>
          <p class="muted-line" id="councilMeta"></p>
        </div>
      </div>

      <div class="view" data-pane="results" hidden>
        <div class="stat-row">
          <div><small>Win rate</small><b id="stWin">—</b></div>
          <div><small>Operações</small><b id="stTrades">—</b></div>
          <div><small>Conta demo</small><b id="stPnl">—</b></div>
        </div>
        <div class="ops" id="recentOps"></div>
      </div>
      <p class="fine-print left">Operações simuladas pela IA (conta demo de $1.000, risco 1% por operação). Copiar é por tua conta e risco; resultados passados não garantem resultados futuros.</p>
    </article>
    <p class="fine-print">Gráficos <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a> · dados Binance, MetaTrader 5 e TradingView.</p>
    </div>
  </section>

  <!-- LIVE INTELIGENTE -->
  <section id="intel" class="screen term-screen">
    <header class="term-top">
      <button class="round-btn sm" type="button" data-route="live" aria-label="Voltar ao LIVE"><i data-lucide="arrow-left"></i></button>
      <div class="term-brand"><b>GRAFICTRADER AI</b><span>/ LIVE INTELIGENTE</span></div>
      <button class="round-btn sm" type="button" id="intelRefresh" aria-label="Atualizar"><i data-lucide="refresh-cw"></i></button>
    </header>
    <div class="term-status">
      <span><i class="alive"></i><b id="tAlive">ATIVO</b></span>
      <span><i data-lucide="flame"></i><b id="tStreak">0</b> WIN STREAK</span>
      <span><small>DESDE</small><b id="tUptime">—</b></span>
      <span><small>CICLO</small><b id="tCycle">#—</b></span>
      <span><small>ATIVO</small><b id="tSymbol">BTC/USDT</b></span>
    </div>

    <div class="term-box">
      <div class="term-label"><span>// MERCADOS GLOBAIS</span><span id="gRisk">—</span></div>
      <div class="global-grid" id="gMarkets"><p class="term-note">A carregar índices, câmbio, juros e matérias-primas…</p></div>
    </div>

    <div class="term-grid">
      <div class="term-box">
        <div class="term-label"><span>// CALENDÁRIO ECONÓMICO</span><span id="gCalMeta">—</span></div>
        <div class="calendar" id="gCalendar"><p class="term-note">A carregar eventos…</p></div>
      </div>
      <div class="term-box">
        <div class="term-label"><span>// SENTIMENTO CRIPTO</span><span>FEAR &amp; GREED</span></div>
        <div class="fng" id="gFng"><p class="term-note">—</p></div>
      </div>
    </div>

    <div class="term-tiles">
      <div class="term-box tile"><small>SALDO ATUAL</small><strong id="tBalance">—</strong><div class="tile-spark" id="tBalanceSpark"></div><span id="tBalanceSub">inicial: $1,000.00</span></div>
      <div class="term-box tile"><small>P&amp;L TOTAL</small><strong id="tPnl">—</strong><div class="tile-spark" id="tPnlSpark"></div><span id="tPnlSub">—</span></div>
      <div class="term-box tile"><small>POSIÇÃO</small><strong id="tPosition">—</strong><span id="tPositionSub">—</span></div>
      <div class="term-box tile"><small>WIN RATE</small><strong id="tWinRate">—</strong><span id="tWinSub">—</span></div>
    </div>

    <div class="term-box">
      <div class="term-label"><span>// BALANCE HISTORY</span><span id="tEquityMeta">—</span></div>
      <div id="equityChart" class="equity-chart"></div>
    </div>

    <div class="term-grid">
      <div class="term-box">
        <div class="term-label"><span>// ACTIVITY LOG</span><span id="tLogCount">—</span></div>
        <div class="term-log" id="tLog"></div>
      </div>
      <div class="term-box">
        <div class="term-label"><span id="tBookTitle">// ORDER BOOK</span><span id="tSpread">spread —</span></div>
        <div class="term-book" id="tBook"></div>
      </div>
    </div>

    <div class="term-box engine-box">
      <div class="term-label"><span>// MARKET INTELLIGENCE ENGINE</span><span id="eRegime">—</span></div>
      <div class="engine-head" id="eHead"><p class="term-note">A calcular microestrutura, entropia, regimes, volatilidade, fractais, wavelets, anomalias e causalidade…</p></div>
      <div class="engine-layers" id="eLayers"></div>
      <div class="term-grid inner">
        <div>
          <div class="term-label second"><span>// EARLY WARNING</span><span id="eEarlyState">—</span></div>
          <div class="engine-early" id="eEarly"></div>
        </div>
        <div>
          <div class="term-label second"><span>// INTENÇÃO DO MOVIMENTO</span><span id="eIntentMove">—</span></div>
          <div class="engine-intent" id="eIntent"></div>
        </div>
      </div>
      <div class="term-grid inner">
        <div>
          <div class="term-label second"><span>// GRAFO DE CAUSALIDADE</span><span>Granger · transfer entropy</span></div>
          <div class="engine-graph" id="eGraph"></div>
        </div>
        <div>
          <div class="term-label second"><span>// ANOMALIAS</span><span id="eAnomalyLevel">—</span></div>
          <ul class="term-reasons" id="eAnomalies"></ul>
        </div>
      </div>
      <details class="engine-details"><summary>Leitura detalhada de cada camada</summary><div id="eNotes"></div></details>
      <p class="term-note" id="eDisclaimer"></p>
    </div>

    <div class="term-grid">
      <div class="term-box">
        <div class="term-label"><span>// MOTOR ESTATÍSTICO</span><span id="tRegime">—</span></div>
        <div class="term-quant" id="tQuant"></div>
      </div>
      <div class="term-box">
        <div class="term-label"><span>// CONTEXTO AO VIVO</span><span id="tContextScore">—</span></div>
        <div class="term-context" id="tContext"></div>
        <div class="term-label second"><span>// DECISÃO AGORA</span><span id="tDecision">—</span></div>
        <ul class="term-reasons" id="tDecisionReasons"></ul>
      </div>
    </div>

    <div class="term-box">
      <div class="term-label"><span>// MARKET MECHANICS</span><span id="mechanicsState">—</span></div>
      <div class="term-quant" id="mechanicsGrid"></div>
      <p class="term-note" id="mechanicsNote">A recolher evidência mecânica do mercado…</p>
      <div class="term-ai"><span><i data-lucide="sparkles"></i>LEITURA IA</span><p id="mechanicsAi">A aguardar dados…</p></div>
    </div>

    <div class="term-box">
      <div class="term-label"><span>// NOTÍCIAS E EVENTOS AO VIVO</span><span id="intelStatus">—</span></div>
      <div class="term-tags" id="intelTags">
        <button class="active" type="button" data-tag="ALL">TODOS</button>
        <button type="button" data-tag="BTC">#BTC</button>
        <button type="button" data-tag="CRYPTO">#CRYPTO</button>
        <button type="button" data-tag="MACRO">#MACRO</button>
        <button type="button" data-tag="MARKET">#MARKET</button>
      </div>
      <div class="term-feed" id="intelFeed"></div>
    </div>

    <div class="term-bots" id="tBots"></div>
    <p class="fine-print">Conta demo simulada pela IA. Não executa ordens reais e não é aconselhamento financeiro.</p>
  </section>

  <!-- PERFIL -->
  <section id="perfil" class="screen">
    <header class="page-head">
      <button class="round-btn" type="button" data-route="live" aria-label="Voltar"><i data-lucide="arrow-left"></i></button>
      <div class="grow"><h1>Perfil</h1><p>Conta e preferências</p></div>
    </header>
    <article class="card profile-card">
      <span class="avatar" data-user-initial>G</span>
      <div><b data-user-name>—</b><small data-user-email>—</small></div>
    </article>
    <article class="card">
      <header class="card-head"><b>Aparência</b></header>
      <div class="segmented" data-theme-group>${themeButtons}</div>
    </article>
    <article class="card mt5-card">
      <header class="card-head"><b>MetaTrader 5</b><small id="mt5Status">—</small></header>
      <p class="reading-summary">Liga o teu MT5 para veres no app exatamente o mesmo gráfico da tua corretora, com a IA a analisar os mesmos preços.</p>
      <ol class="mt5-steps">
        <li><a href="/bridge/GrafictraderBridge.mq5" download>Descarrega o EA GrafictraderBridge</a> e copia-o para MQL5 &gt; Experts. Compila no MetaEditor (F7).</li>
        <li>No MT5: Ferramentas &gt; Opções &gt; Expert Advisors &gt; ativa "Permitir WebRequest" e adiciona <code id="mt5Origin">—</code></li>
        <li>Gera a tua chave abaixo e cola-a no EA, com o URL <code id="mt5Url">—</code></li>
        <li>Arrasta o EA para o gráfico (M1, M5, M15, H1 ou H4). O EA só lê preços, não abre ordens.</li>
      </ol>
      <div class="mt5-key" id="mt5KeyBox" hidden><code id="mt5Key"></code><button class="btn btn-soft btn-sm" type="button" id="mt5Copy">Copiar</button></div>
      <button class="btn btn-primary" type="button" id="mt5Generate">Gerar chave de ligação</button>
      <div class="mt5-symbols" id="mt5Symbols"></div>
    </article>
    <article class="card">
      <header class="card-head"><b>Sessão</b><small data-session-mode>—</small></header>
      <button class="btn btn-soft" type="button" id="logoutBtn"><i data-lucide="log-out"></i>Terminar sessão</button>
    </article>
    <article class="card credits">
      <header class="card-head"><b>Créditos</b></header>
      <p>TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc. · <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">tradingview.com</a></p>
      <p>Dados: Binance, TradingView, MetaTrader 5 (via EA), Yahoo Finance, ForexFactory, alternative.me, GDELT, Finnhub, Marketaux.</p>
    </article>
    <p class="fine-print">Grafictrader · análise e operações simuladas, sem execução de ordens reais.</p>
  </section>

  <!-- MENU (top-right) -->
  <div class="menu-backdrop" id="menu" hidden>
    <div class="menu" role="menu" aria-label="Menu">
      <button type="button" role="menuitem" data-route="intel"><span class="menu-icon"><i data-lucide="activity"></i></span><span><b>Live Inteligente</b><small>Informação e estatística em tempo real</small></span></button>
      <button type="button" role="menuitem" data-route="perfil"><span class="menu-icon"><i data-lucide="user"></i></span><span><b>Perfil</b><small>Conta, tema e sessão</small></span></button>
    </div>
  </div>

  <!-- ASSET PICKER -->
  <div class="sheet-backdrop" id="assetSheet" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="assetSheetTitle">
      <div class="sheet-grip"></div>
      <header class="card-head"><b id="assetSheetTitle">Escolher ativo</b><button class="round-btn sm" type="button" data-close-sheet aria-label="Fechar"><i data-lucide="x"></i></button></header>
      <label class="search"><i data-lucide="search"></i><input id="assetSearch" type="search" placeholder="Procurar (ex.: BTC, EURUSD, ouro)" autocomplete="off" aria-label="Procurar ativo"></label>
      <div class="asset-list" id="assetList"></div>
    </div>
  </div>

  <!-- EVENT DETAIL SHEET -->
  <div class="sheet-backdrop" id="eventSheet" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Detalhe do evento">
      <div class="sheet-grip"></div>
      <header class="card-head"><b>Evento</b><button class="round-btn sm" type="button" data-close-sheet aria-label="Fechar"><i data-lucide="x"></i></button></header>
      <div id="eventDetail"></div>
    </div>
  </div>

  <nav class="tabbar" aria-label="Navegação principal">
    <button type="button" data-tab="foto"><i data-lucide="camera"></i><span>FOTO</span></button>
    <button type="button" data-tab="live"><i data-lucide="radio"></i><span>LIVE</span></button>
  </nav>
</div>`;
