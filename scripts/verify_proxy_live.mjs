/* Post-deploy check on the live worker. Distinct query bodies so the response
   edge cache cannot answer -- each MISS forces a real IGDB call, which forces a
   token. If the token cache works, every one of these still succeeds and the
   Twitch subrequest count barely moves. */
const URL_ = 'https://lorehaven-proxy.nishilvani.workers.dev';
const post = async (path, body) => {
  const t0 = Date.now();
  const r = await fetch(URL_ + path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
  const txt = await r.text();
  return { status: r.status, ms: Date.now() - t0, cache: r.headers.get('x-lh-cache'), len: txt.length, txt };
};
let bad = 0;
const check = (label, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  -- ' + detail : ''}`); };

// 12 distinct queries: every one a cache MISS, so every one needs the token.
const results = [];
for (let i = 1; i <= 12; i++) results.push(await post('/api/games', `fields name; where id = ${1900 + i}; limit 1;`));
check('every uncached query succeeded', results.every(r => r.status === 200), results.map(r => r.status).join(','));
check('every one was a genuine cache MISS', results.every(r => r.cache === 'MISS'), results.map(r => r.cache).join(','));
check('and returned real IGDB rows', results.every(r => { try { return Array.isArray(JSON.parse(r.txt)); } catch { return false; } }));
console.log('   timings ms:', results.map(r => r.ms).join(' '));

// the token is never echoed to a caller
check('no bearer token or credential in any response body',
  !results.some(r => /access_token|bearer |client_secret/i.test(r.txt)));

// the response edge cache still works -- ctx is still being passed through
const q = `fields name; where id = 1942; limit 1;`;
await post('/api/games', q);                       // prime
await new Promise(r => setTimeout(r, 4000));       // waitUntil lands after the response
const hits = [];
for (let i = 0; i < 6; i++) hits.push((await post('/api/games', q)).cache);
check('the response edge cache still HITs (ctx survived the deploy)', hits.includes('HIT'), hits.join(','));

// the rest of the surface is untouched
check('the allowlist still refuses an unknown endpoint', (await post('/api/webhooks', 'fields *;')).status === 404);
check('Wikidata is still proxied',
  (await (async () => { const r = await fetch(URL_ + '/wdqs/sparql', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent('SELECT ?x WHERE { BIND(1 AS ?x) }') }); return r; })()).ok);
const g = await fetch(URL_ + '/api/games', { method: 'GET' });
check('GET is still refused', g.status === 405, String(g.status));

console.log(bad ? `\n${bad} failed` : `\nall live proxy checks passed`);
process.exit(bad ? 1 : 0);
