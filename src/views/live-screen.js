import { $$ } from '../lib/dom.js';
import { initLive, activateLive, deactivateLive } from './live.js';
import { initWatch } from './watch.js';

// The LIVE screen opens on "Minha corretora" (the AI watches the user's own
// broker). "Gráficos e robô IA" (built-in chart + instructor, in development)
// is reached from the menu and has a back button. A broker session keeps
// running when the user moves to other screens.
let mode = 'broker';
let active = false;

function apply() {
  $$('[data-live-title]').forEach(el => { el.hidden = el.dataset.liveTitle !== mode; });
  $$('[data-live-pane]').forEach(pane => { pane.hidden = pane.dataset.livePane !== mode; });
  if (active && mode === 'market') activateLive();
  else deactivateLive();
}

export function initLiveScreen() {
  try { localStorage.removeItem('grafictrader.liveMode'); } catch { /* old setting, no longer used */ }
  initLive();
  initWatch();
  $$('[data-live-mode]').forEach(btn => { btn.onclick = () => setLiveMode(btn.dataset.liveMode); });
  apply();
}

/** Shows "Minha corretora" ('broker') or the charts and AI robot ('market'). */
export function setLiveMode(next) {
  mode = next === 'market' ? 'market' : 'broker';
  apply();
  window.scrollTo(0, 0);
}

export function activateLiveScreen() {
  active = true;
  apply();
}

export function deactivateLiveScreen() {
  active = false;
  deactivateLive();
}
