/* The Android OTA bootstrap: the only code in index.html that runs before the
 * app. scripts/vite-ota-bootstrap.mjs inlines it after src/services/version.js
 * and src/ota/policy.js, and defines EMBEDDED and MANIFEST_URL above it. Plain
 * script, no imports: nothing can be imported yet.
 *
 * On the web, and in the desktop app, it injects the embedded entry at once and
 * does nothing else: no request, nothing stored. In the Android app it may load
 * the pinned release bundle from the proxy instead. The page itself always
 * stays the APK's own, so the origin, and every user's localStorage library,
 * never changes. Design: docs/superpowers/specs/2026-09-09-android-ota-design.md
 */
/* global EMBEDDED, MANIFEST_URL, OTA_KEYS, validManifest, settleMarker, decideBoot, compareVersions */

const MANIFEST_TIMEOUT_MS = 2500;

const readJson = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
};
const writeJson = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage refused: OTA state is an optimisation, never required */ }
};

/* Returns what it added, so a failed remote boot can take it back out. */
const inject = ({ base, entry, css, preload = [] }, onError) => {
  const head = document.head;
  const added = [];
  for (const href of css) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.crossOrigin = '';
    l.href = base + href;
    added.push(head.appendChild(l));
  }
  for (const href of preload) {
    const l = document.createElement('link');
    l.rel = 'modulepreload';
    l.crossOrigin = '';
    l.href = base + href;
    added.push(head.appendChild(l));
  }
  const s = document.createElement('script');
  s.type = 'module';
  s.crossOrigin = '';
  s.src = base + entry;
  if (onError) s.onerror = onError;
  added.push(head.appendChild(s));
  return added;
};

const loadEmbedded = (status) => {
  window.__LH_OTA__ = status;
  inject({ base: '/', ...EMBEDDED });
};

const tauri = window.__TAURI_INTERNALS__;
const android = !!tauri && /Android/i.test(navigator.userAgent || '');

if (!android) {
  /* The web and the desktop app: exactly the page as it always was. */
  loadEmbedded({ source: 'embedded', reason: tauri ? 'not-android' : 'web' });
} else {
  (async () => {
    const settled = settleMarker(readJson(OTA_KEYS.marker), readJson(OTA_KEYS.bad));
    writeJson(OTA_KEYS.marker, null);
    writeJson(OTA_KEYS.bad, settled.bad);

    let manifest = null;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), MANIFEST_TIMEOUT_MS);
      const res = await fetch(MANIFEST_URL, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) manifest = validManifest(await res.json());
      if (manifest) writeJson(OTA_KEYS.manifest, manifest);
    } catch { /* offline or slow: fall back to the last manifest that validated */ }
    if (!manifest) manifest = validManifest(readJson(OTA_KEYS.manifest));

    let shell = null;
    try { shell = await tauri.invoke('plugin:app|version'); } catch { /* old or odd shell */ }

    const decision = decideBoot({ android, shell, manifest, bad: settled.bad, compare: compareVersions });
    const status = { ...decision, shell, version: manifest ? manifest.version : null, failed: settled.failed };

    if (decision.source !== 'remote') {
      loadEmbedded(status);
      return;
    }

    /* The marker is the whole boot check: useBootConfirmed (App.jsx) clears it once React has
       mounted. Still set on the next launch means this version never did. */
    writeJson(OTA_KEYS.marker, { version: manifest.version, at: Date.now() });
    window.__LH_OTA__ = { ...status, base: manifest.base };
    /* A bundle that throws while loading would leave this launch blank until
       the app was restarted. An uncaught error from the bundle's own files
       before mount is the same verdict the marker reaches on the next launch,
       reached now: mark it bad and reload into the embedded bundle. Errors
       only, never a timer, so a slow first download is never mistaken for a
       broken one. useBootConfirmed clears the marker on mount, which stands this down. */
    const onBundleError = (e) => {
      if (!String(e && e.filename || '').startsWith(manifest.base)) return;
      if (!readJson(OTA_KEYS.marker)) return;
      window.removeEventListener('error', onBundleError);
      writeJson(OTA_KEYS.marker, null);
      writeJson(OTA_KEYS.bad, settleMarker({ version: manifest.version }, readJson(OTA_KEYS.bad)).bad);
      location.reload();
    };
    window.addEventListener('error', onBundleError);

    const remote = inject(manifest, () => {
      window.removeEventListener('error', onBundleError);
      for (const node of remote) node.remove();
      /* The entry did not arrive (offline with nothing cached). Not a bad
         bundle, just an absent one: clear the marker and boot what we carry. */
      writeJson(OTA_KEYS.marker, null);
      loadEmbedded({ ...status, source: 'embedded', reason: 'fetch-failed' });
    });
  })();
}
