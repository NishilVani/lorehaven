import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameAwards } from '../../hooks/useGameAwards';

/**
 * Awards section for the GameDetail page — a standalone bordered table.
 * One row per ceremony-year (aligned label/value grid, matching the Index
 * section): the year + ceremony on top, then the categories won and (muted)
 * the categories only nominated. The ceremony deep-links to that year on the
 * award page; each category deep-links to that exact year + category.
 */

/** /awards/:qid?year=&cat= — deep-link to a ceremony year (and optional category). */
const ceremonyHref = (r) => `/awards/${r.qid}${r.year ? `?year=${r.year}` : ''}`;
const categoryHref = (r, c) =>
  `/awards/${r.qid}?${new URLSearchParams({ ...(r.year ? { year: r.year } : {}), ...(c.qid ? { cat: c.qid } : {}) })}`;

/** Render a `·`-separated list of category links, sized to their text. */
function CategoryList({ row, cats, tone }) {
  return (
    <span className={`text-sm leading-relaxed ${tone}`}>
      {cats.map((c, j) => (
        <span key={c.qid || c.label || j}>
          {j > 0 && <span className="text-white/50"> · </span>}
          {c.qid ? (
            /* p-1 -m-1 lifts an 18px line box to a 26px hit box (WCAG 2.5.8)
               without moving the text: padding grows an inline box and the hover
               fill, and the negative margin cancels the layout effect. Same
               treatment as the Index links on GameDetail. */
            <Link
              to={categoryHref(row, c)}
              className="p-1 -m-1 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors"
            >
              {c.label}
            </Link>
          ) : c.label}
        </span>
      ))}
    </span>
  );
}

export default function AwardsSection({ gameId }) {
  const { awards, loading } = useGameAwards(gameId);
  const [showAll, setShowAll] = useState(false);

  // Group by ceremony + year so each row carries one prominent year.
  const rows = useMemo(() => {
    const m = new Map();
    for (const a of awards) {
      const qid = a.ceremonyQid || a.categoryQid;
      const key = `${qid}:${a.year || 0}`;
      if (!m.has(key)) m.set(key, { key, qid, year: a.year || 0, ceremony: a.displayCeremony, wins: [], noms: [] });
      const g = m.get(key);
      if (a.category) (a.kind === 'nomination' ? g.noms : g.wins).push({ label: a.category, qid: a.categoryQid });
    }
    // Newest first; within a year, ceremonies with more wins lead.
    return [...m.values()].sort(
      (x, y) => y.year - x.year || y.wins.length - x.wins.length || x.ceremony.localeCompare(y.ceremony)
    );
  }, [awards]);

  /* Collapsed, the table keeps the ceremonies the game did best at, still in
     year order. A heavily awarded game ran to twenty-odd rows, which on a phone
     was longer than the rest of the page put together — and newest-first put a
     2020 audience award above Game of the Year. */
  const PREVIEW = 5;
  const preview = useMemo(() => {
    if (rows.length <= PREVIEW + 1) return rows;
    const keep = new Set([...rows]
      .sort((x, y) => y.wins.length - x.wins.length || y.noms.length - x.noms.length || y.year - x.year)
      .slice(0, PREVIEW).map(r => r.key));
    return rows.filter(r => keep.has(r.key));
  }, [rows]);

  if (loading || rows.length === 0) return null;
  const shown = showAll ? rows : preview;

  const totalWins = rows.reduce((n, r) => n + r.wins.length, 0);
  const totalNoms = rows.reduce((n, r) => n + r.noms.length, 0);
  const ceremonies = new Set(rows.map(r => r.qid)).size;
  const summary = [
    `${totalWins} ${totalWins === 1 ? 'win' : 'wins'}`,
    totalNoms > 0 && `${totalNoms} ${totalNoms === 1 ? 'nomination' : 'nominations'}`,
    `${ceremonies} ${ceremonies === 1 ? 'ceremony' : 'ceremonies'}`,
  ].filter(Boolean).join(' · ');

  return (
    <section className="mb-12">
      {/* Header — title, summary, rule */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Awards</h2>
        <span className="lh-label tracking-[0.15em] text-white/50">{summary}</span>
        <div className="flex-1 h-px bg-white/15" />
      </div>

      <div className="border border-white/15">
        {shown.map((r, i) => (
          <div
            key={r.key}
            className={`grid grid-cols-[84px_minmax(0,1fr)] gap-x-4 gap-y-2 items-baseline px-3 py-3 ${i > 0 ? 'border-t border-white/10' : ''}`}
          >
            <span className="lh-label text-white/60 tabular-nums">{r.year || '—'}</span>
            {/* As above. This one is a grid item rather than an inline box, so the
                negative margin also has to cancel the baseline shift the padding
                introduces — verified against the year column, which stays aligned. */}
            <Link
              to={ceremonyHref(r)}
              className="justify-self-start p-1 -m-1 text-sm text-white underline decoration-white/30 underline-offset-4 hover:bg-white hover:text-black hover:decoration-transparent focus-visible:bg-white focus-visible:text-black focus-visible:decoration-transparent focus-visible:outline-none transition-colors"
            >
              {r.ceremony}
            </Link>

            {r.wins.length > 0 && (
              <>
                <span className="lh-label text-white/60">Won</span>
                <CategoryList row={r} cats={r.wins} tone="text-white/70" />
              </>
            )}
            {r.noms.length > 0 && (
              <>
                <span className="lh-label text-white/50">Nominated</span>
                <CategoryList row={r} cats={r.noms} tone="text-white/60" />
              </>
            )}
          </div>
        ))}
      </div>
      {preview.length < rows.length && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          aria-expanded={showAll}
          className="lh-label w-full px-3 py-3 border border-t-0 border-white/15 text-white/60 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer text-left"
        >
          {showAll ? 'Show fewer' : `Show all ${rows.length} ceremonies`}
        </button>
      )}
    </section>
  );
}
