import { $$ } from '../lib/dom.js';
import { initLive, activateLive, deactivateLive } from './live.js';
import { initWatch } from './watch.js';

// The LIVE screen has two modes: "Minha corretora" (the AI watches the
// user's own broker) and "Gráfico do mercado" (built-in chart + instructor).
// A broker session keeps running when the user moves to other screens.
const MODE_KEY = 'grafictrader.liveMode';
let mode = 'broker';
let active = false;

function apply() {
  $$('[data-live-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.liveMode === mode));
  $$('[data-live-pane]').forEach(pane => { pane.hidden = pane.dataset.livePane !== mode; });
  if (active && mode === 'market') activateLive();
  else deactivateLive();
}

export function initLiveScreen() {
  try { mode = localStorage.getItem(MODE_KEY) === 'market' ? 'market' : 'broker'; } catch { /* default */ }
  initLive();
  initWatch();
  $$('[data-live-mode]').forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.liveMode;
      try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
      apply();
    };
  });
  apply();
}

export function activateLiveScreen() {
  active = true;
  apply();
}

export function deactivateLiveScreen() {
  active = false;
  deactivateLive();
}
