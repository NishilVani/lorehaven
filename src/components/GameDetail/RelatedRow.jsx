import { Link } from 'react-router-dom';
import GameCard from '../games/GameCard';

/* One sideways strip of related games, in labelled groups.
 *
 * It used to be one full-width row per group, each with its own heading, so a
 * game with one original, one expansion and one remaster spent three rows of
 * height on three cards. The groups now sit side by side in a single strip:
 * each is a label over its own cards, divided from the next by a rule, and the
 * strip scrolls sideways when it runs out of width. A game with forty DLC packs
 * still costs one row.
 *
 * The cards are the app's own GameCard, so each carries your status and the
 * same menu it has on every other screen. `more` on a group ends it with a tile
 * counting what was left out; `moreTo` makes that tile a link. */
export default function RelatedRow({ groups }) {
  const shown = (groups || []).filter(g => g.games?.length);
  if (shown.length === 0) return null;
  return (
    <div className="flex gap-6 overflow-x-auto no-scrollbar snap-x pb-1">
      {shown.map((g, i) => (
        <div
          key={g.label}
          data-group={g.label}
          className={`shrink-0 flex flex-col gap-3 ${i > 0 ? 'pl-6 border-l border-white/15' : ''}`}
        >
          <div className="flex items-baseline gap-3">
            <h3 className="lh-label text-white/60 m-0">{g.label}</h3>
            {g.games.length + (g.more || 0) > 1 && (
              <span className="lh-label text-white/60 tabular-nums">{g.games.length + (g.more || 0)}</span>
            )}
          </div>
          <ul className="flex gap-3 m-0 p-0 list-none">
            {g.games.map(game => (
              <li key={game.id} className="w-32 sm:w-36 shrink-0 snap-start">
                <GameCard game={game} />
              </li>
            ))}
            {g.more > 0 && (
              <li className="w-32 sm:w-36 shrink-0 aspect-[3/4]">
                {g.moreTo ? (
                  <Link
                    to={g.moreTo}
                    className="w-full h-full flex items-center justify-center border border-white/15 lh-label text-white/60 text-center px-3 hover:bg-white hover:text-black focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors"
                  >
                    See all {g.games.length + g.more}
                  </Link>
                ) : (
                  <span className="w-full h-full flex items-center justify-center border border-white/15 lh-label text-white/60 text-center px-3">
                    And {g.more} more on IGDB
                  </span>
                )}
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
