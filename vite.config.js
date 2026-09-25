import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const host = process.env.TAURI_DEV_HOST;

/* One source of truth for the version, and it is the one CI already checks:
   .github/workflows/release.yml fails the build when the git tag disagrees
   with tauri.conf.json. package.json says 0.0.0 and means nothing. */
const appVersion = JSON.parse(
  readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8')
).version;

// https://vite.dev/config/
/* The IGDB and Wikidata proxy, mounted as dev-server middleware.
 *
 * Middleware rather than a second HTTP server on its own port: a port needs a
 * listener to survive every config reload and every restart, and a stale socket
 * makes "already in use" indistinguishable from "already serving". That cost a
 * whole test run, twice. There is no port here, so there is nothing to collide.
 *
 * It runs functions/proxy.js, the same file the deployed Worker runs. */
const igdbProxy = () => ({
  name: 'igdb-proxy',
  apply: 'serve',
  async configureServer(vite) {
    const [{ handle }, { env }] = await Promise.all([
      import('./functions/proxy.js'),
      import('./functions/serve.js'),
    ]);
    const configured = env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET;
    console.log(`  ➜  IGDB proxy:  in-process (credentials: ${configured ? 'loaded' : 'MISSING'})`);

    vite.middlewares.use(async (req, res, next) => {
      /* The Worker's own paths only. /auth/steam is a page in this app, and
         /auth/steam/signin and its siblings are the Worker's, so the deeper
         path is what this may answer. */
      if (!/^\/(api|wdqs|steam)\//.test(req.url || '') && !/^\/auth\/steam\/\w/.test(req.url || '')) return next();
      req.on('error', () => {});
      res.on('error', () => {});
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const out = await handle(new Request(`http://localhost${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }), env);
        if (res.writableEnded || res.destroyed) return;
        out.headers.forEach((v, k) => res.setHeader(k, v));
        res.statusCode = out.status;
        res.end(Buffer.from(await out.arrayBuffer()));
      } catch (e) {
        /* Never rethrow: an unhandled rejection here takes the dev server down. */
        if (res.writableEnded || res.destroyed) return;
        res.statusCode = 502;
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      }
    });
  },
});

/* Theme text boost. Tailwind compiles `text-white/50` to ink at a fixed 50%
 * alpha, which is AA over pure black (5.32:1) and can never be AA over a light
 * ground (at most 3.95:1 over white). Each theme in src/constants/themes.js
 * states a `textBoost` k; this rewrites every compiled text-colour alpha of
 * `white` from N% to N% + (100 - N)% * k, read from --lh-text-boost at runtime.
 *
 * Done on the compiled CSS, not with override classes, so every variant
 * (hover:, group-hover:, disabled:) keeps exactly the specificity and order
 * Tailwind gave it. `color:` only: borders and washes keep their alpha.
 * `text-current/N` is boosted the same way, for type that dims its parent's
 * colour so it can follow a hover inversion.
 * Editorial's k is 0, so there the result is the number it always was. */
const TEXT_ALPHA = /(^|[{;\s])color:\s*color-mix\(in oklab,\s*(var\(--color-white\)|currentcolor)\s+(\d+(?:\.\d+)?)%,\s*transparent\)/gi;
export const boostTextAlpha = (css) => css.replace(TEXT_ALPHA, (_, pre, base, n) =>
  `${pre}color:color-mix(in oklab, ${base} calc(${n}% + ${100 - Number(n)}% * var(--lh-text-boost, 0)), transparent)`);

const themeTextBoost = () => ({
  name: 'theme-text-boost',
  enforce: 'post',
  transform(code, id) {
    if (!/\.css($|\?)/.test(id) || !code.includes('--color-white')) return null;
    return { code: boostTextAlpha(code), map: null };
  },
  generateBundle(_, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === 'asset' && file.fileName.endsWith('.css')) {
        file.source = boostTextAlpha(String(file.source));
      }
    }
  },
});

export default defineConfig({
  plugins: [tailwindcss(), react(), igdbProxy(), themeTextBoost()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: host || true,
    port: 5173,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : {
          protocol: 'ws',
          host: 'localhost',
        },
    // 2. Keep your existing proxy settings exactly the same
    proxy: {
      /* /api and /wdqs are answered by the igdbProxy middleware above, not
         proxied: development runs the same code the deployed Worker runs,
         instead of sending the credential from the browser as it used to. */
      '/igdb-img': {
        target: 'https://images.igdb.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/igdb-img/, '')
      },

    }
  }
})
