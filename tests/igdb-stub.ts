import type { Page, Route } from '@playwright/test';

/**
 * An offline IGDB for the specs that used to reach the real one.
 *
 * The category, browse, Discover, explore, route-probe and smoke specs had no
 * stub, so they went through the deployed Worker to live IGDB. Their results
 * followed IGDB's response time and catalogue, not the product: phase2's
 * density-chart case failed 2 runs in 4 with no code change, and the e2e job
 * could not be allowed to gate a release. playwright.config.ts now points the
 * proxy at an origin nothing listens on, so a spec that forgets this fails at
 * once instead of passing on a good day.
 *
 * Shape. Same as the stubs in phases 3 and 4: dispatch on pathname, then on the
 * body, whose templates are quoted from src/services/igdb.js. The one
 * difference is the category-shaped queries (the grid, its count, the release
 * histogram and the taxonomy counts). Those specs assert that a narrowing
 * CHANGES what is shown and that the count agrees with the grid, so a canned
 * answer per query would have to agree with every other canned answer. Instead
 * they filter one deterministic catalogue with the query's own where clauses.
 * A clause the filter does not recognise answers 501, so a new query shape
 * fails loudly rather than silently matching everything.
 *
 * Call it BEFORE page.goto. A route a spec adds afterwards takes precedence, so
 * a test can still override one endpoint (an abort, an empty answer) on top.
 */

type Named = { id: number; name: string };
type Platform = Named & { abbreviation: string };
type Game = {
  id: number;
  name: string;
  game_type: number;
  first_release_date: number | null;
  total_rating: number;
  total_rating_count: number;
  hypes: number;
  follows: number;
  created_at: number;
  updated_at: number;
  summary: string;
  cover: { image_id: string; width: number; height: number };
  artworks: { image_id: string; width: number; height: number; alpha_channel: boolean; artwork_type: number }[];
  screenshots: { image_id: string; width: number; height: number }[];
  genres: Named[];
  themes: Named[];
  game_modes: Named[];
  game_engines: Named[];
  platforms: Platform[];
  involved_companies: { company: Named; developer: boolean; publisher: boolean }[];
  franchises: number[];
  collections: number[];
  similar_games: number[];
};

/* Real IGDB ids and names, so a spec that follows a link lands where the live
   app would. Adventure is the largest genre on purpose: routes.spec.ts builds a
   RegExp from the first term's name, and "Role-playing (RPG)" carries regex
   metacharacters. */
export const GENRES: Named[] = [
  { id: 31, name: 'Adventure' },
  { id: 32, name: 'Indie' },
  { id: 8, name: 'Platform' },
  { id: 9, name: 'Puzzle' },
  { id: 12, name: 'Role-playing (RPG)' },
  { id: 5, name: 'Shooter' },
  { id: 15, name: 'Strategy' },
];
export const THEMES: Named[] = [
  { id: 1, name: 'Action' },
  { id: 17, name: 'Fantasy' },
  { id: 19, name: 'Horror' },
  { id: 38, name: 'Open world' },
  { id: 18, name: 'Science fiction' },
];
export const MODES: Named[] = [
  { id: 3, name: 'Co-operative' },
  { id: 2, name: 'Multiplayer' },
  { id: 1, name: 'Single player' },
];
export const PLATFORMS: Platform[] = [
  { id: 6, name: 'PC (Microsoft Windows)', abbreviation: 'PC' },
  { id: 48, name: 'PlayStation 4', abbreviation: 'PS4' },
  { id: 130, name: 'Nintendo Switch', abbreviation: 'Switch' },
  { id: 49, name: 'Xbox One', abbreviation: 'XONE' },
];
const COMPANIES: Named[] = [
  { id: 908, name: 'Stub Studio' },
  { id: 909, name: 'Stub Publishing' },
  { id: 910, name: 'Harbour Works' },
];
const ENGINE: Named = { id: 4, name: 'Stub Engine' };

const nowSec = () => Math.floor(Date.now() / 1000);
const byId = <T extends { id: number }>(list: T[], id: number) => list.find(x => x.id === id);

const WORD_A = ['Amber', 'Brass', 'Cinder', 'Drift', 'Ember', 'Frost', 'Gilded', 'Hollow', 'Iron', 'Jade', 'Lumen',
  'Marrow', 'Nether', 'Onyx', 'Pale', 'Quartz', 'Rust', 'Salt', 'Tidal', 'Umber', 'Vesper', 'Willow'];
const WORD_B = ['Archive', 'Bastion', 'Chronicle', 'Descent', 'Expanse', 'Frontier', 'Garden', 'Harbour', 'Isle',
  'Keep', 'Lantern', 'Meridian', 'Orbit', 'Passage', 'Reliquary', 'Spire', 'Throne', 'Vigil', 'Warden'];

function makeGame(i: number, over: Partial<Game> & { id: number; name: string }): Game {
  const year = 1976 + (i * 13) % 50;
  const dev = COMPANIES[i % 3];
  const pub = COMPANIES[(i + 1) % 3];
  return {
    game_type: i % 6 === 5 ? 8 : 0,
    first_release_date: Date.UTC(year, i % 12, 1 + (i % 27)) / 1000,
    /* Multipliers coprime to the moduli, so rating, popularity, name and date
       orders all disagree with each other and every sort visibly reorders. */
    total_rating: 55 + (i * 37) % 45,
    total_rating_count: 40 + (i * 53) % 997,
    hypes: 3 + i % 20,
    follows: 10 + (i * 31) % 400,
    created_at: 1_700_000_000 - i * 3600,
    updated_at: 1_700_000_000,
    summary: 'A stubbed catalogue entry for the offline end-to-end run.',
    cover: { image_id: `costub${i}`, width: 264, height: 374 },
    artworks: i % 2 === 0
      ? [{ image_id: `arstub${i}`, width: 1920, height: 1080, alpha_channel: false, artwork_type: 1 }]
      : [],
    screenshots: [{ image_id: `scstub${i}`, width: 1920, height: 1080 }],
    genres: [
      ...(i % 10 !== 9 ? [GENRES[0]] : []),
      ...(i % 4 !== 3 ? [byId(GENRES, 12)!] : []),
      GENRES[1 + (i % 6 === 3 ? 5 : i % 5)],
    ].filter((g, k, all) => all.indexOf(g) === k),
    themes: [THEMES[i % THEMES.length]],
    game_modes: [MODES[2], ...(i % 3 === 0 ? [MODES[1]] : [])],
    game_engines: [ENGINE],
    platforms: [PLATFORMS[i % 4], ...(i % 3 === 0 ? [PLATFORMS[(i + 1) % 4]] : [])],
    involved_companies: [
      { company: dev, developer: true, publisher: false },
      { company: pub, developer: false, publisher: true },
    ],
    franchises: [],
    collections: [],
    similar_games: [],
    ...over,
  };
}

/* The ids tests/fixtures.ts and the specs seed into a library, carrying the
   names those specs assert on. */
const KNOWN: Game[] = [
  makeGame(1, { id: 1942, name: 'The Witcher 3: Wild Hunt', first_release_date: 1431993600, total_rating: 93, total_rating_count: 2600 }),
  makeGame(2, { id: 1020, name: 'Grand Theft Auto V', first_release_date: 1379376000, total_rating: 91, total_rating_count: 2400 }),
  makeGame(3, { id: 1905, name: 'Fortnite', first_release_date: 1500940800, total_rating: 74, total_rating_count: 1100 }),
  makeGame(4, { id: 119171, name: 'Baldur’s Gate 3', first_release_date: 1691020800, total_rating: 95, total_rating_count: 1900 }),
  makeGame(5, { id: 472, name: 'The Elder Scrolls V: Skyrim', first_release_date: 1320969600, total_rating: 92, total_rating_count: 2300 }),
];

/* 200 released games: enough for three infinite-scroll pages of a genre
   (24, then 48 at a time) with rows left over. */
export const CATALOGUE: Game[] = [
  ...KNOWN,
  ...Array.from({ length: 200 }, (_, i) => makeGame(i + 10, {
    id: 700_000 + i,
    name: `${WORD_A[(i * 7) % WORD_A.length]} ${WORD_B[(i * 11) % WORD_B.length]} ${i + 1}`,
  })),
];

/* Recently announced: no release date, so none of them leak into a category
   query, which always carries `first_release_date != null`. */
const ANNOUNCED: Game[] = Array.from({ length: 24 }, (_, i) => makeGame(i + 300, {
  id: 720_000 + i,
  name: `Announced ${WORD_B[i % WORD_B.length]} ${i + 1}`,
  first_release_date: null,
  hypes: 60 - i,
  created_at: nowSec() - i * 86400,
}));

const ALL_GAMES = [...CATALOGUE, ...ANNOUNCED];

const COLLECTIONS = [
  { id: 7001, name: 'Stub Saga Collection', type: { name: 'Franchise' }, games: CATALOGUE.slice(0, 3) },
  { id: 7002, name: 'Stub Anthology', type: { name: 'Bundle' }, games: CATALOGUE.slice(5, 7) },
];
const FRANCHISES = [
  { id: 9001, name: 'Stub Franchise Alpha', games: CATALOGUE.slice(0, 2) },
  { id: 9002, name: 'Stub Franchise Beta', games: CATALOGUE.slice(8, 10) },
];

const HOUR = 3600;
const eventRows = (tab: 'upcoming' | 'past') => Array.from({ length: 6 }, (_, i) => {
  const start = tab === 'upcoming' ? nowSec() + (i + 1) * 7 * 24 * HOUR : nowSec() - (i + 1) * 30 * 24 * HOUR;
  return {
    id: 88_000 + (tab === 'upcoming' ? i : 10 + i),
    name: `Stub Showcase ${tab === 'upcoming' ? 'Upcoming' : 'Past'} ${i + 1}`,
    description: 'Stubbed organiser copy for the offline end-to-end run.',
    start_time: start,
    end_time: start + 2 * HOUR,
    event_logo: { image_id: 'ev1' },
    games: [1942, 1020],
  };
});

const slim = (g: Game) => ({ id: g.id, name: g.name, cover: { image_id: g.cover.image_id } });

/* ── The where-clause filter ─────────────────────────────────────────────── */

/** Split on top-level ` & `, leaving parenthesised alternatives whole. */
function topLevel(where: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < where.length; i++) {
    if (where[i] === '(') depth++;
    else if (where[i] === ')') depth--;
    else if (depth === 0 && where.startsWith(' & ', i)) {
      out.push(where.slice(start, i));
      start = i + 3;
      i += 2;
    }
  }
  out.push(where.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

const MEMBERSHIP = ['genres', 'themes', 'game_modes', 'platforms', 'game_engines'] as const;

function predicate(clause: string): ((g: Game) => boolean) | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\w+) = \(([\d,\s]+)\)$/.exec(clause)) && (MEMBERSHIP as readonly string[]).includes(m[1])) {
    const want = m[2].split(',').map(Number);
    const field = m[1] as typeof MEMBERSHIP[number];
    return g => g[field].some(x => want.includes(x.id));
  }
  if ((m = /^involved_companies\.company = (\d+)$/.exec(clause))) {
    const want = Number(m[1]);
    return g => g.involved_companies.some(c => c.company.id === want);
  }
  if ((m = /^id = \(([^)]*)\)$/.exec(clause))) {
    const want = m[1].split(',').map(Number);
    return g => want.includes(g.id);
  }
  if ((m = /^first_release_date (>=|<) (\d+)$/.exec(clause))) {
    const [op, at] = [m[1], Number(m[2])];
    return g => g.first_release_date != null && (op === '>=' ? g.first_release_date >= at : g.first_release_date < at);
  }
  switch (clause) {
    case 'first_release_date != null': return g => g.first_release_date != null;
    case 'cover != null': return g => !!g.cover;
    case '(game_type = 0 | game_type = null)': return g => !g.game_type;
    case '(game_type != 0 & game_type != null)': return g => !!g.game_type;
    case '(total_rating >= 80 | rating >= 80)': return g => g.total_rating >= 80;
    default: return null;
  }
}

/** The catalogue rows a where clause selects, or the first clause it cannot read. */
function select(where: string): Game[] | { unknown: string } {
  const tests: ((g: Game) => boolean)[] = [];
  for (const c of topLevel(where)) {
    const p = predicate(c);
    if (!p) return { unknown: c };
    tests.push(p);
  }
  return CATALOGUE.filter(g => tests.every(t => t(g)));
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ORDER: Record<string, (a: Game, b: Game) => number> = {
  'total_rating_count desc': (a, b) => b.total_rating_count - a.total_rating_count || a.id - b.id,
  'first_release_date desc': (a, b) => (b.first_release_date ?? 0) - (a.first_release_date ?? 0) || a.id - b.id,
  'total_rating desc': (a, b) => b.total_rating - a.total_rating || a.id - b.id,
  'name asc': (a, b) => (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : a.id - b.id),
};

const num = (body: string, re: RegExp, fallback: number) => Number(re.exec(body)?.[1] ?? fallback);
const page = <T>(rows: T[], body: string) => {
  const offset = num(body, /offset (\d+);/, 0);
  return rows.slice(offset, offset + num(body, /limit (\d+);/, rows.length));
};
const idList = (s: string) => s.split(',').map(x => Number(x.trim())).filter(Number.isFinite);

/* ── Endpoint answers ────────────────────────────────────────────────────── */

type Answer = { status?: number; body: unknown };
const ok = (body: unknown): Answer => ({ body });
const unreadable = (what: string): Answer =>
  ({ status: 501, body: { message: `tests/igdb-stub.ts cannot read: ${what}` } });

function games(body: string): Answer {
  if (/^search "/.test(body)) {
    const q = (/^search "([^"]*)"/.exec(body)?.[1] || '').toLowerCase();
    return ok(CATALOGUE.filter(g => g.name.toLowerCase().includes(q)).slice(0, 15));
  }
  if (/first_release_date = null & hypes > 0/.test(body)) return ok(page(ANNOUNCED, body));
  if (/created_at desc/.test(body)) return ok(page(ANNOUNCED, body));
  if (/sort total_rating_count desc; where first_release_date >/.test(body)) {
    return ok(page([...CATALOGUE].sort(ORDER['total_rating_count desc']), body));
  }
  if (/total_rating_count > 5 & total_rating >= 70/.test(body)) {
    return ok(page(CATALOGUE.filter(g => g.total_rating >= 70).sort(ORDER['total_rating_count desc']), body));
  }
  /* The category grid, its platform list and its library overlay all carry a
     where clause the catalogue filter can answer. */
  if (/platforms\.abbreviation; where /.test(body) || /^fields platforms\.id/.test(body) || /^fields id, first_release_date; where/.test(body)) {
    const rows = select(/where ([^;]+);/.exec(body)![1]);
    if (!Array.isArray(rows)) return unreadable(rows.unknown);
    const sort = /sort ([^;]+);/.exec(body)?.[1];
    if (sort && !ORDER[sort]) return unreadable(`sort ${sort}`);
    return ok(page(sort ? [...rows].sort(ORDER[sort]) : rows, body));
  }
  const many = /where id = \(([^)]*)\)/.exec(body);
  if (many) {
    const want = idList(many[1]);
    return ok(ALL_GAMES.filter(g => want.includes(g.id)));
  }
  const one = /where id = (\d+);/.exec(body);
  if (one) return ok(ALL_GAMES.filter(g => g.id === Number(one[1])));
  return ok([]);
}

function count(body: string): Answer {
  const rows = select(/where ([^;]+);/.exec(body)?.[1] ?? '');
  return Array.isArray(rows) ? ok({ count: rows.length }) : unreadable(rows.unknown);
}

function multiquery(body: string): Answer {
  const out: { name: string; count: number }[] = [];
  for (const m of body.matchAll(/query games\/count "(\w+)" \{ where ([^;]+); \};/g)) {
    const rows = select(m[2]);
    if (!Array.isArray(rows)) return unreadable(rows.unknown);
    out.push({ name: m[1], count: rows.length });
  }
  return ok(out);
}

function taxonomy(list: Named[], body: string): Answer {
  const one = /where id = (\d+);/.exec(body);
  if (one) return ok(list.filter(t => t.id === Number(one[1])));
  return ok([...list].sort((a, b) => a.name.localeCompare(b.name)));
}

function franchises(body: string): Answer {
  const single = /where id = (\d+); limit 1;/.exec(body);
  if (single) {
    const f = byId(FRANCHISES, Number(single[1]));
    return ok(f ? [{ id: f.id, name: f.name, games: f.games.map(g => g.id) }] : []);
  }
  const other = /id != (\d+)/.exec(body);
  if (other) return ok(FRANCHISES.filter(f => f.id !== Number(other[1])).map(f => ({ id: f.id, name: f.name, games: f.games.map(slim) })));
  const named = /where name ~ \*"(.*?)"\*/.exec(body);
  const ids = /where id = \(([^)]*)\)/.exec(body);
  const rows = FRANCHISES
    .filter(f => !named || f.name.toLowerCase().includes(named[1].toLowerCase()))
    .filter(f => !ids || idList(ids[1]).includes(f.id));
  return ok(rows.map(f => ({ id: f.id, name: f.name, games: f.games.map(slim) })));
}

function collections(body: string): Answer {
  const named = /where name ~ \*"(.*?)"\*/.exec(body);
  const ids = /where id = \(([^)]*)\)/.exec(body);
  const rows = COLLECTIONS
    .filter(c => !named || c.name.toLowerCase().includes(named[1].toLowerCase()))
    .filter(c => !ids || idList(ids[1]).includes(c.id));
  /* No paging. The Collections Discover feed opens at a RANDOM offset
     (Collections.jsx:139), so honouring it answered an empty first page 299
     times in 300 and the feed showed no collection at all. Every page gets the
     same short list instead; it is shorter than the feed's page of 9, so the
     feed marks itself done after one call. phase4's stub does the same. */
  return ok(rows.map(c => ({ ...c, games: c.games.map(slim) })));
}

function memberships(body: string): Answer {
  const c = byId(COLLECTIONS, num(body, /where collection = (\d+)/, -1));
  return ok((c?.games || []).map(game => ({ game, type: { name: 'Main' } })));
}

function events(body: string): Answer {
  const one = /where id = (\d+);/.exec(body);
  if (one) {
    const e = [...eventRows('upcoming'), ...eventRows('past')].find(x => x.id === Number(one[1]));
    return ok(e ? [{ ...e, games: KNOWN.slice(0, 3) }] : []);
  }
  if (/where games = \(/.test(body) || /^fields games, start_time/.test(body)) return ok([]);
  if (num(body, /offset (\d+);/, 0) > 0) return ok([]);
  const q = (/name ~ \*"([^"]*)"\*/.exec(body)?.[1] || '').toLowerCase();
  return ok(eventRows(/start_time <= /.test(body) ? 'past' : 'upcoming').filter(e => e.name.toLowerCase().includes(q)));
}

function releaseDates(body: string): Answer {
  if (num(body, /offset (\d+);/, 0) > 0) return ok([]);
  const upcoming = /date > \d+/.test(body);
  return ok(CATALOGUE.slice(10, 22).map((g, i) => ({
    id: 990_000 + i,
    date: upcoming ? nowSec() + (i + 1) * 24 * HOUR : nowSec() - (i + 1) * 24 * HOUR,
    game: { id: g.id, name: g.name, cover: { image_id: g.cover.image_id }, game_type: g.game_type, total_rating: g.total_rating },
    platform: PLATFORMS[i % PLATFORMS.length],
  })));
}

function answer(path: string, body: string): Answer {
  switch (path) {
    case '/api/games': return games(body);
    case '/api/games/count': return count(body);
    case '/api/multiquery': return multiquery(body);
    case '/api/genres': return taxonomy(GENRES, body);
    case '/api/themes': return taxonomy(THEMES, body);
    case '/api/game_modes': return taxonomy(MODES, body);
    case '/api/companies': return taxonomy(COMPANIES, body);
    case '/api/game_engines': return taxonomy([ENGINE], body);
    case '/api/platforms': {
      const q = /name ~ \*"([^"]*)"\*/.exec(body)?.[1]?.toLowerCase();
      if (q !== undefined) return ok(PLATFORMS.filter(p => p.name.toLowerCase().includes(q) || p.abbreviation.toLowerCase().includes(q)));
      return taxonomy(PLATFORMS, body);
    }
    case '/api/franchises': return franchises(body);
    case '/api/collections': return collections(body);
    case '/api/collection_memberships': return memberships(body);
    case '/api/events': return events(body);
    case '/api/release_dates': return releaseDates(body);
    /* game_time_to_beats, collection_types, external_game_sources and the rest:
       an empty answer is a valid answer, and no spec asserts on them. */
    default: return ok([]);
  }
}

/* Firestore and Firebase, named host by host rather than all of googleapis.com,
   which would also catch a web font. playwright.config.ts resolves the same
   list to nothing for the chromium projects, which covers the specs that never
   call offlineIgdb. */
export const FIREBASE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  '*.firebaseio.com',
];
export const FIREBASE = new RegExp(FIREBASE_HOSTS.map(h => h.replace('*.', '').replace(/\./g, '\\.')).join('|'));

const PIXEL = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');

export async function offlineIgdb(p: Page) {
  // Never touch production Firestore from a spec.
  await p.route(FIREBASE, (r: Route) => r.abort());
  /* An empty SPARQL result, not an abort. awards.js retries an aborted query
     three times with backoff, which cost every game page three seconds. */
  await p.route('**/wdqs/**', (r: Route) => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  }));
  await p.route(/images\.igdb\.com|img\.youtube\.com/, (r: Route) =>
    r.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL }));
  await p.route('**/api/**', (r: Route) => {
    const req = r.request();
    const { status = 200, body } = answer(new URL(req.url()).pathname, req.postData() || '');
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
