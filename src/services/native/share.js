/* Share a link the best way the platform offers:
 *   Android app  the system share sheet (sharekit plugin); Android's WebView
 *                has no Web Share API, which is why Share Link used to copy
 *   browser      navigator.share where it exists (phones, Safari)
 *   otherwise    the clipboard
 * → 'shared' | 'copied' | 'cancelled' | 'failed'. The caller toasts only for
 * 'copied' and 'failed'; a share sheet is its own confirmation. */
import { isAndroidApp } from './device.js';

export async function shareLink({ title, url }) {
  if (isAndroidApp()) {
    try {
      const { shareText } = await import('@choochmeque/tauri-plugin-sharekit-api');
      await shareText(title ? `${title}\n${url}` : url, { mimeType: 'text/plain' });
      return 'shared';
    } catch (err) {
      /* The sheet opened and came back "cancelled". Android's chooser reports
         that unreliably (many apps return it after a real share too), so it is
         not a failure to fall back from: falling through here copied the link
         and toasted, or toasted "Could not copy" when the WebView lacked focus
         for the clipboard. */
      if (/cancel/i.test(String(err?.message ?? err))) return 'cancelled';
      /* An APK built before the plugin: fall through to the clipboard. */
    }
  }
  try {
    if (!isAndroidApp() && navigator.share) {
      await navigator.share({ title, url });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
