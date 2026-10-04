import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getLibraryIndex } from '../../services/db';
import { statusColor } from '../../constants/stateColors';

const img = (id) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`;

/* The franchise as a line: every main game in release order, a cover over a
 * tick on one rule, the year under it. It answers the question a game page
 * could not before -- where does this one sit in the series -- and, because
 * each entry carries your status, which of them you have played.
 *
 * Entries are spaced evenly, not to scale: a franchise with a nine-year gap
 * would otherwise be mostly empty rule. The highlighted entry is this game, or
 * the original an expansion belongs to, and the strip scrolls to it on open. */
export default function SeriesTimeline({ timeline, franchise, gameName }) {
  const railRef = useRef(null);
  const markRef = useRef(null);
  const { entries, highlightId, highlightIsSelf, before, after, total } = timeline;

  /* Centre the highlight in the rail, horizontally only. scrollIntoView would
     also scroll the page to it, which on open is a jump nobody asked for. */
  useEffect(() => {
    const rail = railRef.current, mark = markRef.current;
    if (!rail || !mark) return;
    rail.scrollLeft = mark.offsetLeft - (rail.clientWidth - mark.clientWidth) / 2;
  }, [highlightId]);

  const lib = getLibraryIndex();

  return (
    <div>
      {/* The heading is the section's one link to the franchise. */}
      <h3 className="m-0 mb-3">
        <Link
          to={`/franchise/${franchise.id}`}
          className="lh-label text-white/60 hover:text-white focus-visible:text-white underline decoration-white/30 underline-offset-4 py-2 -my-2 inline-block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
        >
          {franchise.name} · {total} games{before > 0 || after > 0 ? ` · showing ${entries.length}` : ''}
        </Link>
      </h3>
      <ol
        ref={railRef}
        aria-label={`${franchise.name} in release order`}
        className="relative flex overflow-x-auto no-scrollbar m-0 p-0 list-none pb-1"
      >
        {entries.map((g) => {
          const here = g.id === highlightId;
          const entry = lib.get(String(g.id));
          const year = g.release_year || 'TBA';
          return (
            <li key={g.id} ref={here ? markRef : null} className="w-28 sm:w-32 shrink-0 flex flex-col">
              {/* The marker line above the covers keeps every cover top-aligned:
                  only the highlighted entry fills it. */}
              <div className="h-6 flex items-end px-1.5">
                {here && (
                  <span className="lh-label px-1.5 py-0.5 bg-white text-black">
                    {highlightIsSelf ? 'This game' : 'Its original'}
                  </span>
                )}
              </div>
              <Link
                to={`/game/${g.id}`}
                aria-current={here && highlightIsSelf ? 'page' : undefined}
                aria-label={`${g.name}, ${year}${entry ? `, in your library: ${entry.status}` : ''}${here && !highlightIsSelf ? `, the original of ${gameName}` : ''}`}
                className="group block px-1.5 pt-2 focus-visible:outline-none"
              >
                <div className={`aspect-[3/4] bg-neutral-900 overflow-hidden ${here ? 'border-2 border-white' : 'border border-white/15 group-hover:border-white/60 group-focus-visible:border-white'} transition-colors`}>
                  {g.cover_id && (
                    <img src={img(g.cover_id)} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover block" />
                  )}
                </div>
                <div className={`text-[13px] leading-snug mt-2 line-clamp-2 min-h-[2.5em] ${here ? 'text-white' : 'text-white/70 group-hover:text-white'}`}>
                  {g.name}
                </div>
              </Link>
              {/* The rule: one segment per entry, so it runs unbroken. */}
              <div className="relative h-5 mt-2" aria-hidden="true">
                <div className="absolute inset-x-0 top-1/2 h-px bg-white/25" />
                <div
                  className={`absolute left-1.5 top-1/2 -translate-y-1/2 ${here ? 'w-3 h-3 bg-white' : 'w-2 h-2 border border-white/60 bg-black'}`}
                  style={entry && !here ? { backgroundColor: statusColor(entry.status), borderColor: 'transparent' } : undefined}
                />
              </div>
              {/* The status in words beside the year: the tick colour alone would
                  be colour as the only signal. */}
              <div className={`lh-label tabular-nums px-1.5 mt-1 ${here ? 'text-white' : 'text-white/60'}`}>
                {year}{entry && <span className="text-white"> · {entry.status}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
