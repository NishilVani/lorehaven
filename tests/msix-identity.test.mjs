/* The Store identity is assigned by Partner Center and fixed for the life of
   the app. Its prefix keeps the publisher's original spelling, "LoreHeaven",
   even though the publisher is now displayed as "LoreHaven". v0.4.0 changed
   it to match and the Store rejected the submission. This keeps it pinned.
   See docs/MICROSOFT-STORE.md, "Identity". */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const xml = readFileSync('src-tauri/msix/AppxManifest.xml', 'utf8');
const attr = (el, name) => xml.match(new RegExp(`<${el}\\b[^>]*\\b${name}="([^"]*)"`))?.[1];

assert.strictEqual(attr('Identity', 'Name'), 'LoreHeaven.LoreHaven', 'Identity Name must match Partner Center exactly');
assert.strictEqual(attr('Identity', 'Publisher'), 'CN=CEEF9C0A-EDC7-4AE4-9AC3-FA2F4AC45FD8');
console.log('msix identity: all assertions passed');
