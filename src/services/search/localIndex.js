/* The on-device half of search: the shipped index, turned into engine
 * documents and a spelling dictionary.
 *
 * searchIndex.json is imported dynamically, so it is its own chunk: nothing
 * downloads it until search opens, and the browser caches it like any other
 * asset after that. buildLocal is pure and takes the parsed index, so the tests
 * run it on the real file without a bundler. */
import { prepare, makeDictionary } from './engine.js';
import { tokens, isWord } from './normalize.js';

export function buildLocal(ix) {
  const games = ix.g.map(([id, name, year, cover, pop, aliases]) => ({
    kind: 'game', id, name, year: year || null, cover: cover || null, pop: 10 ** ((pop || 0) / 20) - 1, aliases: aliases || [],
  }));
  const franchises = ix.f.map(([id, name, n]) => ({ kind: 'franchise', id, name, pop: n * 5 }));
  const companies = ix.c.map(([id, name, n]) => ({ kind: 'company', id, name, pop: n * 5 }));
  /* The shipped word list leaves out every word already in a title; those
     come back from the titles here, most-rated titles first. */
  const fromTitles = [];
  const seen = new Set();
  for (const d of [...games, ...franchises, ...companies]) {
    for (const n of [d.name, ...(d.aliases || [])]) {
      for (const t of tokens(n)) if (isWord(t) && !seen.has(t)) { seen.add(t); fromTitles.push(t); }
    }
  }
  const words = [...fromTitles, ...String(ix.w || '').split(' ').filter(w => w && !seen.has(w))];
  return {
    docs: prepare([...games, ...franchises, ...companies]),
    dict: makeDictionary(words),
    built: ix.built,
  };
}

let loading = null;
/** The local index, loaded once per session. */
export function loadLocal() {
  if (!loading) {
    loading = import('./searchIndex.json')
      .then(m => buildLocal(m.default || m))
      .catch(err => { loading = null; throw err; });
  }
  return loading;
}

/* Games on this device that the shipped index may not hold: your library, and
   every game you have opened from search. They join the search as documents of
   their own, flagged `mine` for the library, so what you have looked at is
   instant and typo-tolerant whatever the index holds. */
export function deviceDocs(library = [], recent = []) {
  const docs = [];
  for (const g of library) {
    if (!g?.name) continue;
    docs.push({ kind: 'game', id: g.id, name: g.name, year: g.release_year || null, cover: g.cover_id || null, mine: true, status: g.status || null });
  }
  for (const g of recent) {
    if (!g?.name) continue;
    docs.push({ kind: 'game', id: g.id, name: g.name, year: g.release_year || null, cover: g.cover_id || null, recent: true });
  }
  return prepare(docs);
}
