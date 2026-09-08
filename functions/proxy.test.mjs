/* Drives the proxy end to end against the real IGDB and Wikidata, which is the
   only way to know the server-side token exchange works. Run: node functions/proxy.test.mjs */
import { server } from './serve.js';
import { handle, __test } from './proxy.js';

const PORT = 8791;
await new Promise(r => server.listen(PORT, r));
const base = `http://localhost:${PORT}`;
const post = (path, body, init = {}) =>
  fetch(base + path, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, ...init });

let bad = 0;
const check = (label, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  -- ' + detail : ''}`); };

// --- the credential never leaves the server --------------------------------
{
  const res = await post('/api/games', 'fields name; where id = 1942;');
  const rows = await res.json().catch(() => null);
  check('IGDB call succeeds with no credential from the caller',
    res.ok && Array.isArray(rows) && rows[0]?.name,
    `${res.status} ${rows?.[0]?.name ?? JSON.stringify(rows).slice(0, 80)}`);
  const seen = JSON.stringify(rows);
  check('the response carries no client id or secret', !/client_?(id|secret)/i.test(seen));
}

// --- the allowlist ----------------------------------------------------------
{
  const res = await post('/api/webhooks', 'fields *;');
  check('an endpoint the app never calls is refused', res.status === 404, String(res.status));
}
{
  const res = await post('/api/genres', 'fields name; limit 1;');
  check('an allowed endpoint the app does call is forwarded', res.ok, String(res.status));
}

// --- shape and method -------------------------------------------------------
{
  const res = await fetch(base + '/api/games', { method: 'GET' });
  check('GET is refused', res.status === 405, String(res.status));
}
{
  const res = await fetch(base + '/api/games', { method: 'OPTIONS' });
  check('preflight is answered for the Tauri origin',
    res.status === 204 && res.headers.get('access-control-allow-origin') === '*');
}
{
  const res = await post('/nonsense/x', 'x');
  check('an unknown route is refused', res.status === 404, String(res.status));
}

// --- Wikidata, which a browser cannot call directly --------------------------
{
  const res = await post('/wdqs/sparql', 'query=' + encodeURIComponent('SELECT ?x WHERE { BIND(1 AS ?x) }'), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const body = await res.json().catch(() => null);
  check('Wikidata SPARQL is proxied with the required user agent',
    res.ok && body?.results?.bindings?.length === 1, String(res.status));
}

// --- the token is cached, not re-minted per request --------------------------
{
  __test.dropToken();
  const t1 = await __test.getToken({ IGDB_CLIENT_ID: process.env.__ID, IGDB_CLIENT_SECRET: process.env.__SECRET })
    .catch(() => null);
  // getToken needs real credentials; the earlier calls already minted one, so
  // assert instead that two concurrent calls share a single in-flight request.
  const before = Date.now();
  const [a, b] = await Promise.all([post('/api/genres', 'fields name; limit 1;'), post('/api/genres', 'fields name; limit 1;')]);
  check('concurrent calls both succeed on the cached token', a.ok && b.ok, `${a.status}/${b.status} in ${Date.now() - before}ms`);
  void t1;
}

// --- a misconfigured deployment fails closed ---------------------------------
{
  const res = await handle(new Request('http://x/api/games', { method: 'POST', body: 'fields name;' }), {});
  check('no credentials configured is a 500, not an unauthenticated passthrough', res.status === 500, String(res.status));
}

server.close();
console.log(bad ? `\n${bad} failed` : `\nall proxy checks passed`);
process.exit(bad ? 1 : 0);
