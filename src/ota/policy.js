/* The Android OTA decision, as pure functions. No imports and no DOM: this
 * file is inlined into index.html by scripts/vite-ota-bootstrap.mjs, next to
 * src/services/version.js (compareVersions), and tested in node by
 * tests/ota.test.mjs. Design: docs/superpowers/specs/2026-09-09-android-ota-design.md
 *
 * Every doubt resolves to the embedded bundle. It is the one that shipped
 * inside the APK and is known to match this shell, so the worst an OTA
 * failure can do is leave the app where it would have been without OTA.
 */

/* localStorage keys. Device-local by design: none of these is a synced
   domain in db.js, because they describe this device's experience of one
   bundle and must never travel to another. */
export const OTA_KEYS = {
  /* Set just before a remote bundle is injected, cleared once React mounts. */
  marker: 'lh_ota_boot',
  /* Versions that failed to mount here. Never attempted again. */
  bad: 'lh_ota_bad',
  /* The last manifest that validated, for launches without a network. */
  manifest: 'lh_ota_manifest',
};

const HASHED = /^assets\/[\w.-]+\.(js|css)$/;

/**
 * A manifest is usable only if every field the bootstrap will act on is
 * present and shaped as expected. PURE.
 * @returns {null | {version: string, minShellVersion: string, base: string, entry: string, css: string[]}}
 */
export const validManifest = (m) => {
  if (!m || typeof m !== 'object') return null;
  const { version, minShellVersion, base, entry, css } = m;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  if (typeof minShellVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(minShellVersion)) return null;
  /* https only, and a directory: `entry` is joined onto it. */
  if (typeof base !== 'string' || !/^https:\/\/[^/]+\/.*\/$/.test(base)) return null;
  if (typeof entry !== 'string' || !HASHED.test(entry) || !entry.endsWith('.js')) return null;
  if (!Array.isArray(css) || !css.every(c => typeof c === 'string' && HASHED.test(c) && c.endsWith('.css'))) return null;
  return { version, minShellVersion, base, entry, css: [...css] };
};

/**
 * What the last launch left behind. PURE.
 * A marker still set means that version was injected and never mounted: it
 * failed to boot, and joins the bad list.
 * @returns {{bad: string[], failed: string | null}}
 */
export const settleMarker = (marker, bad) => {
  const list = Array.isArray(bad) ? bad.filter(v => typeof v === 'string') : [];
  const failed = marker && typeof marker.version === 'string' ? marker.version : null;
  if (failed && !list.includes(failed)) list.push(failed);
  return { bad: list, failed };
};

/**
 * Which bundle to load. PURE.
 * @param {object} a
 * @param {boolean} a.android   inside the Android shell
 * @param {string|null} a.shell the shell's own version, from the native side
 * @param {object|null} a.manifest  already passed through validManifest
 * @param {string[]} a.bad      versions that failed to mount on this device
 * @param {(x: string, y: string) => number} a.compare  compareVersions
 * @returns {{source: 'remote' | 'embedded', reason: string}}
 */
export const decideBoot = ({ android, shell, manifest, bad = [], compare }) => {
  if (!android) return { source: 'embedded', reason: 'not-android' };
  if (!shell) return { source: 'embedded', reason: 'no-shell-version' };
  if (!manifest) return { source: 'embedded', reason: 'no-manifest' };
  /* The reinstall boundary: this bundle needs native code this APK lacks. */
  if (compare(shell, manifest.minShellVersion) < 0) return { source: 'embedded', reason: 'shell-too-old' };
  /* Same or older than what the APK carries: the embedded copy is at least
     as new, and costs no network. */
  if (compare(manifest.version, shell) <= 0) return { source: 'embedded', reason: 'current' };
  if (bad.includes(manifest.version)) return { source: 'embedded', reason: 'marked-bad' };
  return { source: 'remote', reason: 'update' };
};
