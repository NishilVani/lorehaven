#!/usr/bin/env node
/**
 * Checks, against the live OTA site on GitHub Pages, the two headers without
 * which the Android app does not boot a remote bundle
 * (docs/superpowers/specs/2026-09-09-android-ota-design.md, "Why CORS and MIME
 * decide the host"):
 *   - Access-Control-Allow-Origin: *   on the manifest, the entry and its CSS;
 *   - a JavaScript type on the entry, CSS on the stylesheets, JSON on the
 *     manifest.
 * With --version it also waits for the manifest to name that version, since a
 * Pages deploy takes a minute or two to reach the CDN. Run by the release
 * workflow after deploying, and by hand after a rollback:
 *
 *   node scripts/ota_check.mjs [--version 0.4.0]
 */
import { readFileSync } from 'node:fs';
import { validManifest } from '../src/ota/policy.js';

const i = process.argv.indexOf('--version');
const expect = i > -1 ? process.argv[i + 1] : null;
const origin = (readFileSync('.env.production', 'utf8').match(/^VITE_OTA_ORIGIN=(.+)$/m)?.[1] || '').trim().replace(/\/$/, '');
const MANIFEST = `${origin}/ota/android.json`;

/* Pages caches for about ten minutes; wait out one cycle and a bit. */
const DEADLINE = Date.now() + 12 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let manifest = null;
for (;;) {
  try {
    const res = await fetch(`${MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
    manifest = res.ok ? validManifest(await res.json()) : null;
  } catch { manifest = null; }
  if (manifest && (!expect || manifest.version === expect)) break;
  if (Date.now() > DEADLINE) break;
  console.log(`  waiting: manifest ${manifest ? `says ${manifest.version}` : 'not there yet'}`);
  await sleep(20000);
}

let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
};

const headers = async (url, type) => {
  const res = await fetch(url, { headers: { Origin: 'http://tauri.localhost' } });
  check(res.ok, `${url} -> ${res.status}`);
  check(res.headers.get('access-control-allow-origin') === '*', `  CORS allow-origin * (got ${res.headers.get('access-control-allow-origin')})`);
  check(type.test(res.headers.get('content-type') || ''), `  content-type ${res.headers.get('content-type')}`);
};

check(!!manifest, `${MANIFEST} validates`);
if (manifest) {
  if (expect) check(manifest.version === expect, `manifest points at ${expect} (it says ${manifest.version})`);
  await headers(MANIFEST, /^application\/json/);
  await headers(manifest.base + manifest.entry, /^(text|application)\/javascript/);
  for (const c of manifest.css) await headers(manifest.base + c, /^text\/css/);
}

console.log(failures ? `ota check: ${failures} failure(s)` : 'ota check: all passed');
process.exit(failures ? 1 : 0);
