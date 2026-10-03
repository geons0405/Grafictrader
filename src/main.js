import './styles.css';
import { $, $$ } from './lib/dom.js';
import { renderIcons } from './lib/icons.js';
import { applyTheme, toggleTheme, getThemePreference, onThemeChange } from './lib/theme.js';
import { loadSession, currentUser, sessionMode, login, register, startLocalProfile, logout } from './lib/session.js';
import { shellTemplate } from './views/shell.js';
import { initLive, activateLive, deactivateLive } from './views/live.js';
import { initFoto, deactivateFoto } from './views/foto.js';
import { initIntel, activateIntel, deactivateIntel } from './views/intel.js';
import { initSheets, closeSheet } from './views/sheet.js';

const PUBLIC_ROUTES = ['home', 'login', 'register'];
const PRIVATE_ROUTES = ['live', 'foto', 'intel', 'perfil'];
const TITLES = { home: 'Grafictrader', login: 'Entrar', register: 'Criar conta', live: 'Live', foto: 'Foto', intel: 'Live Inteligente', perfil: 'Perfil' };

const VIEWS = {
  live: { activate: activateLive, deactivate: deactivateLive },
  foto: { deactivate: deactivateFoto },
  intel: { activate: activateIntel, deactivate: deactivateIntel }
};

let currentRoute = null;

$('#app').innerHTML = shellTemplate;
applyTheme();
renderIcons();

function syncThemeControls() {
  const preference = getThemePreference();
  $$('[data-theme-choice]').forEach(btn => {
    const on = btn.dataset.themeChoice === preference;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function renderUser() {
  const user = currentUser();
  const name = user?.name || 'trader';
  $$('[data-user-name]').forEach(el => { el.textContent = name; });
  $$('[data-user-initial]').forEach(el => { el.textContent = name.charAt(0).toUpperCase(); });
  $$('[data-user-email]').forEach(el => { el.textContent = user?.email || 'Perfil guardado neste dispositivo'; });
  $$('[data-session-mode]').forEach(el => { el.textContent = sessionMode() === 'server' ? 'Conta no servidor' : 'Modo local'; });
}

function renderAuthMode() {
  const local = sessionMode() === 'local';
  document.body.classList.toggle('auth-local', local);
  $$('[data-server-only]').forEach(el => {
    el.hidden = local;
    el.querySelectorAll('input').forEach(input => { input.disabled = local; });
  });
  $$('[data-local-notice]').forEach(el => { el.hidden = !local; });
  $('[data-register-title]').textContent = local ? 'Criar perfil local' : 'Criar a tua conta';
  $('[data-register-copy]').textContent = local
    ? 'Sem contas no servidor: o teu nome fica guardado apenas neste dispositivo.'
    : 'Guarda as tuas preferências e acede de qualquer dispositivo.';
  $('[data-register-cta]').textContent = local ? 'Continuar' : 'Criar conta';
}

function show(route) {
  let target = [...PUBLIC_ROUTES, ...PRIVATE_ROUTES].includes(route) ? route : 'home';
  const user = currentUser();
  if (PRIVATE_ROUTES.includes(target) && !user) target = 'login';
  if (PUBLIC_ROUTES.includes(target) && user) target = 'live';
  closeMenu();

  if (target !== currentRoute) {
    VIEWS[currentRoute]?.deactivate?.();
    closeSheet();
    $$('.screen').forEach(screen => screen.classList.toggle('active', screen.id === target));
    // Live Inteligente and Perfil are reached from the LIVE menu.
    const tabTarget = target === 'intel' || target === 'perfil' ? 'live' : target;
    $$('[data-tab]').forEach(tab => {
      const on = tab.dataset.tab === tabTarget;
      tab.classList.toggle('active', on);
      if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
    document.body.classList.toggle('is-public', PUBLIC_ROUTES.includes(target));
    document.title = TITLES[target] + ' · Grafictrader';
    currentRoute = target;
    window.scrollTo(0, 0);
    VIEWS[target]?.activate?.();
  }
  if (location.hash !== '#' + target) history.replaceState(null, '', '#' + target);
}

const navigate = route => {
  if (location.hash === '#' + route) show(route);
  else location.hash = route;
};

function formMessage(form, text) {
  form.querySelector('.form-message').textContent = text || '';
}

async function submitAuth(form, action) {
  const button = form.querySelector('button[type="submit"]');
  formMessage(form, '');
  const data = Object.fromEntries(new FormData(form));

  if (sessionMode() === 'local') {
    if (!String(data.name || '').trim()) return formMessage(form, 'Indica o teu nome.');
    startLocalProfile(data.name);
    renderUser();
    return navigate('live');
  }

  if (action === 'register' && !String(data.name || '').trim()) return formMessage(form, 'Indica o teu nome.');
  if (!form.querySelector('input[type="email"]').checkValidity()) return formMessage(form, 'Indica um email válido.');
  if (action === 'register' && String(data.password || '').length < 8) return formMessage(form, 'A palavra-passe deve ter pelo menos 8 caracteres.');
  if (!data.password) return formMessage(form, 'Indica a palavra-passe.');

  button.disabled = true;
  try {
    if (action === 'login') await login(data.email, data.password);
    else await register(data.name, data.email, data.password);
    form.reset();
    renderUser();
    navigate('live');
  } catch (error) {
    if (error.data?.setupRequired) {
      await loadSession();
      renderAuthMode();
    }
    formMessage(form, error.message);
  } finally {
    button.disabled = false;
  }
}

function openMenu() {
  const menu = $('#menu');
  menu.hidden = false;
  requestAnimationFrame(() => menu.classList.add('open'));
  menu.querySelector('button')?.focus();
}

function closeMenu() {
  const menu = $('#menu');
  if (menu.hidden) return;
  menu.classList.remove('open');
  menu.hidden = true;
}

function wire() {
  document.addEventListener('click', event => {
    const route = event.target.closest('[data-route]');
    if (route) {
      closeMenu();
      return navigate(route.dataset.route);
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) return navigate(tab.dataset.tab);
    if (event.target.closest('[data-theme-toggle]')) return toggleTheme();
    const choice = event.target.closest('[data-theme-choice]');
    if (choice) return applyTheme(choice.dataset.themeChoice);
    if (event.target.closest('[data-open-menu]')) return openMenu();
  });
  $('#menu').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  $('#loginForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'login'); });
  $('#registerForm').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'register'); });
  $('#logoutBtn').addEventListener('click', async () => {
    await logout();
    renderUser();
    navigate('home');
  });

  onThemeChange(syncThemeControls);
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
}

async function boot() {
  initSheets();
  initLive();
  initFoto();
  initIntel();
  wire();
  syncThemeControls();
  await loadSession();
  renderAuthMode();
  renderUser();
  document.body.classList.remove('booting');
  show(location.hash.slice(1) || 'home');
}

boot();
