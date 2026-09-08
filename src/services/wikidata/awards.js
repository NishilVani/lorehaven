// Awards — sourced live from Wikidata, cached in localStorage.
//
// Model:  game --P166 (award received)--> category --P361 (part of)--> ceremony
//         year lives on the P166 statement as qualifier P585
//         IGDB numeric id: P5794 statement, qualifier P9043
//
// The label service MUST use "en,mul": since Wikidata's 2024 migration, titles
// that read the same in every language (i.e. most game names) live under the
// `mul` language code, not `en`. Filtering on LANG(?l)="en" silently drops
// them — that bug hid every TGA winner after 2020.

// Wikidata sends no CORS headers, so a browser can't call it directly.
// Same shape as src/services/igdb.js: the proxy path is the canonical URL, and
// under Tauri we rewrite to the real host and use the plugin (not CORS-bound).
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
/* 2.5 kB, captured from a real query. The ceremony INDEX changes about once a
   year, so shipping it costs nothing and buys a first paint on a browser that has
   never run this app — including CI. Refresh it by copying
   localStorage['lh_awards_ceremonies'].data after a successful /awards load. */
import CEREMONIES_SEED from './ceremonies.seed.json';

const ENDPOINT = '/wdqs/sparql'; // Vite proxies → https://query.wikidata.org

const nativeFetch = window.fetch.bind(window);
const proxiedFetch = async (url, options) => {
  if (window.__TAURI_INTERNALS__) {
    /* Through the proxy, which carries the user agent Wikimedia's policy asks
       for. WD_HOST is no longer reachable from a client. */
    return tauriFetch(url.startsWith('/wdqs') ? (import.meta.env.VITE_PROXY_ORIGIN || '') + url : url, options);
  }
  /* Same for the browser: on a static host there is nothing to proxy /wdqs. */
  return nativeFetch(url.startsWith('/wdqs') ? (import.meta.env.VITE_PROXY_ORIGIN || '') + url : url, options);
};

const CACHE_PREFIX = 'lh_awards_';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — awards data changes ~yearly

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Strip the ceremony name off a category label:
 *   "The Game Awards − Best Action"                  → "Best Action"
 *   "British Academy Games Award for Animation"      → "Animation"   (note: singular)
 *   "Steam Award for Best Environment"               → "Best Environment"
 * Wikidata is inconsistent about plural ("Awards" vs "Award"), a leading
 * "The", and the separator (−, –, —, -, or "for"), so try each variant and
 * take the longest prefix that actually matches.
 */
export const stripCeremonyPrefix = (categoryLabel, ceremonyLabel) => {
  if (!categoryLabel) return '';
  if (!ceremonyLabel) return categoryLabel;

  const base = ceremonyLabel.trim();
  const candidates = new Set([
    base,
    base.replace(/^The\s+/i, ''),
    base.replace(/s$/i, ''),                     // Awards → Award
    base.replace(/^The\s+/i, '').replace(/s$/i, ''),
  ]);

  let best = categoryLabel;
  for (const c of candidates) {
    if (!c) continue;
    // optional trailing "s", then a dash or "for"
    const re = new RegExp(`^${escapeRe(c)}s?\\s*(?:[−–—-]|\\bfor\\b)\\s*`, 'i');
    const out = categoryLabel.replace(re, '').trim();
    if (out && out.length < best.length) best = out;
  }
  return best || categoryLabel;
};

/** Collapse duplicate rows — Wikidata can carry several qualifiers per statement */
export const dedupeWins = (wins) => {
  const seen = new Map();
  for (const w of wins) {
        const key = `${w.categoryQid}|${w.gameTitle}|${w.year ?? ''}`;
    // Prefer the copy that carries an IGDB id
    if (!seen.has(key) || (!seen.get(key).igdbId && w.igdbId)) seen.set(key, w);
  }
  return [...seen.values()];
};

const cacheGet = (key) => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (Date.now() - at > TTL_MS) return null;
    return data;
  } catch { return null; }
};

const cacheSet = (key, data) => {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch { /* quota — cache is optional */ }
};

/* ── Award game projection ────────────────────────────────────────────────────
 *
 * A ceremony resolves hundreds of Wikidata winners to IGDB ids and then asks
 * IGDB for each one so the page has covers and studios. Measured on the British
 * Academy Games Awards: 392 wins + 1,677 nominees resolve to 676 distinct games.
 *
 * Left to the general games cache those 676 entries are 93% of everything it
 * holds — it sits at 99.9% of its 1MB budget with 723 entries, because a full
 * IGDB payload averages 1,449 chars. Opening a second ceremony evicts the first,
 * so every visit refetches from IGDB, and the games cache stops being useful to
 * the rest of the app while you are in here.
 *
 * The page reads five fields. Storing five fields instead of the whole payload
 * is ~10x smaller, which makes the entire awards corpus cacheable at once —
 * Wikidata knows of ~2,500 distinct award-winning-or-nominated games in total,
 * so this cache is bounded by the data, not by a guess.
 *
 * Keys are single letters because this map is written once per ceremony and read
 * on every render; the field names would otherwise be most of the bytes.
 */
const AWARD_GAMES_KEY = 'games';
const AWARD_GAMES_MAX = 4000;      // comfortably above the ~2,500-game corpus

/** Full IGDB game → the five fields AwardCeremony actually reads. */
const slimGame = (g) => ({
  i: g.id,
  n: g.name,
  c: g.cover?.image_id || null,
  a: g.artworks?.[0]?.image_id || g.screenshots?.[0]?.image_id || null,
  d: g.involved_companies?.find(ic => ic.developer)?.company?.name || null,
  r: g.first_release_date || null,
});

/** Back to the shape `toGame` expects, so no caller has to learn two shapes. */
const unslimGame = (s) => ({
  id: s.i,
  name: s.n,
  cover: s.c ? { image_id: s.c } : undefined,
  artworks: s.a ? [{ image_id: s.a }] : undefined,
  involved_companies: s.d ? [{ developer: true, company: { name: s.d } }] : undefined,
  first_release_date: s.r || undefined,
});

/** Cached award games for these ids → { byId, missing }. Never throws. */
export const getCachedAwardGames = (ids) => {
  const store = cacheGet(AWARD_GAMES_KEY) || {};
  const byId = {};
  const missing = [];
  for (const id of ids) {
    const hit = store[String(id)];
    if (hit) byId[String(id)] = unslimGame(hit);
    else missing.push(id);
  }
  return { byId, missing };
};

/** Merge freshly fetched games into the projection. Never throws. */
export const cacheAwardGames = (games) => {
  if (!games?.length) return;
  const store = cacheGet(AWARD_GAMES_KEY) || cacheGetStale(AWARD_GAMES_KEY) || {};
  for (const g of games) if (g?.id != null) store[String(g.id)] = slimGame(g);
  let entries = Object.entries(store);
  /* Drop-oldest is not available here — the projection carries no timestamp, and
     adding one per game would cost more than the cap saves. Trimming from the
     front is arbitrary but bounded, and a dropped entry costs one refetch. */
  if (entries.length > AWARD_GAMES_MAX) entries = entries.slice(entries.length - AWARD_GAMES_MAX);
  cacheSet(AWARD_GAMES_KEY, Object.fromEntries(entries));
};

/** Cached value ignoring TTL — the safety net when the network is down. */
const cacheGetStale = (key) => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw).data : null;
  } catch { return null; }
};

// ── Shared Firestore cache — award_cache/{igdbId} ────────────────────────────
// One Wikidata query per game per TTL is shared by every user instead of one
// query per user. All ops are best-effort: if Firestore is unreachable or the
// security rules block it, awards fall back to the localStorage + Wikidata path.
// Rules needed:  match /award_cache/{id} { allow read: if true;
//                allow write: if request.auth != null; }
const AWARDS_COLLECTION = 'award_cache';
const FIRE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — awards change ~yearly

/**
 * → { data, fresh } or null. Never throws.
 *
 * Generic over the cache key, not just game ids. The ceremonies index and each
 * ceremony's detail were the two payloads NOT sharing this tier, and they are the
 * expensive ones: /awards measured 27.5s cold to render its 41 ceremonies, because
 * every fresh browser re-ran the same aggregate SPARQL query from scratch.
 * `docId` stays separable from the storage key so existing award_cache/{igdbId}
 * documents keep resolving instead of being orphaned by a key rename.
 */
const fireGet = async (docId) => {
  try {
    const snap = await getDoc(doc(db, AWARDS_COLLECTION, docId));
    if (!snap.exists()) return null;
    const d = snap.data();
    const at = d.updatedAt?.toMillis?.() ?? 0;
    return { data: d.awards ?? null, fresh: Date.now() - at < FIRE_TTL_MS };
  } catch (e) {
    console.warn('[awards] Firestore read failed:', e.message);
    return null;
  }
};

/** Fire-and-forget write of fresh Wikidata data to the shared cache. Never throws. */
const fireSet = async (docId, data) => {
  try {
    await setDoc(doc(db, AWARDS_COLLECTION, docId), { awards: data, updatedAt: serverTimestamp() });
  } catch (e) {
    console.warn('[awards] Firestore write failed (check rules for award_cache/):', e.message);
  }
};

const sameAwards = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every awards payload, served fastest-first across three tiers:
 *   1. localStorage — instant, per user
 *   2. Firestore    — shared by every user, one Wikidata query per key per TTL
 *   3. Wikidata     — the source of truth, and the only slow one
 *
 * `onUpdate(data)` fires with progressively better data so a page can paint what
 * it already has and upgrade in place instead of holding a skeleton. That is the
 * difference between /awards showing 41 ceremonies immediately and showing
 * "QUERYING WIKIDATA…" for 27.5 seconds.
 *
 * Wikidata is flaky and awards barely change, so a key that loaded once should
 * never show an error again: on any network failure we serve the best cached copy
 * we have rather than throwing.
 */
async function cached(key, produce, { onUpdate, docId = key, seed, baseline } = {}) {
  // Tier 1 — a fresh local copy short-circuits all network work.
  const fresh = cacheGet(key);
  if (fresh) { onUpdate?.(fresh); return fresh; }

  // Paint whatever we have, however old, while the rest of this runs.
  const stale = cacheGetStale(key);
  if (stale) onUpdate?.(stale);

  /* Tier 1b — the shipped corpus. Unlike `seed` below this is the real payload,
     not a label, so it is adopted as the local cache and the network is not
     consulted at all: a cold ceremony goes from two serialized SPARQL queries
     (6.1s measured on the British Academy Games Awards) to a local read.
     The 30-day TTL on the line above is what eventually sends a returning user
     back to Wikidata, so a shipped copy ages exactly like a fetched one.
     Ranked below `stale` deliberately — a copy this user actually fetched is
     about their own last visit, and superseding it with a build artifact would
     be a downgrade dressed as an upgrade. */
  if (!stale && baseline) {
    cacheSet(key, baseline);
    onUpdate?.(baseline);
    return baseline;
  }

  /* Tier 0 — a committed snapshot, for the one case no cache can cover: a browser
     that has never loaded this app. It is PAINT ONLY. It is never written to
     localStorage and never short-circuits the tiers below, so it cannot go stale
     silently — it just replaces an empty skeleton with a real list on first paint,
     and the live data overwrites it moments later. */
  else if (seed) onUpdate?.(seed);

  // Tier 2 — the shared cache. A new device or a cold CI browser lands here
  // instead of on the 27.5s query.
  const shared = await fireGet(docId);
  if (shared?.data) {
    cacheSet(key, shared.data);
    if (!stale || !sameAwards(shared.data, stale)) onUpdate?.(shared.data);
    if (shared.fresh) return shared.data;
  }

  // Tier 3 — Wikidata, only when nothing above was fresh.
  try {
    /* `emit` lets a producer paint an intermediate result without ending the
       tier. Only the value it RETURNS is written to localStorage and Firestore —
       a partial must never be persisted, or the half that had not arrived yet
       becomes permanently missing for that key's whole 30-day TTL. */
    const data = await produce((partial) => { if (partial) onUpdate?.(partial); });
    cacheSet(key, data);
    if (!stale || !sameAwards(data, stale)) onUpdate?.(data);
    fireSet(docId, data);          // fire-and-forget: refresh the shared cache
    return data;
  } catch (e) {
    const fallback = shared?.data ?? stale;
    if (fallback) {
      console.warn(`[awards] "${key}" query failed, serving cached copy — ${e.message}`);
      return fallback;
    }
    throw e;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// WDQS 429s on concurrent/burst queries — two parallel fetches is already too
// many. Every query goes through this one-at-a-time chain.
// ponytail: serial + small gap is plenty at this app's volume; add a token
// bucket only if a screen ever needs many independent queries at once.
let chain = Promise.resolve();
const GAP_MS = 350;
const serialize = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.then(() => sleep(GAP_MS), () => sleep(GAP_MS));
  return run;
};

// Throttling (429) and gateway hiccups (502/503/504 — the proxy giving up on a
// slow upstream) are all transient; everything else is a real error.
const RETRYABLE = new Set([429, 502, 503, 504]);
/* 8s, not 30s. Queries run through the serial chain above, so the budget
   compounds: at 30s x 3 attempts + backoff a single query could hold the UI for
   93s, and a ceremony issues more than one. Nobody waits that long at a skeleton.
   A WDQS query that has not answered in 8s is not about to. */
const TIMEOUT_MS = 8000;
const ATTEMPTS = 3;

/* A bounded retry is still up to ~27s, and a skeleton that never changes reads as
   broken rather than busy. Pages listen for this and say which attempt they are on. */
const progress = (detail) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('moctale_wikidata_progress', { detail }));
  }
};

/** POST a SPARQL query — serialized, bounded, with backoff on transient faults. */
function wdqs(sparql) {
  return serialize(async () => {
    let lastFault = 'unknown';
    progress({ start: true });

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      // A hung proxy must not wedge the queue behind it
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await proxiedFetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Accept': 'application/sparql-results+json',
            'Content-Type': 'application/x-www-form-urlencoded',
            // Browsers drop this (forbidden header) and the dev proxy adds its
            // own, but the packaged Tauri app has no proxy — without a real UA
            // Wikimedia 429s/403s it, which is the main cause of prod failures.
            'User-Agent': 'LoreHaven/1.0 (game library app; contact via app repo)',
          },
          body: `query=${encodeURIComponent(sparql)}`,
          signal: ctl.signal,
        });
      } catch (e) {
        lastFault = e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s`
          : (e.message || e.name || String(e) || 'network error');
        if (attempt === ATTEMPTS - 1) break;
        progress({ attempt: attempt + 2, of: ATTEMPTS, fault: lastFault });
        await sleep(2 ** attempt * 1000);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (RETRYABLE.has(res.status)) {
        lastFault = `HTTP ${res.status}`;
        const retryAfter = Number(res.headers.get('Retry-After'));
        const waitMs = (retryAfter > 0 ? Math.min(retryAfter, 10) : 2 ** attempt) * 1000;
        if (attempt === ATTEMPTS - 1) break;
        progress({ attempt: attempt + 2, of: ATTEMPTS, fault: lastFault });
        await sleep(waitMs);
        continue;
      }
      // statusText is empty over HTTP/2 — report the code and body instead
      if (!res.ok) throw new Error(`Wikidata query failed (HTTP ${res.status}): ${(await res.text()).slice(0, 120)}`);

      progress({ done: true });
      return (await res.json()).results.bindings;
    }

    throw new Error(`Wikidata unavailable (${lastFault}) — it throttles bursts; try again shortly`);
  });
}

const qid = (uri) => (uri ? uri.split('/').pop() : null);

/* ── The shipped corpus ───────────────────────────────────────────────────────
 * Every win and nomination Wikidata holds for a video game, built by
 * scripts/build_awards_corpus.mjs. 334 kB raw, ~101 kB over the wire, and
 * dynamically imported so it lands in its own chunk and only downloads for
 * someone who actually opens an awards page.
 *
 * It is also more complete than the live queries it replaces: those carry
 * LIMIT 800 / LIMIT 2000, and The Game Awards hit the nominee ceiling exactly,
 * so the runtime path was silently dropping nominees. The corpus has 6,800.
 */
let corpusPromise = null;
const loadCorpus = () => (corpusPromise ??= import('./awardsCorpus.json')
  .then(m => m.default)
  .catch(() => null));          // a missing corpus just means the old path runs

/** Packed row → the shape winRows() produces, so nothing downstream changes. */
const unpackRows = (c, rows) => dedupeWins(rows.map(([gi, ci, year]) => {
  const [igdbId, gameTitle, gameQid, site] = c.games[gi];
  const [categoryQid, categoryLabel] = c.categories[ci];
  /* Always true: the corpus query requires P31/P279* -> Q7889, so a non-game
     recipient never enters the file. The runtime query has to carry an EXISTS
     per row and filter client-side, which is how a person's name reached the
     nominee grid. */
  return { gameTitle, igdbId, gameQid, site, isGame: true, categoryQid, categoryLabel, year };
}));

/** The corpus entry for one ceremony, in fetchCeremony's return shape, or null. */
const corpusCeremony = (c, ceremonyQid) => {
  const entry = c?.byCeremony?.[ceremonyQid];
  if (!entry) return null;
  return {
    label: c.ceremonies.find(x => x.qid === ceremonyQid)?.label || ceremonyQid,
    wins: unpackRows(c, entry.wins),
    nominees: unpackRows(c, entry.nominees),
  };
};

/**
 * Every ceremony that video games have actually won something at.
 * → [{ qid, label, games }]
 */
export async function fetchCeremonies(onUpdate) {
  const corpus = await loadCorpus();
  return cached('ceremonies', async () => {
    const rows = await wdqs(`
SELECT ?ceremony ?ceremonyLabel (COUNT(DISTINCT ?game) AS ?games) WHERE {
  ?game wdt:P31/wdt:P279* wd:Q7889 .
  ?game p:P166/ps:P166 ?cat .
  ?cat wdt:P361 ?ceremony .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
GROUP BY ?ceremony ?ceremonyLabel
ORDER BY DESC(?games)
LIMIT 200`);

    return rows
      .map(r => ({
        qid: qid(r.ceremony.value),
        label: r.ceremonyLabel?.value || qid(r.ceremony.value),
        games: Number(r.games?.value || 0),
      }))
      // Drop items whose label never resolved — a bare QID is not a name
      .filter(c => !/^Q\d+$/.test(c.label));
  }, { onUpdate, seed: CEREMONIES_SEED, baseline: corpus?.ceremonies });
}

const winRows = (rows) => dedupeWins(rows.map(r => ({
  gameTitle: r.gameLabel?.value || '(untitled)',
  igdbId: r.igdbId?.value || null,
  // Fallbacks for entries with no IGDB id: their own site, else Wikidata
  gameQid: qid(r.game?.value),
  site: r.site?.value || null,
  // Is the recipient actually a video game? Ceremonies drag in unrelated awards
  // via P361 — e.g. BAFTA Fellowship (film people) is listed as part of the
  // British Academy GAMES Awards, inventing ~20 junk years of non-game winners.
  isGame: r.isGame?.value === 'true',
  categoryQid: qid(r.cat.value),
  categoryLabel: r.catLabel?.value || qid(r.cat.value),
  year: r.year ? Number(r.year.value) : null,
})));

/** One item's label. Only used when the ceremonies list isn't cached. */
async function fetchLabel(itemQid) {
  const rows = await wdqs(`
SELECT ?label WHERE {
  BIND(wd:${itemQid} AS ?item)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". ?item rdfs:label ?label. }
} LIMIT 1`);
  const l = rows[0]?.label?.value;
  return l && !/^Q\d+$/.test(l) ? l : itemQid;
}

/**
 * A ceremony and everything it has ever awarded. Also accepts a standalone
 * category QID (an award with no parent), handled by a fallback query.
 * → { label, wins: [{ gameTitle, igdbId, categoryQid, categoryLabel, year }] }
 *
 * Deliberately NOT one clever query: a `UNION` covering both shapes made WDQS
 * scan every P166 statement and 504 at 65s. Two narrow queries — the second
 * only when the first is empty — return in ~2s. Ordering is done client-side;
 * an ORDER BY here cost ~10s for nothing.
 */
export async function fetchCeremony(ceremonyQid, onUpdate) {
  /* Tier-0 paint for a never-seen browser: the ceremony's NAME, which the shipped
     ceremonies seed already carries. Measured cold, this route sat on a blank
     skeleton for 24.3s through two 502s and a 429 — the best-designed screen in the
     product behind the worst wait in it.

     Deliberately label-only. Seeding empty `wins` would let the page render as
     "this ceremony has no winners", which is a lie; `_seed` tells the page to show
     the real title and KEEP its loading state until actual data lands. */
  const seedLabel = CEREMONIES_SEED.find(c => c.qid === ceremonyQid)?.label;
  const seed = seedLabel ? { label: seedLabel, wins: [], nominees: [], _seed: true } : undefined;
  const baseline = corpusCeremony(await loadCorpus(), ceremonyQid);

  // cache key is versioned — payload gained `nominees`, then qid/site, then isGame
  return cached(`ceremony4_${ceremonyQid}`, async (emit) => {
    const fields = `?game ?gameLabel ?igdbId ?site ?cat ?catLabel ?year ?isGame`;
    // prop: P166 = award received (winner), P1411 = nominated for
    const query = (prop, standalone, limit) => `
SELECT ${fields} WHERE {
  ${standalone ? `BIND(wd:${ceremonyQid} AS ?cat)` : `?cat wdt:P361 wd:${ceremonyQid} .`}
  ?game p:${prop} ?st .
  ?st ps:${prop} ?cat .
  OPTIONAL { ?st pq:P585 ?pit . BIND(YEAR(?pit) AS ?year) }
  OPTIONAL { ?game p:P5794/pq:P9043 ?igdbId . }
  OPTIONAL { ?game wdt:P856 ?site . }
  BIND(EXISTS { ?game wdt:P31/wdt:P279* wd:Q7889 } AS ?isGame)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
LIMIT ${limit}`;

    // Fast path — the QID is a ceremony, so its categories carry the wins
    let standalone = false;
    let rows = await wdqs(query('P166', false, 800));

    // Fallback — the QID is itself a category with no parent ceremony
    if (rows.length === 0) {
      standalone = true;
      rows = await wdqs(query('P166', true, 800));
    }

    // The label is already in the cached ceremonies list — don't pay for it twice
    const known = (cacheGet('ceremonies') || []).find(c => c.qid === ceremonyQid)?.label;
    const wins = winRows(rows);

    /* Paint the winners before asking for the losing field.
       Measured on The Game Awards, cold: wins land at 1.7s and nominees at 4.3s,
       and nothing rendered until 5.1s because both were awaited before returning.
       Nominees are the more expensive half by every measure — 1,821ms against
       1,531ms, and 1,179kB against 276kB — while being the supporting cast on a
       page whose subject is who won. So the winners go up as soon as they exist
       and the nominees fill in underneath them.

       `label` may be null here when the ceremonies cache is cold; the page keeps
       whatever the tier-0 seed already put on screen rather than blanking it. */
    emit({ label: known || seedLabel || null, wins, nominees: [], _partial: true });

    // Nominees (the losing field) — same shape, far more rows
    let nomRows = [];
    try { nomRows = await wdqs(query('P1411', standalone, 2000)); } catch { /* nominees are optional */ }

    const label = known || await fetchLabel(ceremonyQid);

    return { label, wins, nominees: winRows(nomRows) };
  }, { onUpdate, seed, baseline });
}

/**
 * Query Wikidata for a game's wins (P166) and nominations (P1411).
 * → [{ kind: 'win'|'nomination', categoryQid, categoryLabel, category,
 *      ceremonyQid, ceremonyLabel, displayCeremony, year }]
 */
async function produceGameAwards(igdbId) {
  const id = String(igdbId).replace(/"/g, '');
  // prop: P166 = award received (win), P1411 = nominated for
  const query = (prop) => `
SELECT ?cat ?catLabel ?ceremony ?ceremonyLabel ?year WHERE {
  VALUES ?igdbId { "${id}" }
  ?game p:P5794 ?igdbStmt .
  ?igdbStmt pq:P9043 ?igdbId .
  ?game p:${prop} ?st .
  ?st ps:${prop} ?cat .
  OPTIONAL { ?st pq:P585 ?pit . BIND(YEAR(?pit) AS ?year) }
  OPTIONAL { ?cat wdt:P361 ?ceremony . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
ORDER BY DESC(?year)
LIMIT 500`;

  const shape = (kind) => (r) => {
    const ceremonyLabel = r.ceremonyLabel?.value || null;
    const categoryLabel = r.catLabel?.value || qid(r.cat.value);
    return {
      kind,
      categoryQid: qid(r.cat.value),
      categoryLabel,
      ceremonyQid: r.ceremony ? qid(r.ceremony.value) : null,
      ceremonyLabel,
      // What to show as the ceremony name when there's no parent item
      displayCeremony: ceremonyLabel || categoryLabel,
      category: ceremonyLabel ? stripCeremonyPrefix(categoryLabel, ceremonyLabel) : null,
      year: r.year ? Number(r.year.value) : null,
    };
  };

  // Same statement can repeat across qualifiers — collapse per category+year
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter(a => {
      const k = `${a.categoryQid}|${a.year ?? ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const wins = dedupe((await wdqs(query('P166'))).map(shape('win')));

  // Nominations are optional — a failed/empty nominee query still yields wins
  let nomRows = [];
  try { nomRows = (await wdqs(query('P1411'))).map(shape('nomination')); }
  catch { /* nominations are a nice-to-have */ }
  const wonKeys = new Set(wins.map(a => `${a.categoryQid}|${a.year ?? ''}`));
  const noms = dedupe(nomRows).filter(a => !wonKeys.has(`${a.categoryQid}|${a.year ?? ''}`));

  return [...wins, ...noms];
}

/**
 * A game's awards (wins + nominations), served fastest-first across three tiers:
 *   1. localStorage — instant, per-user
 *   2. Firestore    — shared across all users
 *   3. Wikidata     — the source of truth
 *
 * `onUpdate(rows)` fires with progressively better/fresher data so the UI can
 * paint the cached copy immediately and upgrade in the background. Wikidata is
 * queried only when neither localStorage nor Firestore has a fresh copy — so
 * the whole user base shares one Wikidata query per game per TTL, instead of
 * every user re-querying the same data. On a real change, the fresh Wikidata
 * result is written back to both Firestore and localStorage.
 */
export async function fetchGameAwards(igdbId, onUpdate = () => {}) {
  if (!igdbId) return [];
  /* docId stays the bare igdb id so the award_cache documents already written by
     the previous implementation keep resolving. */
  return cached(`game2_${igdbId}`, () => produceGameAwards(igdbId), {
    onUpdate,
    docId: String(igdbId),
  }).catch((e) => {
    console.warn('[awards] Wikidata query failed and nothing was cached —', e.message);
    return [];
  });
}

/**
 * Force the next load to re-query (Awards page "Reload"). Expires entries
 * rather than deleting them, so if the refresh fails, stale-while-error can
 * still serve the old data instead of erroring.
 */
export function clearAwardsCache() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(CACHE_PREFIX))
    .forEach(k => {
      try {
        const parsed = JSON.parse(localStorage.getItem(k));
        localStorage.setItem(k, JSON.stringify({ at: 0, data: parsed.data }));
      } catch { localStorage.removeItem(k); }
    });
}

/* Self-check for the pure logic — run `__awardsSelfCheck()` in the console. */
export function __awardsSelfCheck() {
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  eq(stripCeremonyPrefix('The Game Awards − Best Action', 'The Game Awards'), 'Best Action', 'en-dash');
  eq(stripCeremonyPrefix('The Game Awards – Best Family Game', 'The Game Awards'), 'Best Family Game', 'em-dash');
  // singular category under a plural ceremony
  eq(stripCeremonyPrefix('British Academy Games Award for Animation', 'British Academy Games Awards'), 'Animation', 'plural→singular + for');
  // category drops the leading "The" the ceremony carries
  eq(stripCeremonyPrefix('Steam Award for Best Environment', 'The Steam Awards'), 'Best Environment', 'leading The dropped');
  eq(stripCeremonyPrefix('Game Changer', 'The Game Awards'), 'Game Changer', 'no prefix');
  eq(stripCeremonyPrefix('The Game Awards', 'The Game Awards'), 'The Game Awards', 'never blank');
  const d = dedupeWins([
    { categoryQid: 'Q1', gameTitle: 'A', year: 2025, igdbId: null },
    { categoryQid: 'Q1', gameTitle: 'A', year: 2025, igdbId: '99' },
    { categoryQid: 'Q1', gameTitle: 'A', year: 2024, igdbId: null },
  ]);
  eq(d.length, 2, 'dedupe collapses same cat+game+year');
  eq(d[0].igdbId, '99', 'dedupe prefers the row with an igdb id');
  return 'awards self-check ok';
}
