#!/usr/bin/env node
/**
 * Publishes a built dist/ as an Android OTA bundle. Run by the `ota` job in
 * .github/workflows/release.yml after `npm run build`.
 *
 *   node scripts/ota_publish.mjs --version 0.3.0 [--dry-run]
 *
 * Order is the point (docs/superpowers/specs/2026-09-09-android-ota-design.md):
 *   1. every file of dist/ goes to ota/<version>/<path>, each with an explicit
 *      Content-Type, because a module script served without a JavaScript type
 *      is refused and the app does not boot;
 *   2. the manifest is built from dist/ota-entry.json (written by the build,
 *      never typed) and src-tauri/ota-min-shell.json, and validated with the
 *      same function the app uses;
 *   3. ota/android.json is written LAST, so it never names a bundle that is not
 *      fully present.
 *
 * Needs CLOUDFLARE_API_TOKEN (R2 write) and CLOUDFLARE_ACCOUNT_ID in the
 * environment, as wrangler reads them.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { contentTypeFor, MANIFEST_KEY } from '../functions/ota.js';
import { validManifest } from '../src/ota/policy.js';

const BUCKET = 'lorehaven-ota';
const DIST = 'dist';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const version = arg('version');
const dryRun = process.argv.includes('--dry-run');
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: ota_publish.mjs --version X.Y.Z [--dry-run]');
  process.exit(2);
}

const tauriVersion = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
if (tauriVersion !== version) {
  console.error(`--version ${version} does not match tauri.conf.json ${tauriVersion}`);
  process.exit(1);
}

const proxy = (readFileSync('.env.production', 'utf8').match(/^VITE_PROXY_ORIGIN=(.+)$/m)?.[1] || '').trim().replace(/\/$/, '');
if (!/^https:\/\//.test(proxy)) {
  console.error('VITE_PROXY_ORIGIN in .env.production is missing or not https');
  process.exit(1);
}

const lifted = JSON.parse(readFileSync(join(DIST, 'ota-entry.json'), 'utf8'));
const { minShellVersion } = JSON.parse(readFileSync('src-tauri/ota-min-shell.json', 'utf8'));
const manifest = validManifest({
  version,
  minShellVersion,
  base: `${proxy}/ota/${version}/`,
  entry: lifted.entry,
  css: lifted.css,
});
if (!manifest) {
  console.error('the generated manifest does not validate:', { version, minShellVersion, lifted });
  process.exit(1);
}

const walk = (dir) => readdirSync(dir).flatMap(name => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(DIST).map(p => relative(DIST, p).split('\\').join('/'));
for (const needed of [manifest.entry, ...manifest.css]) {
  if (!files.includes(needed)) {
    console.error(`dist/ has no ${needed}, which the manifest points at`);
    process.exit(1);
  }
}

const put = (key, file, type) => {
  if (dryRun) {
    console.log(`put ${key}  (${type})`);
    return;
  }
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`,
    '--file', file, '--content-type', type, '--remote'], { stdio: ['ignore', 'ignore', 'inherit'] });
};

/* 1. The bundle. The entry's type is checked before anything uploads: this is
      the single header most able to break every phone at once. */
if (!/^text\/javascript/.test(contentTypeFor(manifest.entry))) {
  console.error(`the entry would upload as ${contentTypeFor(manifest.entry)}, not JavaScript`);
  process.exit(1);
}
for (const f of files) put(`ota/${version}/${f}`, join(DIST, f), contentTypeFor(f));
console.log(`${dryRun ? 'would upload' : 'uploaded'} ${files.length} files to ota/${version}/`);

/* 2 and 3. The switch, last. */
const tmp = join(mkdtempSync(join(tmpdir(), 'ota-')), 'android.json');
writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
put(MANIFEST_KEY, tmp, contentTypeFor(MANIFEST_KEY));
console.log(`${dryRun ? 'would point' : 'pointed'} ${MANIFEST_KEY} at ${version}:`);
console.log(JSON.stringify(manifest, null, 2));
