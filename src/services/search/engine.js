/* The search engine: match, rank, complete and correct, over a small in-memory
 * set of documents. Pure -- no storage, no network -- so the tests drive it with
 * plain arrays and the overlay feeds it the shipped index, your library and the
 * games you have looked at.
 *
 * Why not IGDB alone. IGDB's `search` returns nothing for one wrong letter
 * ("wicher 3", "elden rng"), nothing for a word you have not finished typing
 * ("hollow kn"), and ranks editions above games ("gta 5" -> Special Edition
 * first). This engine does the three things IGDB will not -- tolerate typos,
 * complete prefixes, rank by popularity -- for the titles people search for,
 * and corrects the query it hands IGDB for everything else.
 *
 * A document: { id, kind: 'game'|'franchise'|'company', name, aliases?, year?,
 *               cover?, pop?, edition?, mine? }
 *   pop      popularity (IGDB rating count, or follows for unreleased games)
 *   edition  an edition, bundle or port: kept, but ranked under the game
 *   mine     in your library: ranked first among comparable matches */
import { normalize, tokens, isWord, editDistance } from './normalize.js';

/* Words that do not count against a match when the query leaves them out:
   "witcher 3" should match "The Witcher 3" as well as "the witcher 3" does. */
const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'to', 'in', 'on']);

/** Prepare documents once: normalised token lists for the name and each alias. */
export function prepare(docs) {
  return docs.map(d => {
    const names = [d.name, ...(d.aliases || [])].filter(Boolean).map(n => {
      const toks = tokens(n);
      return { toks, flat: toks.join(' '), compact: toks.join('') };
    });
    return { ...d, _names: names };
  });
}

/* How well one query token matches one name token.
   1 exact, 0.9 prefix of the word you are still typing, 0.75 prefix of an
   earlier word, then typo tolerance scaled to length: one slip from four
   letters, two from eight. */
function tokenScore(q, t, isLast) {
  if (q === t) return 1;
  if (t.startsWith(q) && q.length >= (isLast ? 1 : 3)) return isLast ? 0.9 : 0.75;
  if (q.length >= 4 && isWord(q)) {
    const max = q.length >= 8 ? 2 : 1;
    const d = editDistance(q, t, max);
    if (d <= max) return d === 1 ? 0.65 : 0.45;
    /* A typo inside the word still being typed: "witche" for "witcher". */
    if (isLast && t.length > q.length && editDistance(q, t.slice(0, q.length), 1) <= 1) return 0.55;
  }
  return 0;
}

/* Score a document's name (or alias) against the query tokens, 0..1. */
function nameScore(qToks, qCompact, name) {
  const { toks, compact } = name;
  let sum = 0, matched = 0;
  const used = new Set();
  for (let i = 0; i < qToks.length; i++) {
    const q = qToks[i];
    let best = 0, at = -1;
    for (let j = 0; j < toks.length; j++) {
      if (used.has(j)) continue;
      const s = tokenScore(q, toks[j], i === qToks.length - 1);
      if (s > best) { best = s; at = j; }
    }
    if (best === 0) {
      if (STOP.has(q)) continue;          // a stray "the" does not sink a match
      return compactScore(qCompact, compact);
    }
    used.add(at);
    sum += best;
    matched++;
  }
  if (matched === 0) return 0;
  const avg = sum / matched;
  /* Coverage: how much of the title the query accounts for, ignoring filler.
     "witcher 3" covers The Witcher 3 better than The Witcher 3: Blood and Wine. */
  const meaningful = toks.filter(t => !STOP.has(t)).length || toks.length;
  const coverage = Math.min(1, matched / meaningful);
  let s = avg * (0.75 + 0.25 * coverage);
  /* In order from the start of the title is how people type a name. */
  if (used.has(0) || (STOP.has(toks[0]) && used.has(1))) s += 0.05;
  if (qToks.join(' ') === toks.join(' ')) s += 0.1;
  /* Capped at 1: an alias that happens to equal the query (Red Dead
     Revolver is also filed as "Red Dead") must not outrank a game forty
     times as popular on the strength of a bonus. */
  return Math.min(1, Math.max(s, compactScore(qCompact, compact)));
}

/* Spacing and hyphenation people do not agree on: "spiderman" against
   "spider man", "pokemongo" against "pokemon go". Compared with every space
   removed, from the start of the title or of a word. */
function compactScore(qCompact, compact) {
  if (qCompact.length < 4) return 0;
  if (compact === qCompact) return 0.95;
  if (compact.startsWith(qCompact)) return 0.85;
  if (compact.includes(qCompact)) return 0.7;
  return 0;
}

const popBoost = (pop) => Math.log10(1 + (Number(pop) || 0)) / 3;   // 0 .. ~1.3 for 10k ratings

/**
 * → [{ doc, score, text }] best first. `text` is the match quality alone,
 * `score` adds popularity, your library and the edition penalty.
 */
export function search(prepared, query, { limit = 20, kinds = null, minText = 0.5 } = {}) {
  const qToks = tokens(query);
  if (qToks.length === 0) return [];
  const qCompact = qToks.join('');
  const out = [];
  for (const d of prepared) {
    if (kinds && !kinds.includes(d.kind)) continue;
    let text = 0;
    for (const n of d._names) text = Math.max(text, nameScore(qToks, qCompact, n));
    if (text < minText) continue;
    /* Your library outweighs a large popularity gap: type a name you own and
       you most likely mean yours. Popularity tops out near 1.3, so 1 lets a
       library game beat a famous namesake while a much better text match
       (text counts double) still wins. */
    const score = text * 2 + popBoost(d.pop) + (d.mine ? 1 : 0) - (d.edition ? 0.4 : 0);
    out.push({ doc: d, score, text });
  }
  out.sort((a, b) => b.score - a.score);
  /* One entry per kind+id: the index, your library and IGDB can all hold the
     same game. The first, best-ranked copy wins. */
  const seen = new Set();
  return out.filter(r => {
    const k = `${r.doc.kind}:${r.doc.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, limit);
}

/**
 * The rest of the top match's name, for ghost text in the input, or ''.
 * Only when what you typed is literally the start of the name, so accepting
 * it never rewrites a letter you chose; and only for a confident match.
 */
export function completion(query, top) {
  if (!top || top.text < 0.85 || !query) return '';
  const name = top.doc.name;
  if (!name.toLowerCase().startsWith(query.toLowerCase())) return '';
  return name.slice(query.length);
}

/**
 * Spelling correction against the index vocabulary.
 * → the corrected query, or null when every word is already known.
 *
 * `dict` is { set: Set<word>, byLength: Map<len, word[]> } from makeDictionary,
 * words most common first. A word still being typed is left alone when any
 * known word starts with it. Numbers and short words are never corrected:
 * "re 4" is not a typo of anything.
 */
export function correct(query, dict) {
  const toks = tokens(query);
  if (toks.length === 0) return null;
  let changed = false;
  const fixed = toks.map((t, i) => {
    if (!isWord(t) || dict.set.has(t)) return t;
    if (i === toks.length - 1 && dict.prefixOf(t)) return t;
    const max = t.length >= 8 ? 2 : 1;
    let best = null, bestD = max + 1;
    /* Lengths nearest the typo first, and within a length the most common word
       first, so "wicher" becomes "witcher" and not a rarer word one edit away. */
    const lengths = [0, -1, 1, -2, 2].filter(o => Math.abs(o) <= max).map(o => t.length + o);
    for (const len of lengths) {
      for (const w of dict.byLength.get(len) || []) {
        const d = editDistance(t, w, max);
        if (d < bestD) { bestD = d; best = w; if (d === 1) break; }
      }
      if (bestD === 1) break;
    }
    if (best) { changed = true; return best; }
    return t;
  });
  return changed ? fixed.join(' ') : null;
}

/** Build the dictionary structure from a frequency-ordered word list. */
export function makeDictionary(words) {
  const set = new Set(words);
  const byLength = new Map();
  for (const w of words) {
    if (!byLength.has(w.length)) byLength.set(w.length, []);
    byLength.get(w.length).push(w);
  }
  const sorted = [...set].sort();
  const prefixOf = (p) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < p) lo = mid + 1; else hi = mid; }
    return lo < sorted.length && sorted[lo].startsWith(p);
  };
  return { set, byLength, prefixOf };
}

export { normalize };

/* Words within reach of `t`, most common first: the candidates a correction
   chooses between. Known words are included, because a typo can land on a
   real word ("ded" for "dead"). */
function nearWords(t, dict, max, limit = 8) {
  const out = [];
  const lengths = [0, -1, 1, -2, 2].filter(o => Math.abs(o) <= max).map(o => t.length + o);
  for (const len of lengths) {
    for (const w of dict.byLength.get(len) || []) {
      if (w !== t && editDistance(t, w, max) <= max) out.push(w);
      if (out.length >= limit * 3) break;
    }
  }
  return out.slice(0, limit * 3);
}

/**
 * "Did you mean", chosen by what it finds rather than by spelling alone.
 * → { query, results } for a better query, or null when the original already
 * matches well.
 *
 * Spelling alone picked "elden rpg" for "elden rng" -- "rpg" is the commoner
 * word one edit away -- and could not see that "ded" in "red ded" is a typo,
 * because "ded" is a word. So each word is swapped, one at a time, for the
 * dictionary words within reach of it, and the swap kept is the one whose
 * search matches best. Elden + ring is a title; elden + rpg is not. A second
 * pass catches two typos ("eldn rng").
 */
export function suggest(prepared, query, dict, { good = 0.75 } = {}) {
  const topText = (q) => search(prepared, q, { limit: 1, minText: 0.4 })[0]?.text || 0;
  let current = tokens(query);
  if (current.length === 0) return null;
  const start = topText(current.join(' '));
  if (start >= good) return null;
  let best = start;
  for (let pass = 0; pass < 2; pass++) {
    let improved = null;
    current.forEach((t, i) => {
      if (!isWord(t)) return;
      const max = t.length >= 8 ? 2 : 1;
      for (const w of nearWords(t, dict, max)) {
        /* Never a word the query already has: "red red" scores well against
           Red Dead Redemption (red, then a prefix of redemption) and is not
           what anyone meant by "red ded". */
        if (current.includes(w)) continue;
        const trial = current.map((x, j) => (j === i ? w : x));
        const s = topText(trial.join(' '));
        if (s > best + 0.05) { best = s; improved = trial; }
      }
    });
    if (!improved) break;
    current = improved;
    if (best >= good) break;
  }
  if (best < good || best <= start) return null;
  const q = current.join(' ');
  return { query: q, results: search(prepared, q) };
}
