import { api } from './dom.js';
import { Capacitor } from '@capacitor/core';

// Opportunity alerts through the browser's Web Push. The Android app's WebView has no
// Web Push, so there the alerts are turned on from Chrome instead.

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
