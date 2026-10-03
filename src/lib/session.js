import { api, ApiError } from './dom.js';

const LOCAL_KEY = 'grafictrader.localProfile';

// mode: 'server' when accounts are configured on the backend, 'local' when
// the backend has no account store (profile kept only on this device).
const state = { mode: 'server', user: null };

function readLocalProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    return profile?.name ? { name: String(profile.name).slice(0, 60), email: null, local: true } : null;
  } catch {
    return null;
  }
}

export function currentUser() {
  return state.user;
}

export function sessionMode() {
  return state.mode;
}

export async function loadSession() {
  try {
    const data = await api('/api/auth?action=me');
    state.mode = 'server';
    state.user = data.user;
  } catch (error) {
    const setupRequired = error instanceof ApiError && error.data?.setupRequired;
    const noBackend = !(error instanceof ApiError) || error.status === 404;
    if (setupRequired || noBackend) {
      state.mode = 'local';
      state.user = readLocalProfile();
    } else {
      state.mode = 'server';
      state.user = null;
    }
  }
  return state;
}

export async function login(email, password) {
  const data = await api('/api/auth?action=login', { method: 'POST', body: { email, password } });
  state.user = data.user;
  return data.user;
}

export async function register(name, email, password) {
  const data = await api('/api/auth?action=register', { method: 'POST', body: { name, email, password } });
  state.user = data.user;
  return data.user;
}

export function startLocalProfile(name) {
  const clean = String(name || '').trim().slice(0, 60);
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ name: clean })); } catch { /* session-only */ }
  state.user = { name: clean, email: null, local: true };
  return state.user;
}

export async function logout() {
  if (state.mode === 'server') {
    await api('/api/auth?action=logout', { method: 'POST' }).catch(() => {});
  } else {
    try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ }
  }
  state.user = null;
}
