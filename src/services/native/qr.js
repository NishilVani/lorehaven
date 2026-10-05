/* QR codes. Scanning is Android only (the official barcode-scanner plugin,
 * full-screen camera); what a scan opens is decided by the same rules as text
 * shared into the app (shareIn.js), so a LoreHaven link opens its page, a
 * Steam link its game, and anything else becomes a search. Showing a code is
 * everywhere: QrCodeDialog renders the game's https://lorehaven.app link.
 */
import { parseSharedText, searchRoute } from './shareIn.js';

/** { outcome: 'scanned', content } | { outcome: 'denied' } | { outcome: 'cancelled' } */
export async function scanQrCode() {
  const bs = await import('@tauri-apps/plugin-barcode-scanner');
  let permission = await bs.checkPermissions().catch(() => 'prompt');
  if (permission !== 'granted') permission = await bs.requestPermissions().catch(() => 'denied');
  if (permission !== 'granted') return { outcome: 'denied' };
  try {
    const res = await bs.scan({ windowed: false, formats: [bs.Format.QRCode] });
    const content = String(res?.content || '').trim();
    return content ? { outcome: 'scanned', content } : { outcome: 'cancelled' };
  } catch {
    return { outcome: 'cancelled' };
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
