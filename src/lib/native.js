import { Capacitor, registerPlugin } from '@capacitor/core';

/** The Android app's native bridge (bubble watcher, alerts); null in a browser. Registered once. */
export const Native = Capacitor.isNativePlatform() ? registerPlugin('GrafictraderNative') : null;
