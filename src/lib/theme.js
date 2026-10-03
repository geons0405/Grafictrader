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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e0e0f' : '#efefef');
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

/** Monochrome chart palette matching the CSS tokens of each theme. */
export function chartPalette(theme = resolvedTheme()) {
  return theme === 'dark'
    ? { background: '#1c1c1e', text: '#8e8e93', grid: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.08)', up: '#f5f5f7', down: '#5c5c61', crosshair: '#48484d' }
    : { background: '#ffffff', text: '#8a8a8e', grid: 'rgba(0,0,0,0.045)', border: 'rgba(0,0,0,0.07)', up: '#111113', down: '#b4b4b9', crosshair: '#c7c7cc' };
}

export function chartOptions(theme) {
  const p = chartPalette(theme);
  return {
    // Explicit locale: some runtimes report tags like "en-US@posix" that
    // Intl rejects, which made the chart throw on every price label.
    localization: { locale: 'pt-PT' },
    layout: { background: { type: 'solid', color: p.background }, textColor: p.text, fontFamily: 'Inter, system-ui, sans-serif', attributionLogo: true },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false },
    crosshair: {
      mode: 1,
      vertLine: { color: p.crosshair, width: 1, labelBackgroundColor: p.up },
      horzLine: { color: p.crosshair, width: 1, labelBackgroundColor: p.up }
    }
  };
}

export function seriesOptions(theme) {
  const p = chartPalette(theme);
  return { upColor: p.up, downColor: p.down, borderUpColor: p.up, borderDownColor: p.down, wickUpColor: p.up, wickDownColor: p.down };
}
