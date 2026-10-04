const KEY = 'grafictrader.theme';
const listeners = new Set();
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePreference() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolvedTheme(preference = getThemePreference()) {
  if (preference === 'system') return media.matches ? 'dark' : 'light';
  return preference;
}

export function applyTheme(preference = getThemePreference()) {
  try {
    if (preference === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch { /* storage unavailable: theme still applies for this visit */ }
  const theme = resolvedTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0b0d' : '#efeeea');
  listeners.forEach(fn => fn(theme, preference));
  return theme;
}

export function toggleTheme() {
  return applyTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media.addEventListener('change', () => {
  if (getThemePreference() === 'system') applyTheme('system');
});

/** Chart palette matching the CSS tokens of each theme. The background is
 *  transparent so the chart sits on the card's frosted glass. */
export function chartPalette(theme = resolvedTheme()) {
  return theme === 'dark'
    ? { background: 'transparent', text: '#9a9aa3', grid: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.08)', up: '#3dd68c', down: '#ff6b72', crosshair: 'rgba(255,255,255,0.28)', label: '#f4f4f6' }
    : { background: 'transparent', text: '#6b6b74', grid: 'rgba(20,20,26,0.05)', border: 'rgba(20,20,26,0.08)', up: '#0e7c4a', down: '#c8323a', crosshair: 'rgba(20,20,26,0.25)', label: '#111114' };
}

// Candle times are UTC seconds; people read their phone's local time.
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const asDate = time => (typeof time === 'number' ? new Date(time * 1000) : null);

export function localTick(time, type) {
  const d = asDate(time);
  if (!d) return '';
  if (type === 0) return String(d.getFullYear());
  if (type === 1) return MONTHS[d.getMonth()];
  if (type === 2) return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localTime(time) {
  const d = asDate(time);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

export function chartOptions(theme) {
  const p = chartPalette(theme);
  return {
    // Explicit locale: some runtimes report tags like "en-US@posix" that
    // Intl rejects, which made the chart throw on every price label.
    localization: { locale: 'pt-PT', timeFormatter: localTime },
    // Vertical swipes scroll the page on phones; the chart never scrolls past the last candle.
    handleScroll: { vertTouchDrag: false },
    layout: { background: { type: 'solid', color: p.background }, textColor: p.text, fontFamily: 'Geist, system-ui, sans-serif', attributionLogo: true },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false, fixRightEdge: true, rightOffset: 4, tickMarkFormatter: localTick },
    crosshair: {
      mode: 1,
      vertLine: { color: p.crosshair, width: 1, labelBackgroundColor: p.label },
      horzLine: { color: p.crosshair, width: 1, labelBackgroundColor: p.label }
    }
  };
}

export function seriesOptions(theme) {
  const p = chartPalette(theme);
  return { upColor: p.up, downColor: p.down, borderUpColor: p.up, borderDownColor: p.down, wickUpColor: p.up, wickDownColor: p.down };
}
