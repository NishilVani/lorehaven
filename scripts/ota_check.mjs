#!/usr/bin/env node
/**
 * Checks, against the deployed Worker, the two headers without which the
 * Android app does not boot a remote bundle
 * (docs/superpowers/specs/2026-09-09-android-ota-design.md, "Why CORS and MIME
 * decide the host"):
 *   - Access-Control-Allow-Origin: *   on the manifest, the entry and its CSS;
 *   - a JavaScript Content-Type on the entry, CSS on the stylesheets, JSON on
 *     the manifest.
 * Also that the manifest names the version expected. Run by the release
 * workflow after publishing, and by hand whenever the route changes:
 *
 *   node scripts/ota_check.mjs [--version 0.3.0]
 */
import { readFileSync } from 'node:fs';
import { validManifest } from '../src/ota/policy.js';

const i = process.argv.indexOf('--version');
const expect = i > -1 ? process.argv[i + 1] : null;
const origin = (readFileSync('.env.production', 'utf8').match(/^VITE_PROXY_ORIGIN=(.+)$/m)?.[1] || '').trim().replace(/\/$/, '');

let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
};

const head = async (url, type) => {
  const res = await fetch(url, { headers: { Origin: 'http://tauri.localhost' } });
  check(res.ok, `${url} -> ${res.status}`);
  check(res.headers.get('access-control-allow-origin') === '*', `  CORS allow-origin is * (${res.headers.get('access-control-allow-origin')})`);
  check(type.test(res.headers.get('content-type') || ''), `  content-type ${res.headers.get('content-type')}`);
  return res;
};

const res = await head(`${origin}/ota/android.json`, /^application\/json/);
const manifest = validManifest(await res.json().catch(() => null));
check(!!manifest, 'manifest validates');
if (manifest) {
  if (expect) check(manifest.version === expect, `manifest points at ${expect} (it says ${manifest.version})`);
  await head(manifest.base + manifest.entry, /^text\/javascript/);
  for (const c of manifest.css) await head(manifest.base + c, /^text\/css/);
}

console.log(failures ? `ota check: ${failures} failure(s)` : 'ota check: all passed');
process.exit(failures ? 1 : 0);
