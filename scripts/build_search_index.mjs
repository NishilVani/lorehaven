#!/usr/bin/env node
/**
 * Build the shipped search index: src/services/search/searchIndex.json.
 *
 * The small on-device half of search (see src/services/search/engine.js). It
 * holds what makes typing feel instant and forgiving, and nothing more:
 *
 *   g  the ~3,000 most-rated main games, plus the most-anticipated unreleased
 *      ones, each with its year, cover, popularity and IGDB's own alternative
 *      names (BotW, RE4, GTA V) -- the titles people actually type
 *   f  the franchises those games belong to, by how much of the list they hold
 *   c  the studios that made them, the same way
 *   w  a spelling dictionary: the words of the ~15,000 most-rated titles that
 *      are NOT already in g (those are rebuilt from g at runtime), most common
 *      first, so a typo in a game outside the index can still be corrected
 *      before IGDB is asked
 *
 * Editions, bundles and ports never enter it (version_parent = null, main game
 * types only): the index exists partly to rank the game above its Deluxe
 * Edition, which IGDB does not.
 *
 * It goes through the app's own proxy, which holds the IGDB credential, so the
 * build needs no secret. The release workflow runs it before `vite build`; if
 * IGDB cannot be reached it exits non-zero WITHOUT touching the committed copy,
 * and the release ships the last good index rather than none.
 *
 * Run: node scripts/build_search_index.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalize, tokens, isWord } from '../src/services/search/normalize.js';

const OUT = resolve('src/services/search/searchIndex.json');
const GAMES = 2700;
const HYPED = 300;
const DICT_GAMES = 15000;
/* Sized to stay under ~90 KB compressed. Aliases are the expensive part, so
   only short ones are kept: abbreviations (BotW, RE4, GTA V) are what people
   type, long regional titles mostly are not. */
const KEEP = { franchises: 300, companies: 300, words: 6000, aliases: 2, aliasChars: 12 };

const proxy = (() => {
  if (process.env.VITE_PROXY_ORIGIN) return process.env.VITE_PROXY_ORIGIN;
  try {
    const m = readFileSync(resolve('.env.production'), 'utf8').match(/^VITE_PROXY_ORIGIN=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  throw new Error('VITE_PROXY_ORIGIN is not set and .env.production has none');
})();

/* IGDB serves four requests a second per client id, shared with every user of
   the proxy. 300ms apart, and a 429 waits and tries again. */
let last = 0;
async function igdb(endpoint, body, attempt = 0) {
  const wait = last + 300 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(`${proxy}/api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body });
  if (res.status === 429 && attempt < 4) {
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    return igdb(endpoint, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`IGDB ${endpoint} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`IGDB ${endpoint} returned ${JSON.stringify(data).slice(0, 120)}`);
  return data;
}

const MAIN = 'version_parent = null & game_type = (0,4,8,9,10)';

async function pages(fields, where, sort, total) {
  const out = [];
  for (let offset = 0; offset < total; offset += 500) {
    const page = await igdb('games', `fields ${fields}; where ${where}; sort ${sort}; limit ${Math.min(500, total - offset)}; offset ${offset};`);
    out.push(...page);
    process.stdout.write(`\r  ${out.length} / ${total}`);
    if (page.length < 500) break;
  }
  process.stdout.write('\n');
  return out;
}

/* Aliases people could type on a Latin keyboard: IGDB lists Japanese, Russian
   and Korean titles too, which no one reaching for this search is typing. */
const LATIN = /^[\p{Script=Latin}\d\s\p{P}\p{S}]+$/u;
function aliasesOf(g) {
  const own = normalize(g.name);
  const seen = new Set([own]);
  const out = [];
  for (const a of g.alternative_names || []) {
    const name = String(a.name || '').trim();
    const n = normalize(name);
    /* IGDB also files executable names (hl2.exe, PlayRDR2.exe) for process
       matching; nobody searches for those. */
    if (!n || name.length > KEEP.aliasChars || !LATIN.test(name) || /.(exe|bin|app|x86)$/i.test(name) || seen.has(n)) continue;
    seen.add(n);
    out.push(name);
    if (out.length >= KEEP.aliases) break;
  }
  return out;
}

const yearOf = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : 0);

async function main() {
  console.log(`proxy ${proxy}`);
  console.log('top games');
  const top = await pages(
    'name, alternative_names.name, first_release_date, cover.image_id, total_rating_count, franchises.name, involved_companies.company.name, involved_companies.developer',
    `${MAIN} & total_rating_count > 0`, 'total_rating_count desc', GAMES);

  console.log('most anticipated');
  const now = Math.floor(Date.now() / 1000);
  const hyped = await pages(
    'name, alternative_names.name, first_release_date, cover.image_id, hypes, franchises.name, involved_companies.company.name, involved_companies.developer',
    `version_parent = null & game_type = (0,4,8) & hypes > 0 & (first_release_date > ${now} | first_release_date = null)`, 'hypes desc', HYPED);

  console.log('dictionary titles');
  const dictGames = await pages('name, alternative_names.name', `${MAIN} & total_rating_count > 0`, 'total_rating_count desc', DICT_GAMES);

  const games = [];
  const seen = new Set();
  const franchises = new Map();
  const companies = new Map();
  const credit = (map, id, name, w) => {
    if (!id || !name) return;
    const cur = map.get(id) || { id, name, n: 0 };
    cur.n += w;
    map.set(id, cur);
  };
  const add = (g, pop) => {
    if (seen.has(g.id) || !g.name) return;
    seen.add(g.id);
    const al = aliasesOf(g);
    /* Popularity as a log bucket, 0..~80: ranking only ever uses its log, and
       small numbers compress far better than raw rating counts. */
    games.push([g.id, g.name, yearOf(g), g.cover?.image_id || '', Math.round(Math.log10(1 + pop) * 20), ...(al.length ? [al] : [])]);
    const w = Math.log10(1 + pop);
    for (const f of g.franchises || []) credit(franchises, f.id, f.name, w);
    for (const ic of g.involved_companies || []) if (ic.developer) credit(companies, ic.company?.id, ic.company?.name, w);
  };
  top.forEach(g => add(g, g.total_rating_count || 0));
  /* Unreleased games have no ratings; their followers stand in, scaled down so
     an announced sequel does not outrank the game it follows. */
  hyped.forEach(g => add(g, (g.hypes || 0) / 4));

  const counts = new Map();
  for (const g of [...dictGames, ...top, ...hyped]) {
    for (const n of [g.name, ...aliasesOf(g)]) {
      for (const t of tokens(n)) if (isWord(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  /* Words already in an indexed title are rebuilt from the titles at runtime;
     only the rest is shipped, most common first. */
  const inTitles = new Set(games.flatMap(g => [g[1], ...(g[5] || [])].flatMap(tokens)));
  const words = [...counts.entries()].filter(([w]) => !inTitles.has(w))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, KEEP.words).map(([w]) => w);

  const pick = (map) => [...map.values()].sort((a, b) => b.n - a.n).slice(0, 300).map(x => [x.id, x.name, Math.round(x.n * 10)]);
  const index = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    g: games,
    f: pick(franchises).slice(0, KEEP.franchises),
    c: pick(companies).slice(0, KEEP.companies),
    w: words.join(' '),
  };
  const json = JSON.stringify(index);
  writeFileSync(OUT, json + '\n');
  console.log(`wrote ${OUT}: ${games.length} games, ${index.f.length} franchises, ${index.c.length} studios, ${words.length} words, ${(json.length / 1024).toFixed(0)} KB raw`);
}

main().catch(err => {
  console.error(`search index NOT rebuilt, keeping the committed copy: ${err.message}`);
  process.exit(1);
});
