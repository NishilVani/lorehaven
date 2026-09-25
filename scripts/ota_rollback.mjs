#!/usr/bin/env node
/**
 * Points ota/android.json back at an earlier published bundle, by copying that
 * release's own manifest (ota/<version>/manifest.json, written by
 * ota_publish.mjs) into place. Nothing else changes. Run by
 * .github/workflows/ota-rollback.yml inside a checkout of gh-pages:
 *
 *   node scripts/ota_rollback.mjs --version 0.3.0 --site <gh-pages checkout>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validManifest } from '../src/ota/policy.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const version = arg('version');
const site = arg('site');
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !site) {
  console.error('usage: ota_rollback.mjs --version X.Y.Z --site <dir>');
  process.exit(2);
}
const src = join(site, 'ota', version, 'manifest.json');
if (!existsSync(src)) {
  console.error(`no published bundle ${version} (looked for ${src})`);
  process.exit(1);
}
const m = validManifest(JSON.parse(readFileSync(src, 'utf8')));
if (!m || m.version !== version) {
  console.error(`${src} does not validate as the manifest for ${version}`);
  process.exit(1);
}
writeFileSync(join(site, 'ota', 'android.json'), JSON.stringify(m, null, 2) + '\n');
console.log(`ota/android.json now points at ${version}:`);
console.log(JSON.stringify(m, null, 2));
