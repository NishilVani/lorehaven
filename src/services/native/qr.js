/* QR codes. Scanning is Android only (the official barcode-scanner plugin,
 * full-screen camera); what a scan opens is decided by the same rules as text
 * shared into the app (shareIn.js), so a LoreHaven link opens its page, a
 * Steam link its game, and anything else becomes a search. Showing a code is
 * everywhere: QrCodeDialog renders the game's https://lorehaven.app link.
 */
import { parseSharedText, searchRoute } from './shareIn.js';
import { syncBackClaim } from './back.js';

/** { outcome: 'scanned', content } | { outcome: 'denied' } | { outcome: 'cancelled' } */
export async function scanQrCode() {
  const bs = await import('@tauri-apps/plugin-barcode-scanner');
  let permission = await bs.checkPermissions().catch(() => 'prompt');
  if (permission !== 'granted') permission = await bs.requestPermissions().catch(() => 'denied');
  if (permission !== 'granted') return { outcome: 'denied' };
  /* The camera is full screen with no controls of its own, so Back is the
     way out. At the root page nothing claimed the gesture, and Android's
     default Back closed the activity: the whole app quit mid-scan. Marked as
     an overlay, the scan claims Back (back.js), and the Escape back sends
     cancels it. The mark goes the moment Escape arrives, so back.js sees the
     overlay closed and does not also go back a page. */
  const body = document.body;
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    body.removeAttribute('data-overlay-open');
    bs.cancel().catch(() => {});
  };
  body.setAttribute('data-overlay-open', 'scanner');
  document.addEventListener('keydown', onKey, true);
  syncBackClaim();
  try {
    const res = await bs.scan({ windowed: false, formats: [bs.Format.QRCode] });
    const content = String(res?.content || '').trim();
    return content ? { outcome: 'scanned', content } : { outcome: 'cancelled' };
  } catch {
    return { outcome: 'cancelled' };
  } finally {
    document.removeEventListener('keydown', onKey, true);
    body.removeAttribute('data-overlay-open');
    syncBackClaim();
  }
}

/**
 * Where a scanned code goes: { route } to navigate now, { steam, query } to
 * match first, or null for a code that is not about a game.
 */
export function routeForScan(content) {
  const shared = parseSharedText(content);
  if (!shared) return null;
  if (shared.kind === 'route') return { route: shared.route };
  if (shared.kind === 'steam') return { steam: shared.appid, query: shared.query };
  /* A bare word from a QR code is rarely a game title (Wi-Fi codes, menus),
     so only searches that came with a link's words are offered. */
  return /^https?:\/\//i.test(content) ? { route: searchRoute(shared.query) } : null;
}
