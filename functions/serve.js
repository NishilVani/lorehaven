/* Runs proxy.js as a plain Node server, for two jobs:
 *   - the test in proxy.test.mjs drives this, so the proxy is exercised the same
 *     way locally, in CI and in production;
 *   - working on the proxy itself without deploying to see a change. Ordinary
 *     development does not come through here: .env.development points the app at
 *     the deployed Worker, so no machine here holds the credential. Empty
 *     VITE_PROXY_ORIGIN to route /api and /wdqs back to this instead.
 *
 * Credentials come from the environment, and from nowhere else. This used to
 * fall back to reading the untracked datbase_config.json, which meant a
 * plaintext secret sat on every developer's disk for a path nothing takes any
 * more; a missing credential is better than a stale one, because it says so.
 */
import { createServer } from 'node:http';
import { handle } from './proxy.js';

export const env = {
  IGDB_CLIENT_ID: process.env.IGDB_CLIENT_ID,
  IGDB_CLIENT_SECRET: process.env.IGDB_CLIENT_SECRET,
};

const PORT = Number(process.env.PORT || 8787);

export const server = createServer(async (req, res) => {
  /* Every failure has to be caught here. A browser that navigates away mid-request
     makes the body stream reject, and an unhandled rejection in an async request
     handler takes the whole process down with it -- which, since this runs inside
     the Vite dev server, takes development down with it. It did: a test run that
     closed pages faster than requests completed killed the dev server partway
     through and every route after it failed to fetch. */
  req.on('error', () => {});
  res.on('error', () => {});
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const out = await handle(new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method, headers: req.headers, body,
    }), env);
    if (res.writableEnded || res.destroyed) return;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.statusCode = out.status;
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    } catch { /* the socket went away first */ }
  }
});

/* A malformed or aborted request at the socket level, which never reaches the
   handler above. Node's default for this is also to throw. */
server.on('clientError', (_e, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

if (process.argv[1] && process.argv[1].endsWith('serve.js')) {
  server.listen(PORT, () => {
    const configured = env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET;
    console.log(`igdb proxy on http://localhost:${PORT}  (credentials: ${configured ? 'loaded' : 'MISSING'})`);
  });
}
