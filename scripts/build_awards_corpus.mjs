#!/usr/bin/env node
/**
 * Build the shipped awards corpus.
 *
 * Every award any video game has ever won or been nominated for, from Wikidata,
 * in two queries, written to src/services/wikidata/awardsCorpus.json.
 *
 * Why ship it at all: a cold ceremony page cost two serialized SPARQL queries —
 * measured on the British Academy Games Awards at 6.1s, of which 3.9s was the
 * nominee half alone. The whole corpus is ~8,000 rows. Shipping it turns that
 * page into a local read and demotes Wikidata to a background refresh, which is
 * the same trick ceremonies.seed.json already plays for the index, extended from
 * 41 labels to the actual data.
 *
 * Two interning passes do the compression. Category labels are long and repeat
 * once per year per ceremony ("The Game Awards - Best Action", twelve times),
 * and ceremony ids repeat once per row; both become indices into a table.
 *
 * Games-only by construction: the WHERE clause requires P31/P279* -> Q7889, so
 * the non-game recipients that ceremonies drag in through P361 never enter the
 * file. That is the BAFTA Fellowship problem the runtime query has to filter
 * client-side, and it is why a person's name could appear as a nominee.
 *
 * Run: node scripts/build_awards_corpus.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WDQS = 'https://query.wikidata.org/sparql';
const UA = 'LoreHaven/1.0 (game library app; contact via app repo)';
const OUT = resolve('src/services/wikidata/awardsCorpus.json');
const OUT_INDEX = resolve('src/services/wikidata/awardsIndex.json');

const q = async (label, sparql) => {
  const t = Date.now();
  const res = await fetch(WDQS, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: `query=${encodeURIComponent(sparql)}`,
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()).results.bindings;
  console.log(`  ${label.padEnd(12)} ${String(rows.length).padStart(5)} rows  ${Date.now() - t}ms`);
  return rows;
};

const qid = (uri) => (uri ? uri.split('/').pop() : null);

/** Wins and nominations share a shape; only the property differs. */
const corpusQuery = (prop) => `
SELECT ?game ?gameLabel ?igdbId ?site ?cat ?catLabel ?ceremony ?year WHERE {
  ?game wdt:P31/wdt:P279* wd:Q7889 .
  ?game p:${prop} ?st .
  ?st ps:${prop} ?cat .
  ?cat wdt:P361 ?ceremony .
  OPTIONAL { ?st pq:P585 ?pit . BIND(YEAR(?pit) AS ?year) }
  OPTIONAL { ?game p:P5794/pq:P9043 ?igdbId . }
  OPTIONAL { ?game wdt:P856 ?site . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;

const CEREMONIES = `
SELECT ?ceremony ?ceremonyLabel (COUNT(DISTINCT ?game) AS ?games) WHERE {
  ?game wdt:P31/wdt:P279* wd:Q7889 .
  ?game p:P166/ps:P166 ?cat .
  ?cat wdt:P361 ?ceremony .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
GROUP BY ?ceremony ?ceremonyLabel
ORDER BY DESC(?games)
LIMIT 200`;

console.log('Querying Wikidata…');
const [cerRows, winRows, nomRows] = [
  await q('ceremonies', CEREMONIES),
  await q('wins', corpusQuery('P166')),
  await q('nominations', corpusQuery('P1411')),
];

/* Category table: qid -> index. Labels are the bulk of the payload and repeat
   once per year per ceremony, so they are stored once and referenced. */
const cats = [];
const catIdx = new Map();
const internCat = (catQid, catLabel) => {
  if (!catIdx.has(catQid)) { catIdx.set(catQid, cats.length); cats.push([catQid, catLabel]); }
  return catIdx.get(catQid);
};

/* Game table: qid -> index. A game that sweeps a ceremony appears in a dozen
   rows, and across both files there are ~9,200 rows over ~2,500 distinct games,
   so its title, IGDB id, QID and website were being written out four times each
   on average. Interning them took the file from 791 kB to a third of that. */
const games = [];
const gameIdx = new Map();
const internGame = (r) => {
  const g = qid(r.game?.value);
  if (!gameIdx.has(g)) {
    gameIdx.set(g, games.length);
    games.push([
      r.igdbId?.value || null,
      r.gameLabel?.value || '(untitled)',
      g,
      r.site?.value || null,
    ]);
  }
  return gameIdx.get(g);
};

/** One row → [gameIdx, catIdx, year]. Three numbers; everything else is interned. */
const pack = (r) => [
  internGame(r),
  internCat(qid(r.cat.value), r.catLabel?.value || qid(r.cat.value)),
  r.year ? Number(r.year.value) : null,
];

const byCeremony = {};
const add = (rows, bucket) => {
  for (const r of rows) {
    const c = qid(r.ceremony.value);
    (byCeremony[c] ??= { wins: [], nominees: [] })[bucket].push(pack(r));
  }
};
add(winRows, 'wins');
add(nomRows, 'nominees');

const ceremonies = cerRows
  .map(r => ({ qid: qid(r.ceremony.value), label: r.ceremonyLabel?.value || qid(r.ceremony.value), games: Number(r.games?.value || 0) }))
  // A bare QID is not a name — same filter the runtime query applies.
  .filter(c => !/^Q\d+$/.test(c.label));

const corpus = {
  generatedAt: new Date().toISOString(),
  /* Bumped when the packed row shape changes, so a stale copy in a user's
     localStorage is never merged with a new one. */
  version: 1,
  ceremonies,
  categories: cats,
  games,
  byCeremony,
};

writeFileSync(OUT, JSON.stringify(corpus));

/* A second, much smaller artifact: igdbId -> [wins, nominations].
 *
 * Any page that only needs to ask "has this game won anything" — the event
 * pages, which check a whole slate at once — would otherwise pull the entire
 * corpus for one number. Measured: 8.6 kB gzipped against 101 kB, twelve times
 * smaller, because it drops every ceremony, category, year and title and keeps
 * two integers per game.
 *
 * Derived here rather than in a separate pass so it cannot drift from the
 * corpus: both are written from the same query results in the same run.
 */
const index = {};
for (const entry of Object.values(byCeremony)) {
  const tally = (rows, slot) => {
    for (const [gi] of rows) {
      const igdbId = games[gi][0];
      if (!igdbId) continue;              // no IGDB id, nothing to key on
      (index[igdbId] ??= [0, 0])[slot]++;
    }
  };
  tally(entry.wins, 0);
  tally(entry.nominees, 1);
}
writeFileSync(OUT_INDEX, JSON.stringify(index));
const kB = (JSON.stringify(corpus).length / 1024).toFixed(0);
console.log(`\nWrote ${OUT}`);
console.log(`  ceremonies ${ceremonies.length}`);
console.log(`  categories ${cats.length}`);
console.log(`  games      ${games.length}`);
console.log(`  wins       ${winRows.length}`);
console.log(`  nominees   ${nomRows.length}`);
console.log(`  size       ${kB} kB`);
console.log(`Wrote ${OUT_INDEX}`);
console.log(`  indexed    ${Object.keys(index).length} games, ${(JSON.stringify(index).length / 1024).toFixed(0)} kB`);
