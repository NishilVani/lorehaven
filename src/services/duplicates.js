// Find Duplicates -- which library entries are the same game, or versions of
// it, and what merging them writes.
//
// Pure, with one pure import, so tests/duplicates.test.mjs runs it in node.
// The page fetches IGDB relations and hands them in as a Map keyed by id.
//
// The same IGDB id can never be in the library twice: saveManyToLibrary merges
// by String(id). Real duplicates are different ids for one game, and they come
// from four places -- editions, bundles, a hand-added custom entry beside its
// IGDB twin, and names that only differ by "Game of the Year Edition". Remakes
// and remasters are reported apart, because owning both is often deliberate.

import { normalizeStatus } from '../constants/stateColors.js';

/* ── Names ────────────────────────────────────────────────────────────────── */

/* Longest first, so "game of the year edition" is removed whole rather than
   leaving "edition" behind after "game of the year" matches. Remaster and
   remake words are deliberately absent: those are related versions, and IGDB
   says so directly. */
const EDITION_PHRASES = [
  'game of the year edition', 'game of the year', 'goty edition', 'goty',
  'complete edition', 'definitive edition', 'deluxe edition', 'ultimate edition',
  'gold edition', 'enhanced edition', 'special edition', 'collectors edition',
  'anniversary edition', 'premium edition', 'standard edition', 'legendary edition',
  'directors cut',
].sort((a, b) => b.length - a.length);

const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const STOPWORDS = new Set(['the', 'a', 'an']);

export const normalizeName = (name) => {
  let s = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  s = s.replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ');
  for (const phrase of EDITION_PHRASES) s = s.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' ');
  return s.split(' ').filter(Boolean).map(w => ROMAN[w] || w).filter(w => !STOPWORDS.has(w)).join(' ');
};

/* ── Detection ────────────────────────────────────────────────────────────── */

export const isCustom = (g) => !!g?.is_custom || String(g?.id).startsWith('custom_');

/* IGDB game_type values that are never a duplicate of anything: DLC, expansion,
   standalone expansion, mod, episode, season, pack, update. A DLC can share its
   base game's name word for word, and removing the base game would be a loss. */
const NEVER_DUPLICATE_TYPES = new Set([1, 2, 4, 5, 6, 7, 13, 14]);

/* Strongest evidence first; a pair keeps the strongest reason it has. */
const REASON_RANK = ['edition', 'expanded', 'bundle', 'remake', 'remaster', 'custom', 'name'];
const RELATED = new Set(['remake', 'remaster']);

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const unionFind = () => {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(x, r);
    return r;
  };
  return { find, union: (a, b) => parent.set(find(a), find(b)) };
};

const listed = (entry, id) => Array.isArray(entry?.notDuplicateOf) && entry.notDuplicateOf.map(String).includes(String(id));

/**
 * → { same, related, dismissed }, each a list of { key, reason, members }.
 *
 * A bundle pairs with each game it contains separately instead of joining them
 * into one group: merging keeps exactly one entry, and a group of a bundle plus
 * three of its games would remove two games the user owns on their own.
 */
export const findDuplicateGroups = (library, relations = new Map()) => {
  const entries = (library || []).filter(g => g && g.id != null);
  const byId = new Map(entries.map(g => [String(g.id), g]));
  const order = new Map(entries.map((g, i) => [String(g.id), i]));
  const rel = (id) => relations.get(String(id));

  const edges = new Map();
  const addEdge = (a, b, reason) => {
    a = String(a); b = String(b);
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const k = pairKey(a, b);
    const had = edges.get(k);
    if (!had || REASON_RANK.indexOf(reason) < REASON_RANK.indexOf(had.reason)) edges.set(k, { a, b, reason });
  };

  for (const g of entries) {
    const r = rel(g.id);
    if (!r) continue;
    if (r.version_parent != null) addEdge(g.id, r.version_parent, 'edition');
    (r.expanded_games || []).forEach(x => addEdge(g.id, x, 'expanded'));
    (r.bundles || []).forEach(x => addEdge(g.id, x, 'bundle'));
    (r.remakes || []).forEach(x => addEdge(g.id, x, 'remake'));
    (r.remasters || []).forEach(x => addEdge(g.id, x, 'remaster'));
  }

  /* Names last, and addEdge keeps a pair's strongest reason, so a name match
     never overrides what IGDB said. Resident Evil 2 and its remake share a name
     exactly, and IGDB's "remake" is the truer statement. */
  const byName = new Map();
  for (const g of entries) {
    if (NEVER_DUPLICATE_TYPES.has(rel(g.id)?.game_type)) continue;
    const n = normalizeName(g.name || rel(g.id)?.name);
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(g);
  }
  for (const bucket of byName.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        addEdge(bucket[i].id, bucket[j].id, isCustom(bucket[i]) !== isCustom(bucket[j]) ? 'custom' : 'name');
      }
    }
  }

  const live = [], dismissedEdges = [];
  for (const e of edges.values()) {
    (listed(byId.get(e.a), e.b) || listed(byId.get(e.b), e.a) ? dismissedEdges : live).push(e);
  }

  const toGroup = (ids, groupEdges) => {
    const members = [...ids].sort((x, y) => order.get(x) - order.get(y)).map(id => byId.get(id));
    const reason = groupEdges.map(e => e.reason).sort((x, y) => REASON_RANK.indexOf(x) - REASON_RANK.indexOf(y))[0];
    return { key: [...ids].sort().join('|'), reason, members };
  };
  const components = (list, uf) => {
    list.forEach(e => uf.union(e.a, e.b));
    const byRoot = new Map();
    for (const e of list) {
      const root = uf.find(e.a);
      if (!byRoot.has(root)) byRoot.set(root, { ids: new Set(), edges: [] });
      const c = byRoot.get(root);
      c.ids.add(e.a); c.ids.add(e.b); c.edges.push(e);
    }
    return [...byRoot.values()].map(c => toGroup(c.ids, c.edges));
  };

  const sameUf = unionFind();
  const same = components(live.filter(e => !RELATED.has(e.reason) && e.reason !== 'bundle'), sameUf);
  for (const e of live.filter(x => x.reason === 'bundle')) {
    if (sameUf.find(e.a) !== sameUf.find(e.b)) same.push(toGroup(new Set([e.a, e.b]), [e]));
  }
  const related = components(live.filter(e => RELATED.has(e.reason) && sameUf.find(e.a) !== sameUf.find(e.b)), unionFind());
  const dismissed = components(dismissedEdges, unionFind());

  const byFirstName = (x, y) => normalizeName(x.members[0].name).localeCompare(normalizeName(y.members[0].name)) || x.key.localeCompare(y.key);
  return { same: same.sort(byFirstName), related: related.sort(byFirstName), dismissed: dismissed.sort(byFirstName) };
};

const TYPE_LABEL = { 3: 'Bundle', 8: 'Remake', 9: 'Remaster', 10: 'Expanded', 11: 'Port' };

/** What a column calls its game, or null for a plain main game. */
export const versionLabel = (entry, relation) => {
  if (isCustom(entry)) return 'Custom entry';
  if (relation?.version_parent != null) return 'Edition';
  return TYPE_LABEL[relation?.game_type] || null;
};

/* ── Keep ─────────────────────────────────────────────────────────────────── */

const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);

const recordedCount = (g) =>
  ['status', 'feel', 'priority', 'dateCompleted', 'user_time_to_beat', 'user_platforms', 'user_stores']
    .filter(k => filled(g[k])).length
  + (String(g.notes || '').trim() ? 1 : 0);

/**
 * The entry kept by default: the one with more of the user's data on it, and
 * on a tie the original -- an IGDB entry over a custom one, the game an edition
 * names as its parent, a game over the bundle containing it, then the earlier
 * release. The user can move the choice; this only decides where it starts.
 */
export const defaultKeep = (members, relations = new Map()) => {
  const rel = (g) => relations.get(String(g.id)) || {};
  const originalOf = (a, b) => {
    const ra = rel(a), rb = rel(b);
    if (String(rb.version_parent) === String(a.id)) return -1;
    if (String(ra.version_parent) === String(b.id)) return 1;
    if ((ra.remakes || []).concat(ra.remasters || []).map(String).includes(String(b.id))) return -1;
    if ((rb.remakes || []).concat(rb.remasters || []).map(String).includes(String(a.id))) return 1;
    if (rb.game_type === 3 && ra.game_type !== 3) return -1;
    if (ra.game_type === 3 && rb.game_type !== 3) return 1;
    return 0;
  };
  const released = (g) => Number(rel(g).first_release_date ?? g.first_release_date) || Infinity;
  const ranked = members.slice().sort((a, b) =>
    (recordedCount(b) - recordedCount(a))
    || (Number(isCustom(a)) - Number(isCustom(b)))
    || originalOf(a, b)
    || (released(a) - released(b)));
  return ranked[0]?.id;
};

/* ── Merge ────────────────────────────────────────────────────────────────── */

/* Values the user picks between when entries disagree. Notes are not here:
   both are writing, and losing either is a loss, so they are joined. */
const CHOSEN_FIELDS = ['status', 'feel', 'priority', 'dateCompleted', 'user_time_to_beat'];

const sameValue = (field, v) => (field === 'status' ? (normalizeStatus(v) || v) : JSON.stringify(v));
const byIdIn = (members, id) => members.find(m => String(m.id) === String(id));

export const mergeConflicts = (members, keepId, choices = {}) => {
  const keep = byIdIn(members, keepId);
  const out = [];
  for (const field of CHOSEN_FIELDS) {
    const options = members.filter(m => filled(m[field])).map(m => ({ id: m.id, value: m[field] }));
    if (new Set(options.map(o => sameValue(field, o.value))).size < 2) continue;
    const chosen = byIdIn(options, choices[field])?.id ?? (filled(keep?.[field]) ? keep.id : options[0].id);
    out.push({ field, options, chosen });
  }
  return out;
};

const listKey = (x) => (x && typeof x === 'object')
  ? (x.id != null ? `id:${x.id}` : `name:${String(x.name || '').toLowerCase()}`)
  : `name:${String(x).toLowerCase()}`;

const unionLists = (lists) => {
  const map = new Map();
  lists.flat().forEach(x => { if (x != null && !map.has(listKey(x))) map.set(listKey(x), x); });
  return [...map.values()];
};

/**
 * → { patch, removeIds }. `patch` is written to the kept entry through
 * saveManyToLibrary (which merges), then every id in `removeIds` is removed.
 *
 * Platforms and stores union, so owning a game on PC through one entry and on
 * PlayStation through the other ends as one game owned on both. The earliest
 * addedAt survives, because the game has been in the library since then.
 */
export const planMerge = (members, keepId, choices = {}) => {
  const keep = byIdIn(members, keepId);
  const others = members.filter(m => m !== keep);
  const patch = { id: keep.id };

  for (const field of CHOSEN_FIELDS) {
    const holders = members.filter(m => filled(m[field]));
    if (holders.length === 0) continue;
    const source = byIdIn(holders, choices[field]) || (filled(keep[field]) ? keep : holders[0]);
    patch[field] = source[field];
  }

  const notes = [];
  for (const m of [keep, ...others]) {
    const n = String(m.notes || '').trim();
    if (n && !notes.includes(n)) notes.push(n);
  }
  if (notes.length) patch.notes = notes.join('\n\n');

  for (const field of ['user_platforms', 'user_stores']) {
    if (members.some(m => filled(m[field]))) patch[field] = unionLists([keep, ...others].map(m => m[field] || []));
  }

  const added = members.map(m => Number(m.addedAt)).filter(Number.isFinite);
  if (added.length) patch.addedAt = Math.min(...added);

  return { patch, removeIds: others.map(m => m.id) };
};

/**
 * What Undo writes: the kept entry's prior value for every key the merge wrote,
 * null where it had none (saveManyToLibrary merges, so only null clears), and
 * each removed entry whole. Re-saving a removed entry stamps it after its own
 * tombstone, so the cross-device merge keeps it -- tests/db-write-path.test.mjs
 * asserts exactly that.
 */
export const mergeUndo = (members, keepId, patch) => {
  const keep = byIdIn(members, keepId);
  const keepRestore = { id: keep.id };
  for (const k of Object.keys(patch)) {
    if (k === 'id') continue;
    keepRestore[k] = Object.prototype.hasOwnProperty.call(keep, k) ? keep[k] : null;
  }
  return { keepRestore, reAdd: members.filter(m => m !== keep) };
};

/* ── Not duplicates ───────────────────────────────────────────────────────── */

/* Written on every member, so a device that only syncs one of the entries still
   hides the group. */
export const dismissPatch = (members) => members.map(m => ({
  id: m.id,
  notDuplicateOf: [...new Set([...(m.notDuplicateOf || []).map(String), ...members.filter(o => o !== m).map(o => String(o.id))])],
}));

export const restorePatch = (members) => members.map(m => {
  const others = new Set(members.filter(o => o !== m).map(o => String(o.id)));
  return { id: m.id, notDuplicateOf: (m.notDuplicateOf || []).map(String).filter(id => !others.has(id)) };
});
