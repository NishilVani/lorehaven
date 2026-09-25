/* The Android OTA bundles, served read-only out of R2.
 *
 * Design: docs/superpowers/specs/2026-09-09-android-ota-design.md
 *
 * A second job for a Worker that is otherwise a credential proxy, so the
 * boundary is written down: this route authenticates NOTHING and forwards
 * NOTHING. It only reads public, immutable build output from the bucket bound
 * as OTA, and it never touches the IGDB or Twitch credentials or the ALLOWED
 * list in proxy.js. Nothing here can reach an upstream.
 *
 *   ota/android.json        the manifest: the one mutable key, the pointer
 *   ota/<version>/<path>    a release's dist/ tree, never overwritten
 *
 * Two headers decide whether the app boots at all, and both are set here:
 *   - Access-Control-Allow-Origin, because module scripts are fetched in cors
 *     mode and the page's origin is the APK's own, not this Worker's;
 *   - Content-Type, because a module script with a non-JavaScript type is
 *     refused outright. R2 carries it per object from upload; the extension
 *     table below is the fallback if an upload ever forgets.
 */

const TYPES = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

export const MANIFEST_KEY = 'ota/android.json';

/** The R2 key for a request path, or null if it is not one we serve. PURE. */
export function otaKey(pathname) {
  const rest = pathname.replace(/^\/+ota\//, '');
  if (!rest || rest === pathname.replace(/^\/+/, '')) return null;
  let parts;
  try { parts = rest.split('/').map(decodeURIComponent); } catch { return null; }
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\/]/.test(p))) return null;
  if (rest === 'android.json') return MANIFEST_KEY;
  if (!/^\d+\.\d+\.\d+$/.test(parts[0]) || parts.length < 2) return null;
  return `ota/${parts.join('/')}`;
}

export const contentTypeFor = (key, stored) => {
  if (stored) return stored;
  const ext = key.split('.').pop().toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
};

const base = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'x-content-type-options': 'nosniff',
};

export async function otaRoute(req, env) {
  const { pathname } = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: base });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('GET only', { status: 405, headers: base });
  }
  const key = otaKey(pathname);
  if (!key) return new Response('not found', { status: 404, headers: base });
  if (!env.OTA) return new Response('OTA storage is not bound', { status: 503, headers: base });

  const obj = req.method === 'HEAD' ? await env.OTA.head(key) : await env.OTA.get(key);
  if (!obj) return new Response('not found', { status: 404, headers: base });

  const headers = {
    ...base,
    'content-type': contentTypeFor(key, obj.httpMetadata?.contentType),
    /* The manifest is the switch, so it is always revalidated. Everything else
       is content-hashed or versioned and never changes under its key. */
    'cache-control': key === MANIFEST_KEY ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  if (obj.httpEtag) headers.etag = obj.httpEtag;
  return new Response(req.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}
