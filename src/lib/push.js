import { api } from './dom.js';
import { Capacitor } from '@capacitor/core';
import { Native } from './native.js';

// Opportunity alerts through the browser's Web Push. The Android app's WebView has no
// Web Push: there the app itself checks the server every 15 minutes (AlertsWorker).

/** True inside the Android app, where alerts are collected by the app. */
export const appAlerts = () => Boolean(Native);

/** Whether this app's alert checks are on, and whether Android lets it notify. */
export async function appAlertsStatus() {
  try {
    return await Native.alertsStatus();
  } catch {
    return { on: false, notifications: true }; // an older app without alerts
  }
}

export async function enableAppAlerts({ markets, interval }) {
  const result = await api('/api/auth?action=push-app', { method: 'POST', body: { markets, interval } });
  try {
    await Native.enableAlerts();
  } catch {
    throw new Error('Esta versão da app ainda não tem alertas. Instala a versão mais recente do APK.');
  }
  return result;
}

export async function disableAppAlerts() {
  await api('/api/auth?action=push-app-off', { method: 'POST', body: {} });
  await Native.disableAlerts().catch(() => {});
}

export const pushSupported = () => !Capacitor.isNativePlatform()
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** This device's current subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Asks for permission, subscribes this device and saves the choice of markets and timeframe. */
export async function enableAlerts({ markets, interval, publicKey }) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Sem autorização para notificações. Permite as notificações deste site nas definições do navegador.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return api('/api/auth?action=push', { method: 'POST', body: { subscription: subscription.toJSON(), markets, interval } });
}

/** Stops alerts on this device. */
export async function disableAlerts() {
  const subscription = await currentSubscription();
  await api('/api/auth?action=push-off', { method: 'POST', body: { endpoint: subscription?.endpoint || null } });
  await subscription?.unsubscribe().catch(() => {});
}
