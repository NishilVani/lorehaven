/* Build-time half of the Android OTA bootstrap.
 *
 * Vite writes the entry into index.html as
 *   <script type="module" crossorigin src="/assets/index-HASH.js">
 * which would load before anything could decide whether it should. This plugin
 * lifts that tag, its stylesheet and its modulepreload hints out of the page and
 * replaces them with one inline script: src/services/version.js, then
 * src/ota/policy.js, then src/ota/bootstrap.js, with their import/export lines
 * removed. The bootstrap puts the same tags back at runtime (web and desktop:
 * at once, unchanged) or loads the pinned OTA bundle instead (Android).
 *
 * It also writes dist/ota-entry.json, which the release workflow turns into the
 * manifest, so the entry and CSS hashes are read from the build and never typed.
 * Build only: the dev server keeps Vite's own entry.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const SOURCES = ['src/services/version.js', 'src/ota/policy.js', 'src/ota/bootstrap.js'];

const ENTRY = /<script type="module" crossorigin src="\/(assets\/[^"]+\.js)"><\/script>\s*/;
const PRELOAD = /<link rel="modulepreload" crossorigin href="\/(assets\/[^"]+\.js)">\s*/g;
const STYLE = /<link rel="stylesheet" crossorigin href="\/(assets\/[^"]+\.css)">\s*/g;

/** Take the entry, preloads and stylesheets out of built HTML. PURE. */
export function liftEntry(html) {
  const entry = html.match(ENTRY)?.[1];
  if (!entry) throw new Error('vite-ota-bootstrap: no module entry found in index.html');
  const preload = [...html.matchAll(PRELOAD)].map(m => m[1]);
  const css = [...html.matchAll(STYLE)].map(m => m[1]);
  const rest = html.replace(ENTRY, '').replace(PRELOAD, '').replace(STYLE, '');
  return { html: rest, entry, css, preload };
}

/* Module syntax out, so the three files run as one classic script. Only the
   forms these files use: `export const`, `export {…} from`, and imports. */
const stripModule = (src) => src
  .split('\n')
  .filter(line => !/^\s*import\s/.test(line) && !/^\s*export\s*\{/.test(line))
  .map(line => line.replace(/^export\s+(const|function)\s/, '$1 '))
  .join('\n');

/** The inline script. PURE apart from reading the three source files. */
export function renderBootstrap({ embedded, manifestUrl }) {
  const body = SOURCES.map(f => stripModule(readFileSync(new URL(f, ROOT), 'utf8'))).join('\n');
  return `(function () {
'use strict';
var EMBEDDED = ${JSON.stringify(embedded)};
var MANIFEST_URL = ${JSON.stringify(manifestUrl)};
${body}
})();`;
}

export default function otaBootstrap({ proxyOrigin }) {
  let outDir = 'dist';
  let lifted = null;
  return {
    name: 'ota-bootstrap',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const { html: rest, entry, css, preload } = liftEntry(html);
        lifted = { entry, css, preload };
        const script = renderBootstrap({
          embedded: lifted,
          manifestUrl: `${(proxyOrigin || '').replace(/\/$/, '')}/ota/android.json`,
        });
        return rest.replace('</head>', `  <script>${script}</script>\n  </head>`);
      },
    },
    closeBundle() {
      if (lifted) writeFileSync(resolve(outDir, 'ota-entry.json'), JSON.stringify(lifted, null, 2) + '\n');
    },
  };
}
