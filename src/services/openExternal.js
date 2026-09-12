/**
 * Hands a URL to the host OS: the Tauri shell plugin inside the app, a new tab
 * on the web.
 *
 * `window.open` and `target="_blank"` are not substitutes inside Tauri. The
 * webview has no popup handling, so on Android a plain external link silently
 * does nothing. The shell plugin is already allowed for `^https?://.+` in
 * src-tauri/capabilities/default.json.
 */
export const isTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export async function openExternal(url) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
