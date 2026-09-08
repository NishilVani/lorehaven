import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST;

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
      if (!/^\/(api|wdqs)\//.test(req.url || '')) return next();
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

export default defineConfig({
  plugins: [tailwindcss(), react(), igdbProxy()],
  clearScreen: false,
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
