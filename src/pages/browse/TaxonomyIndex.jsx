/* ── DIRECTION CONTRACT ──────────────────────────────────────────────────────
   THESIS: an index of names is a list of links; an index of names with real
   sizes is a map of the catalogue. This page refuses the chip-cloud every
   browse screen ships and lays the taxonomy out as a ruled register, largest
   first, so the shape of the archive is readable before you open anything.
   OWN-WORLD: DESIGN.md unchanged — #000000 ground, white type, hairline
   white/15 rules, rounded-none, no shadow, inversion as the only elevation,
   .lh-display for the names, .lh-label 11px/0.18em for everything else.
   STORY: you came in through the sidebar with no particular goal, you read down
   a ruled list seeing which corners of the archive are vast and which are
   nearly empty, and you open one.
   FIRST VIEWPORT: the kicker, the taxonomy's name and its term count, then the
   register itself — no controls, because 23 rows need none.
   FORM: ruled register ordered by size. One page per taxonomy, reached from the
   sidebar's Browse submenu.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the
   finish review, the verdict, and DESIGN.md.

   Counts are counted, never estimated: getTaxonomyCounts batches them through
   IGDB's multiquery endpoint and caches for a week. A term whose count did not
   come back renders without a number rather than with a zero it did not earn.
   ────────────────────────────────────────────────────────────────────────── */

import { useState, useEffect, useMemo } from 'react';
import { Link, useParams, Navigate } from 'react-router-dom';
import { getGenres, getThemes, getGameModes, getTaxonomyCounts } from '../../services/igdb';
import { Skeleton } from '../../components/ui/Skeleton';
import useAnnounce from '../../components/ui/useAnnounce';
import PageHeader from '../../components/ui/PageHeader';

/* The three taxonomies IGDB holds in readable numbers. Companies and engines
   run to tens of thousands with no useful index, so they stay where they are:
   on the game that made you curious about them. */
const TAXONOMIES = {
  genres: { type: 'genre', title: 'Genres', blurb: 'What kind of game it is.', load: getGenres },
  themes: { type: 'theme', title: 'Themes', blurb: 'The mood and setting it plays in.', load: getThemes },
  modes: { type: 'mode', title: 'Modes', blurb: 'How many people play, and how.', load: getGameModes },
};

export default function TaxonomyIndex() {
  const { taxonomy } = useParams();
  const spec = TAXONOMIES[taxonomy];

  const [terms, setTerms] = useState(null);
  const [counts, setCounts] = useState({});
  const [countsIn, setCountsIn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!spec) return;
    let alive = true;
    setTerms(null); setCounts({}); setCountsIn(false); setFailed(false);
    spec.load()
      .then(list => { if (alive) setTerms(Array.isArray(list) ? list : []); })
      .catch(err => { console.error('Error loading taxonomy:', err); if (alive) { setTerms([]); setFailed(true); } });
    return () => { alive = false; };
  }, [spec, taxonomy]);

  /* Counts arrive after the names, and the list renders without waiting for
     them. The names are the navigation; the sizes are commentary on it, and
     holding 23 links back for commentary would be the wrong trade. */
  useEffect(() => {
    if (!spec || !terms?.length) return;
    let alive = true;
    getTaxonomyCounts({ type: spec.type, ids: terms.map(t => t.id) })
      .then(c => { if (alive) { setCounts(c || {}); setCountsIn(true); } })
      .catch(err => { console.error('Error counting taxonomy:', err); if (alive) setCountsIn(true); });
    return () => { alive = false; };
  }, [spec, terms]);

  /* Largest first once the sizes are in. Alphabetical is the better order for
     finding a name you already know, but nobody arrives here with one — the
     sidebar submenu is where you go when you have no particular goal, and size
     order is the only order that says anything about the archive. */
  const rows = useMemo(() => {
    if (!terms) return [];
    const withCounts = terms.map(t => ({ ...t, count: counts[t.id] ?? null }));
    if (!countsIn) return withCounts;
    return withCounts.sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  }, [terms, counts, countsIn]);

  const peak = useMemo(
    () => Math.max(...rows.map(r => (typeof r.count === 'number' ? r.count : 0)), 1),
    [rows],
  );

  useAnnounce(!terms ? 'Loading' : `${rows.length} ${spec?.title?.toLowerCase() || 'terms'}`);

  if (!spec) return <Navigate to="/browse/genres" replace />;

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        <PageHeader
          className="mb-6"
          titleClassName="text-[28px] lg:text-[36px]"
          title={spec.title}
          count={terms ? `${rows.length} ${rows.length === 1 ? 'Term' : 'Terms'}` : null}
          meta={spec.blurb}
        />

        {!terms ? (
          <div className="border-t border-white/15">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="border-b border-white/10 py-4" aria-hidden="true">
                <Skeleton className="h-5" style={{ width: `${30 + ((i * 23) % 45)}%` }} />
              </div>
            ))}
          </div>
        ) : failed || rows.length === 0 ? (
          <div className="border border-white/15 text-center px-6 py-16">
            <div className="lh-display text-xl text-white mb-2">
              {failed ? 'The Index Did Not Answer' : 'Nothing Catalogued'}
            </div>
            <p className="lh-label text-white/60">
              {failed
                ? 'This list could not be loaded from IGDB. Your library is untouched.'
                : 'IGDB holds no terms for this taxonomy.'}
            </p>
          </div>
        ) : (
          /* A ruled register, not a cloud of chips. Names run at display size
             because they are the content; the count sits right-aligned in the
             label voice, and a hairline under each row does the separating that
             a card would otherwise be invented for. */
          <div className="border-t border-white/15">
            {rows.map(term => {
              const known = typeof term.count === 'number';
              const share = known ? Math.max(1, Math.round((term.count / peak) * 100)) : 0;
              return (
                <Link
                  key={term.id}
                  to={`/games/${spec.type}/${term.id}`}
                  className="group relative flex items-baseline gap-4 border-b border-white/10 px-1 py-4 hover:bg-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
                >
                  {/* The size, drawn as a hairline under the row. It is the same
                      fact as the number beside it, read at a glance instead of
                      one row at a time — and it disappears rather than lies when
                      a count did not come back. */}
                  {known && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 h-px bg-white/30 group-hover:bg-black/30 transition-colors"
                      style={{ width: `${share}%` }}
                    />
                  )}
                  <span className="lh-display text-lg lg:text-xl text-white group-hover:text-black transition-colors min-w-0 flex-1">
                    {term.name}
                  </span>
                  <span className="lh-label text-white/60 group-hover:text-black tabular-nums shrink-0 transition-colors">
                    {known ? term.count.toLocaleString() : ''}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
