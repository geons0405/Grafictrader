import { ASSETS, INTERVALS } from '../lib/store.js';

const assetOptions = ASSETS.map(asset => `<option value="${asset.symbol}">${asset.short}/USDT</option>`).join('');

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
    <header class="live-head">
      <label class="asset-pill"><span class="sr-only">Ativo</span><select id="assetSelect" aria-label="Ativo">${assetOptions}</select><i data-lucide="chevron-down"></i></label>
      <div class="live-quote"><strong id="price">—</strong><span class="delta" id="change">—</span></div>
      <button class="round-btn" type="button" data-open-menu aria-label="Menu"><i data-lucide="sliders-horizontal"></i></button>
    </header>
    <div class="segmented" id="timeframes" role="tablist" aria-label="Timeframe">${timeframeButtons}</div>
    <article class="card chart-card">
      <header class="card-head"><b><span class="dot" id="liveDot"></span><span id="connection">A ligar</span></b><small id="chartMeta">Binance · 5 minutos</small></header>
      <div id="chart" class="chart"></div>
    </article>

    <article class="card instructor" id="instructor" aria-live="polite">
      <header class="card-head">
        <b class="instructor-title"><i data-lucide="bot"></i>IA instrutora</b>
        <small id="instructorMode">a carregar…</small>
      </header>
      <div class="position" id="positionBox">
        <span class="badge" id="positionBadge">—</span>
        <div class="position-main">
          <b id="positionTitle">A preparar o instrutor…</b>
          <small id="positionSub">A analisar o histórico de velas.</small>
        </div>
        <div class="position-pnl"><strong id="positionPnl">—</strong><small id="positionPnlSub"></small></div>
      </div>
      <div class="levels levels-3" id="positionLevels" hidden>
        <div><small>Entrada</small><b id="lvEntry">—</b></div>
        <div><small>Stop</small><b id="lvStop" class="neg">—</b></div>
        <div><small>Alvo</small><b id="lvTarget" class="pos">—</b></div>
      </div>
      <ul class="reasons" id="instructorReasons"></ul>
      <div class="stat-row">
        <div><small>Win rate</small><b id="stWin">—</b></div>
        <div><small>Operações</small><b id="stTrades">—</b></div>
        <div><small>Conta demo</small><b id="stPnl">—</b></div>
      </div>
      <div class="ops" id="recentOps"></div>
      <p class="fine-print left">Operações simuladas pela IA (conta demo de $1.000, risco 1% por operação). Copiar é por tua conta e risco; resultados passados não garantem resultados futuros.</p>
    </article>
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
    <article class="card">
      <header class="card-head"><b>Sessão</b><small data-session-mode>—</small></header>
      <button class="btn btn-soft" type="button" id="logoutBtn"><i data-lucide="log-out"></i>Terminar sessão</button>
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
