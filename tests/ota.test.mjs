/* Android OTA: the pure decisions, the publish script, and the real inlined
 * bootstrap run in a sandbox for each path it can take.
 * Design: docs/superpowers/specs/2026-09-09-android-ota-design.md
 *
 * What this cannot prove, and the design says so: that a real WebView fetches
 * and runs a cross-origin module bundle from GitHub Pages. scripts/ota_check.mjs checks the
 * two headers that decide it against the live GitHub Pages site; the rest is by
 * hand.
 */
import assert from 'node:assert';
import vm from 'node:vm';
import { validManifest, settleMarker, decideBoot, OTA_KEYS } from '../src/ota/policy.js';
import { compareVersions } from '../src/services/version.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftEntry, renderBootstrap } from '../scripts/vite-ota-bootstrap.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok    ${name}`); }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

const GOOD = {
  version: '0.4.0',
  minShellVersion: '0.3.0',
  base: 'https://proxy.example.dev/ota/0.4.0/',
  entry: 'assets/index-ABC.js',
  css: ['assets/index-XYZ.css'],
};

/* ── Manifest ────────────────────────────────────────────────────────────── */

await test('a complete manifest validates and is copied, not aliased', () => {
  const m = validManifest(GOOD);
  assert.deepStrictEqual(m, GOOD);
  assert.notStrictEqual(m.css, GOOD.css);
});

await test('a malformed manifest or any missing field is rejected', () => {
  for (const bad of [
    null, 'x', [], {},
    { ...GOOD, version: undefined }, { ...GOOD, version: '0.4' }, { ...GOOD, version: 'latest' },
    { ...GOOD, minShellVersion: undefined },
    { ...GOOD, base: 'http://proxy.example.dev/ota/0.4.0/' },   // not https
    { ...GOOD, base: 'https://proxy.example.dev/ota/0.4.0' },   // not a directory
    { ...GOOD, entry: undefined }, { ...GOOD, entry: '../evil.js' }, { ...GOOD, entry: 'assets/index.css' },
    { ...GOOD, css: 'assets/x.css' }, { ...GOOD, css: ['assets/x.js'] },
  ]) assert.strictEqual(validManifest(bad), null, JSON.stringify(bad));
});

/* ── Decision ────────────────────────────────────────────────────────────── */

const decide = (over) => decideBoot({ android: true, shell: '0.3.0', manifest: GOOD, bad: [], compare: compareVersions, ...over });

await test('a newer bundle on a new enough shell loads remotely', () => {
  assert.deepStrictEqual(decide({}), { source: 'remote', reason: 'update' });
});

await test('every doubt resolves to the embedded bundle', () => {
  const cases = [
    [{ android: false }, 'not-android'],
    [{ shell: null }, 'no-shell-version'],
    [{ manifest: null }, 'no-manifest'],
    [{ shell: '0.2.9' }, 'shell-too-old'],
    [{ shell: '0.4.0' }, 'current'],
    [{ shell: '0.5.0' }, 'current'],               // the APK is newer than the manifest
    [{ bad: ['0.4.0'] }, 'marked-bad'],
  ];
  for (const [over, reason] of cases) {
    assert.deepStrictEqual(decide(over), { source: 'embedded', reason }, reason);
  }
});

await test('versions compare numerically, not as strings', () => {
  assert.strictEqual(decide({ shell: '0.10.0', manifest: { ...GOOD, version: '0.9.0', minShellVersion: '0.1.0' } }).reason, 'current');
});

/* ── Boot marker state machine ───────────────────────────────────────────── */

await test('clean start: no marker, nothing marked bad', () => {
  assert.deepStrictEqual(settleMarker(null, null), { bad: [], failed: null });
});

await test('mounted: the app cleared the marker, so the list is untouched', () => {
  assert.deepStrictEqual(settleMarker(null, ['0.3.1']), { bad: ['0.3.1'], failed: null });
});

await test('failed once: a marker left set marks that version bad', () => {
  assert.deepStrictEqual(settleMarker({ version: '0.4.0', at: 1 }, []), { bad: ['0.4.0'], failed: '0.4.0' });
});

await test('marked bad stays bad, once, and is never attempted again', () => {
  const { bad } = settleMarker({ version: '0.4.0' }, ['0.4.0', 7, null]);
  assert.deepStrictEqual(bad, ['0.4.0']);
  assert.strictEqual(decide({ bad }).reason, 'marked-bad');
});

/* ── Publish script ──────────────────────────────────────────────────────── */

const VERSION = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const ORIGIN = readFileSync('.env.production', 'utf8').match(/^VITE_OTA_ORIGIN=(.+)$/m)[1].trim();
const fakeDist = (entry = 'assets/index-AAA.js') => {
  const d = mkdtempSync(join(tmpdir(), 'ota-dist-'));
  mkdirSync(join(d, 'assets'));
  writeFileSync(join(d, entry), 'export {}');
  writeFileSync(join(d, 'assets/index-AAA.css'), '');
  writeFileSync(join(d, 'assets/_underscored.js'), '');
  writeFileSync(join(d, 'ota-entry.json'), JSON.stringify({ entry, css: ['assets/index-AAA.css'], preload: [] }));
  return d;
};
const publish = (args) => execFileSync('node', ['scripts/ota_publish.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

await test('publish lays out ota/<version>/ and a manifest that validates against the Pages origin', () => {
  const site = mkdtempSync(join(tmpdir(), 'ota-site-'));
  publish(['--version', VERSION, '--site', site, '--dist', fakeDist()]);
  assert.ok(existsSync(join(site, `ota/${VERSION}/assets/index-AAA.js`)));
  assert.ok(existsSync(join(site, `ota/${VERSION}/assets/_underscored.js`)));
  assert.ok(existsSync(join(site, '.nojekyll')), 'Jekyll would drop files starting with _');
  const m = validManifest(JSON.parse(readFileSync(join(site, 'ota/android.json'), 'utf8')));
  assert.ok(m);
  assert.strictEqual(m.version, VERSION);
  assert.strictEqual(m.base, `${ORIGIN}/ota/${VERSION}/`);
  assert.strictEqual(m.entry, 'assets/index-AAA.js');
  assert.strictEqual(m.minShellVersion, JSON.parse(readFileSync('src-tauri/ota-min-shell.json', 'utf8')).minShellVersion);
  assert.deepStrictEqual(JSON.parse(readFileSync(join(site, `ota/${VERSION}/manifest.json`), 'utf8')), m, 'kept beside the bundle, for rollback');
});

await test('publish re-run with the same build is fine; a different build under the same version is refused', () => {
  const site = mkdtempSync(join(tmpdir(), 'ota-site-'));
  publish(['--version', VERSION, '--site', site, '--dist', fakeDist()]);
  assert.match(publish(['--version', VERSION, '--site', site, '--dist', fakeDist()]), /already holds this build/);
  assert.throws(() => publish(['--version', VERSION, '--site', site, '--dist', fakeDist('assets/index-BBB.js')]), /different build/);
});

await test('rollback copies an earlier release\'s own manifest into place, and refuses one never published', () => {
  const site = mkdtempSync(join(tmpdir(), 'ota-site-'));
  publish(['--version', VERSION, '--site', site, '--dist', fakeDist()]);
  writeFileSync(join(site, 'ota/android.json'), JSON.stringify({ ...GOOD, version: '9.9.9' }));
  execFileSync('node', ['scripts/ota_rollback.mjs', '--version', VERSION, '--site', site], { stdio: 'pipe' });
  assert.strictEqual(JSON.parse(readFileSync(join(site, 'ota/android.json'), 'utf8')).version, VERSION);
  assert.throws(() => execFileSync('node', ['scripts/ota_rollback.mjs', '--version', '0.0.1', '--site', site], { stdio: 'pipe' }), /no published bundle/);
});

await test('publish refuses a version that is not the one in tauri.conf.json', () => {
  const site = mkdtempSync(join(tmpdir(), 'ota-site-'));
  assert.throws(() => publish(['--version', '99.0.0', '--site', site, '--dist', fakeDist()]), /does not match tauri.conf.json/);
  assert.strictEqual(existsSync(join(site, 'ota')), false, 'nothing written');
});

/* ── Build plugin and the real bootstrap ─────────────────────────────────── */

const BUILT = `<!doctype html><html><head>
    <script>/* theme */</script>
    <script type="module" crossorigin src="/assets/index-LOCAL.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/chunk-A.js">
    <link rel="modulepreload" crossorigin href="/assets/chunk-B.js">
    <link rel="stylesheet" crossorigin href="/assets/index-LOCAL.css">
  </head><body><div id="root"></div></body></html>`;

await test('liftEntry takes the entry, preloads and CSS out of the page, and nothing else', () => {
  const { html, entry, css, preload } = liftEntry(BUILT);
  assert.strictEqual(entry, 'assets/index-LOCAL.js');
  assert.deepStrictEqual(css, ['assets/index-LOCAL.css']);
  assert.deepStrictEqual(preload, ['assets/chunk-A.js', 'assets/chunk-B.js']);
  assert.doesNotMatch(html, /type="module"|modulepreload|index-LOCAL/);
  assert.match(html, /\/\* theme \*\//);
  assert.throws(() => liftEntry('<html><head></head></html>'), /no module entry/);
});

/* A document just big enough for the bootstrap: a head that records what is
   appended, elements whose error can be fired, and localStorage. */
function sandbox({ tauri = null, ua = 'Mozilla/5.0', fetchImpl, storage = {} } = {}) {
  const added = [];
  const store = new Map(Object.entries(storage));
  const make = (tag) => ({ tagName: tag.toUpperCase(), remove() { added.splice(added.indexOf(this), 1); } });
  const listeners = {};
  const location = { reloads: 0, reload() { this.reloads += 1; } };
  const window = {
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    fire: (t, e) => (listeners[t] || []).slice().forEach(f => f(e)),
  };
  const ctx = {
    location,
    window,
    navigator: { userAgent: ua },
    document: { createElement: make, head: { appendChild(n) { added.push(n); return n; } } },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    fetch: fetchImpl || (async () => { throw new Error('no network in this test'); }),
    AbortController, setTimeout, clearTimeout, JSON, Date, Array, Object, String, Number, RegExp,
  };
  window.__TAURI_INTERNALS__ = tauri;
  const embedded = liftEntry(BUILT);
  const script = renderBootstrap({
    embedded: { entry: embedded.entry, css: embedded.css, preload: embedded.preload },
    manifestUrl: 'https://proxy.example.dev/ota/android.json',
  });
  vm.runInNewContext(script, ctx);
  const settle = () => new Promise(r => setTimeout(r, 20));
  return { added, store, window, location, settle };
}
const srcs = (added) => added.map(n => n.src || n.href);

await test('web: the embedded entry, CSS and preloads, at once, with no request', async () => {
  let fetched = 0;
  const s = sandbox({ fetchImpl: async () => { fetched += 1; } });
  assert.deepStrictEqual(srcs(s.added), ['/assets/index-LOCAL.css', '/assets/chunk-A.js', '/assets/chunk-B.js', '/assets/index-LOCAL.js']);
  const script = s.added.find(n => n.tagName === 'SCRIPT');
  assert.strictEqual(script.type, 'module');
  assert.strictEqual(script.crossOrigin, '');
  await s.settle();
  assert.strictEqual(fetched, 0, 'the web makes no OTA request');
  assert.strictEqual(s.store.size, 0, 'and stores nothing');
  assert.strictEqual(s.window.__LH_OTA__.reason, 'web');
});

await test('desktop app: embedded, synchronously, no request', async () => {
  let fetched = 0;
  const s = sandbox({ tauri: { invoke: async () => '0.3.0' }, ua: 'Windows', fetchImpl: async () => { fetched += 1; } });
  assert.strictEqual(s.added.length, 4);
  await s.settle();
  assert.strictEqual(fetched, 0);
  assert.strictEqual(s.window.__LH_OTA__.reason, 'not-android');
});

const android = (over = {}) => sandbox({
  ua: 'Mozilla/5.0 (Linux; Android 14) wv',
  tauri: { invoke: async (cmd) => (cmd === 'plugin:app|version' ? '0.3.0' : null) },
  fetchImpl: async () => ({ ok: true, json: async () => GOOD }),
  ...over,
});

await test('android, newer release: the remote entry and CSS load, and the marker is set', async () => {
  const s = android();
  await s.settle();
  assert.deepStrictEqual(srcs(s.added), [GOOD.base + GOOD.css[0], GOOD.base + GOOD.entry]);
  assert.strictEqual(JSON.parse(s.store.get(OTA_KEYS.marker)).version, '0.4.0');
  assert.deepStrictEqual(JSON.parse(s.store.get(OTA_KEYS.manifest)), GOOD);
  assert.strictEqual(s.window.__LH_OTA__.source, 'remote');
});

await test('android, the entry fails to arrive: remote tags come out, embedded goes in, not marked bad', async () => {
  const s = android();
  await s.settle();
  s.added.find(n => n.tagName === 'SCRIPT').onerror();
  assert.deepStrictEqual(srcs(s.added), ['/assets/index-LOCAL.css', '/assets/chunk-A.js', '/assets/chunk-B.js', '/assets/index-LOCAL.js']);
  assert.strictEqual(s.store.has(OTA_KEYS.marker), false);
  assert.strictEqual(s.window.__LH_OTA__.reason, 'fetch-failed');
});

await test('android, the bundle throws while loading: marked bad and reloaded now, not next launch', async () => {
  const s = android();
  await s.settle();
  s.window.fire('error', { filename: 'https://cdn.other.test/widget.js' });
  assert.strictEqual(s.location.reloads, 0, 'an error from anywhere else is not the bundle');
  s.window.fire('error', { filename: GOOD.base + 'assets/chunk-Q.js' });
  assert.strictEqual(s.location.reloads, 1);
  assert.deepStrictEqual(JSON.parse(s.store.get(OTA_KEYS.bad)), ['0.4.0']);
  assert.strictEqual(s.store.has(OTA_KEYS.marker), false);
});

await test('android, the bundle mounted: a later error does not mark it bad', async () => {
  const s = android();
  await s.settle();
  s.store.delete(OTA_KEYS.marker);   // what useBootConfirmed does on mount
  s.window.fire('error', { filename: GOOD.base + GOOD.entry });
  assert.strictEqual(s.location.reloads, 0);
  assert.strictEqual(s.store.has(OTA_KEYS.bad) && JSON.parse(s.store.get(OTA_KEYS.bad)).length, 0);
});

await test('android, last launch never mounted: that version is marked bad and the embedded one loads', async () => {
  const s = android({ storage: { [OTA_KEYS.marker]: JSON.stringify({ version: '0.4.0' }) } });
  await s.settle();
  assert.deepStrictEqual(JSON.parse(s.store.get(OTA_KEYS.bad)), ['0.4.0']);
  assert.strictEqual(s.store.has(OTA_KEYS.marker), false);
  assert.strictEqual(s.window.__LH_OTA__.reason, 'marked-bad');
  assert.strictEqual(s.window.__LH_OTA__.failed, '0.4.0');
  assert.ok(srcs(s.added).includes('/assets/index-LOCAL.js'));
});

await test('android, offline: the last good manifest is used, so a cached bundle still boots', async () => {
  const s = android({
    fetchImpl: async () => { throw new TypeError('offline'); },
    storage: { [OTA_KEYS.manifest]: JSON.stringify(GOOD) },
  });
  await s.settle();
  assert.strictEqual(s.window.__LH_OTA__.source, 'remote');
});

await test('android, offline with no manifest ever seen: embedded', async () => {
  const s = android({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await s.settle();
  assert.strictEqual(s.window.__LH_OTA__.reason, 'no-manifest');
  assert.ok(srcs(s.added).includes('/assets/index-LOCAL.js'));
});

await test('android, a malformed manifest from the network: embedded, and it is not remembered', async () => {
  const s = android({ fetchImpl: async () => ({ ok: true, json: async () => ({ ...GOOD, entry: '../x.js' }) }) });
  await s.settle();
  assert.strictEqual(s.window.__LH_OTA__.reason, 'no-manifest');
  assert.strictEqual(s.store.has(OTA_KEYS.manifest), false);
});

await test('android, shell too old: embedded, and the status says why', async () => {
  const s = android({ tauri: { invoke: async () => '0.2.0' } });
  await s.settle();
  assert.strictEqual(s.window.__LH_OTA__.reason, 'shell-too-old');
  assert.strictEqual(s.window.__LH_OTA__.version, '0.4.0');
});

console.log(process.exitCode ? 'ota: FAILED' : `ota: ${passed} passed`);
