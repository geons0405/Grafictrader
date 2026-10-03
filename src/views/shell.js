import { ASSETS, INTERVALS } from '../lib/store.js';

const assetChips = ASSETS.map(asset =>
  `<button class="chip" type="button" data-symbol="${asset.symbol}" data-search="${asset.short} ${asset.name}"><span class="chip-dot"></span>${asset.short}</button>`
).join('');

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
      <p>Gráficos ao vivo, leitura técnica, mecânica de mercado e análise de fotos com IA, num só lugar.</p>
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

  <!-- DASHBOARD / LIVE -->
  <section id="live" class="screen">
    <header class="greeting">
      <div>
        <h1>Olá, <b data-user-name>trader</b></h1>
        <p>O que queres analisar hoje?</p>
      </div>
      <button class="round-btn" type="button" data-theme-toggle aria-label="Alternar tema"><i data-lucide="moon" class="when-light"></i><i data-lucide="sun" class="when-dark"></i></button>
    </header>

    <div class="search-row">
      <label class="search"><i data-lucide="search"></i><input id="assetSearch" type="search" placeholder="Procurar ativo" autocomplete="off" aria-label="Procurar ativo"></label>
      <button class="square-btn" type="button" data-open-sheet aria-label="Preferências"><i data-lucide="sliders-horizontal"></i></button>
    </div>

    <div class="chips" id="assetChips">${assetChips}</div>

    <div class="bento">
      <article class="card price-card">
        <small id="pairLabel">BTC/USDT</small>
        <strong id="price">—</strong>
        <span class="delta" id="change">—</span>
      </article>
      <article class="card upload-card">
        <button class="well" type="button" data-route="foto">
          <i data-lucide="upload"></i>
          <b>Analisar gráfico</b>
          <small>Foto ou imagem · IA multimodal</small>
        </button>
        <button class="btn btn-primary btn-sm" type="button" data-route="foto">Abrir câmara</button>
      </article>
      <article class="card status-card">
        <span class="status-icon"><i data-lucide="radio"></i></span>
        <span class="status-text"><b id="connection">A ligar</b><small id="streamState">A aguardar dados</small></span>
      </article>
    </div>

    <div class="segmented" id="timeframes" role="tablist" aria-label="Timeframe">${timeframeButtons}</div>

    <article class="card chart-card">
      <header class="card-head"><b>Gráfico</b><small id="chartMeta">Binance · 5 minutos</small></header>
      <div id="chart" class="chart"></div>
    </article>

    <div class="bento-2">
      <article class="card stat-card">
        <small>RSI 14</small>
        <strong id="rsi">—</strong>
        <span id="rsiState">Sem dados</span>
        <div class="mini-bars" id="volumeBars" aria-hidden="true"></div>
      </article>
      <article class="card ring-card">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48" class="ring-track" pathLength="100"/><circle cx="60" cy="60" r="48" class="ring-value" pathLength="100" id="confidenceRing" style="--value:0"/></svg>
        <div class="ring-center"><strong id="confidence">—</strong><small>Confluência</small></div>
      </article>
    </div>

    <article class="card reading-card">
      <header class="card-head"><b>Leitura técnica</b><small>automática · regras</small></header>
      <div class="pill-row">
        <span class="pill" id="trend"><i data-lucide="trending-up" class="when-up"></i><i data-lucide="trending-down" class="when-down"></i><span>—</span></span>
        <span class="pill" id="structure">—</span>
      </div>
      <p id="readingSummary" class="reading-summary">A aguardar dados suficientes para gerar a leitura.</p>
      <div class="levels">
        <div><small>Suporte</small><b id="support">—</b></div>
        <div><small>Resistência</small><b id="resistance">—</b></div>
      </div>
      <p class="fine-print left">Regras objetivas (EMA 20/50, estrutura de swings, RSI de Wilder, momentum). Não é uma previsão.</p>
    </article>
  </section>

  <!-- FOTO -->
  <section id="foto" class="screen">
    <header class="page-head">
      <div><h1>Foto do gráfico</h1><p>Captura ou carrega uma imagem para análise por IA</p></div>
    </header>
    <article class="card camera-card">
      <div class="camera" id="camera">
        <video id="video" autoplay playsinline muted></video>
        <div class="camera-guide"><b>Enquadra o gráfico inteiro</b><small>Velas · preço · timeframe · indicadores</small></div>
        <span class="camera-status" id="cameraStatus">Câmara desligada</span>
      </div>
      <div class="camera-actions">
        <button class="btn btn-soft" type="button" id="startCam"><i data-lucide="camera"></i>Abrir câmara</button>
        <button class="btn btn-primary" type="button" id="snap" disabled>Capturar</button>
      </div>
      <label class="btn btn-ghost upload-file"><i data-lucide="image"></i>Carregar imagem<input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp" hidden></label>
    </article>
    <div id="analysis" class="analysis" hidden></div>
    <p class="fine-print">A IA descreve o que é visível na imagem; não garante resultados.</p>
  </section>

  <!-- INTEL -->
  <section id="intel" class="screen">
    <header class="page-head">
      <div><h1>Live Intelligence</h1><p id="intelSubtitle">Mercado · mecânica · notícias</p></div>
      <button class="round-btn" type="button" id="intelRefresh" aria-label="Atualizar"><i data-lucide="refresh-cw"></i></button>
    </header>

    <div class="pulse">
      <article class="card mini"><small>BTC</small><b id="pulseBtcPrice">—</b><span class="delta" id="pulseBtcChange">—</span></article>
      <article class="card mini"><small>ETH</small><b id="pulseEthPrice">—</b><span class="delta" id="pulseEthChange">—</span></article>
      <article class="card mini"><small>Pulso</small><b id="pulseState">—</b><span>24h</span></article>
    </div>

    <article class="card">
      <header class="card-head"><b id="intelAssetLabel">BTC/USDT</b><small id="intelMarketChange">—</small></header>
      <div class="kv-grid">
        <div><small>Preço</small><b id="intelMarketPrice">—</b></div>
        <div><small>Volume 24h</small><b id="intelVolume">—</b></div>
        <div><small>Máx. 24h</small><b id="intelHigh">—</b></div>
        <div><small>Mín. 24h</small><b id="intelLow">—</b></div>
      </div>
    </article>

    <article class="card mechanics-card" aria-live="polite">
      <header class="card-head"><b>Market Mechanics</b><span class="pill pill-strong" id="mechanicsState">A analisar</span></header>
      <small class="muted-line" id="mechanicsQuality">—</small>
      <div class="metric-grid" id="mechanicsGrid"></div>
      <p class="reading-summary" id="mechanicsNote">A recolher evidência mecânica do mercado…</p>
      <div class="inset" id="mechanicsMemory">Memória · a aguardar histórico…</div>
      <div class="ai-box">
        <header><span><i data-lucide="sparkles"></i>Interpretação IA</span><small id="mechanicsAiMeta">Gemini</small></header>
        <p id="mechanicsAi">A aguardar dados…</p>
      </div>
    </article>

    <div class="feed-head">
      <b id="intelCount">0 eventos</b>
      <small id="intelStatus">A ligar às fontes…</small>
    </div>
    <div class="chips" id="intelTags">
      <button class="chip active" type="button" data-tag="ALL">Todos</button>
      <button class="chip" type="button" data-tag="BTC">#BTC</button>
      <button class="chip" type="button" data-tag="CRYPTO">#Crypto</button>
      <button class="chip" type="button" data-tag="MACRO">#Macro</button>
      <button class="chip" type="button" data-tag="NEWS">#News</button>
      <button class="chip" type="button" data-tag="MARKET">#Market</button>
    </div>
    <div class="feed" id="intelFeed" aria-live="polite"></div>
  </section>

  <!-- PERFIL -->
  <section id="perfil" class="screen">
    <header class="page-head"><div><h1>Perfil</h1><p>Conta e preferências</p></div></header>
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
    <p class="fine-print">Grafictrader · apenas análise, sem execução de ordens.</p>
  </section>

  <!-- PREFERENCES SHEET -->
  <div class="sheet-backdrop" id="sheet" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
      <div class="sheet-grip"></div>
      <header class="card-head"><b id="sheetTitle">Preferências</b><button class="round-btn sm" type="button" data-close-sheet aria-label="Fechar"><i data-lucide="x"></i></button></header>
      <small class="sheet-label">Timeframe</small>
      <div class="segmented" data-sheet-timeframes>${timeframeButtons}</div>
      <small class="sheet-label">Tema</small>
      <div class="segmented" data-theme-group>${themeButtons}</div>
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
    <button type="button" data-tab="live"><i data-lucide="home"></i><span>Início</span></button>
    <button type="button" data-tab="foto"><i data-lucide="camera"></i><span>Foto</span></button>
    <button type="button" data-tab="intel"><i data-lucide="chart-pie"></i><span>Intel</span></button>
    <button type="button" data-tab="perfil"><i data-lucide="user"></i><span>Perfil</span></button>
  </nav>
</div>`;
