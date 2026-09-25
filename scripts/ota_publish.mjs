#!/usr/bin/env node
/**
 * Adds a built dist/ to the Android OTA site. Run by the `ota` job in
 * .github/workflows/release.yml, inside a checkout of the `gh-pages` branch,
 * which is then published to GitHub Pages:
 *
 *   node scripts/ota_publish.mjs --version 0.4.0 --site <gh-pages checkout>
 *
 * Design: docs/superpowers/specs/2026-09-09-android-ota-design.md
 *
 * The branch is the store: every release's files sit under ota/<version>/ and
 * are never changed or removed, so every past bundle stays servable and
 * rollback is editing one file. ota/android.json is the pointer, the one file
 * that moves. The whole branch deploys as one Pages site, atomically, so the
 * pointer never goes live ahead of what it points at.
 *
 * GitHub Pages sends Access-Control-Allow-Origin: * and a JavaScript type for
 * .js, the two headers a module script from another origin needs.
 * scripts/ota_check.mjs confirms both on the live site after the deploy.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validManifest } from '../src/ota/policy.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const fail = (msg) => { console.error(msg); process.exit(1); };

const version = arg('version');
const site = arg('site');
const dist = arg('dist') || 'dist';
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !site) {
  console.error('usage: ota_publish.mjs --version X.Y.Z --site <dir> [--dist dist]');
  process.exit(2);
}

const tauriVersion = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
if (tauriVersion !== version) fail(`--version ${version} does not match tauri.conf.json ${tauriVersion}`);

const origin = (readFileSync('.env.production', 'utf8').match(/^VITE_OTA_ORIGIN=(.+)$/m)?.[1] || '').trim().replace(/\/$/, '');
if (!/^https:\/\//.test(origin)) fail('VITE_OTA_ORIGIN in .env.production is missing or not https');

const lifted = JSON.parse(readFileSync(join(dist, 'ota-entry.json'), 'utf8'));
const { minShellVersion } = JSON.parse(readFileSync('src-tauri/ota-min-shell.json', 'utf8'));
const manifest = validManifest({
  version,
  minShellVersion,
  base: `${origin}/ota/${version}/`,
  entry: lifted.entry,
  css: lifted.css,
});
if (!manifest) fail(`the generated manifest does not validate: ${JSON.stringify({ version, minShellVersion, lifted })}`);
for (const f of [manifest.entry, ...manifest.css]) {
  if (!existsSync(join(dist, f))) fail(`${dist}/ has no ${f}, which the manifest points at`);
}

/* A published version is never rewritten: a phone may already have it
   cached. Re-running the same release with the same build is allowed. */
const target = join(site, 'ota', version);
if (existsSync(target)) {
  const entryThere = join(target, manifest.entry);
  if (!existsSync(entryThere)) fail(`ota/${version}/ already exists with a different build; bump the version instead`);
  console.log(`ota/${version}/ already holds this build, leaving it as it is`);
} else {
  mkdirSync(target, { recursive: true });
  cpSync(dist, target, { recursive: true });
}

/* Pages runs Jekyll unless told not to, and Jekyll drops files that start
   with an underscore. Vite can emit those. */
writeFileSync(join(site, '.nojekyll'), '');

/* The manifest twice: beside its bundle, where it never changes and is what
   .github/workflows/ota-rollback.yml copies back into place, and at the one
   key the app reads. */
const body = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(join(target, 'manifest.json'), body);
writeFileSync(join(site, 'ota', 'android.json'), body);

const count = (d) => readdirSync(d).reduce((n, f) => n + (statSync(join(d, f)).isDirectory() ? count(join(d, f)) : 1), 0);
console.log(`ota/${version}/: ${count(target)} files; ${relative(site, join(site, 'ota', 'android.json'))} now points at it:`);
console.log(JSON.stringify(manifest, null, 2));
