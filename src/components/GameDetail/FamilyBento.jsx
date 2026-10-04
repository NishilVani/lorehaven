import { Link } from 'react-router-dom';
import { getLibraryIndex } from '../../services/db';

const img = (id) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`;

/* The game's relatives as a bento: one tile per relation, laid edge to edge on
 * a single hairline grid.
 *
 * The first version boxed a GameCard inside a bordered tile -- three layers of
 * chrome around every cover, a sideways spine title and a menu each -- and let
 * tiles shrink to their contents, so rows ended in empty space. Now:
 *
 * - The tiles share one 1px grid (gap-px over the rule colour), the way the
 *   index tables do, so there is never a border inside a border.
 * - Every row fills the width. A tile grows in proportion to how many games it
 *   holds, and flex-wrap gives each row's leftover space to its tiles.
 * - A tile with one game is a feature: the cover beside the title in display
 *   type. A tile with several is a row of plain covers that scrolls sideways
 *   when it outgrows its share.
 *
 * Your status is said in words, as it is on the timeline. */
function Status({ entry }) {
  if (!entry) return null;
  return <span className="text-white"> · {entry.status}</span>;
}

function Feature({ game, entry }) {
  return (
    <Link to={`/game/${game.id}`} className="group flex gap-4 items-start focus-visible:outline-none">
      <div className="w-24 sm:w-28 shrink-0 aspect-[3/4] bg-neutral-900 overflow-hidden outline outline-1 outline-transparent group-hover:outline-white/60 group-focus-visible:outline-white transition-[outline-color]">
        {game.cover_id && <img src={img(game.cover_id)} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover block" />}
      </div>
      <div className="min-w-0 pt-1">
        <div className="lh-display text-lg sm:text-xl text-white leading-tight group-hover:underline underline-offset-4 break-words">{game.name}</div>
        <div className="lh-label text-white/60 tabular-nums mt-2">{game.release_year || 'TBA'}<Status entry={entry} /></div>
      </div>
    </Link>
  );
}

function Cover({ game, entry }) {
  return (
    <Link to={`/game/${game.id}`} className="group block w-24 sm:w-28 shrink-0 snap-start focus-visible:outline-none">
      <div className="aspect-[3/4] bg-neutral-900 overflow-hidden outline outline-1 outline-transparent group-hover:outline-white/60 group-focus-visible:outline-white transition-[outline-color]">
        {game.cover_id && <img src={img(game.cover_id)} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover block" />}
      </div>
      <div className="text-[13px] leading-snug text-white/70 group-hover:text-white mt-2 line-clamp-2 min-h-[2.5em]">{game.name}</div>
      <div className="lh-label text-white/60 tabular-nums mt-1">{game.release_year || 'TBA'}<Status entry={entry} /></div>
    </Link>
  );
}

export default function FamilyBento({ groups }) {
  if (!groups?.length) return null;
  const lib = getLibraryIndex();
  return (
    <div className="flex flex-wrap gap-px bg-white/15 border border-white/15">
      {groups.map((g) => {
        const count = g.games.length + (g.more || 0);
        const single = g.games.length === 1 && !g.more;
        /* Grow by game count, from a basis that fits the tile's own content:
           a feature needs room for its title, a row of n covers n of them. */
        const slots = g.games.length + (g.more ? 1 : 0);
        const basis = single ? '18rem' : `${Math.min(slots, 4) * 8 + 2}rem`;
        return (
          <section
            key={g.label}
            data-group={g.label}
            aria-label={`${g.label}, ${count}`}
            className="bg-black p-4 min-w-0 max-w-full"
            style={{ flex: `${single ? 1.5 : slots} 1 ${basis}` }}
          >
            <h3 className="lh-label text-white/60 m-0 mb-3">
              {g.label}{count > 1 && <span className="tabular-nums"> · {count}</span>}
            </h3>
            {single ? (
              <Feature game={g.games[0]} entry={lib.get(String(g.games[0].id))} />
            ) : (
              <ul className="flex gap-4 overflow-x-auto no-scrollbar snap-x m-0 p-0 list-none">
                {g.games.map(game => (
                  <li key={game.id} className="shrink-0"><Cover game={game} entry={lib.get(String(game.id))} /></li>
                ))}
                {g.more > 0 && (
                  <li className="shrink-0 w-24 sm:w-28 aspect-[3/4] flex items-center justify-center border border-white/15">
                    <span className="lh-label text-white/60 text-center px-3">And {g.more} more on IGDB</span>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
