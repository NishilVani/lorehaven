/* The app's own Kotlin code (LoreHavenPlugin.kt), reached through the
 * `native_call` app command, which forwards only the methods it names
 * (src-tauri/src/android_native.rs).
 *
 * Resolves to null off Android. Rejects on an APK built before a method
 * existed ("native_call not found", or "not a native method"); every caller
 * catches, so an older APK on a newer web bundle just goes without. */
import { isAndroidApp } from './device.js';

export async function nativeCall(method, args = {}) {
  if (!isAndroidApp()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('native_call', { method, args });
}

/** Status and navigation bar icons to match the page: light icons on a dark
    theme, dark icons on a light one. */
export function setSystemBars(scheme) {
  return nativeCall('setSystemBars', { light: scheme === 'light' }).catch(() => null);
}
