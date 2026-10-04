/* One normaliser for both sides of search: the build script that writes the
 * index and the engine that queries it. If they disagreed by a single rule the
 * index would hold tokens no query could produce.
 *
 *   "Marvel's Spider-Man"  -> "marvels spider man"
 *   "PERSONA5"             -> "persona 5"
 *   "Grand Theft Auto V"   -> "grand theft auto 5"
 *   "Pokémon Sword & Shield" -> "pokemon sword and shield"
 *
 * Pure, no imports: Node runs it in the build and in the tests. */

/* Roman numerals as they appear in titles. Both sides convert, so "gta v" and
   "gta 5" meet at "gta 5", and "Mega Man X" still matches "mega man x" because
   the query converts the same way. */
const ROMAN = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
};

export function normalize(input) {
  const s = String(input ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')                          // marvel's -> marvels
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')                    // persona5 -> persona 5
    .replace(/(\d)([a-z])/g, '$1 $2')
    .trim();
  if (!s) return '';
  return s.split(/\s+/).map(t => ROMAN[t] || t).join(' ');
}

export const tokens = (input) => {
  const n = normalize(input);
  return n ? n.split(' ') : [];
};

/** The words worth checking for spelling: alphabetic and three letters or more. */
export const isWord = (t) => /^[a-z]{3,}$/.test(t);

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent
    transpositions), abandoning as soon as it must exceed `max`. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}
