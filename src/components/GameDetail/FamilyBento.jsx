import GameCard from '../games/GameCard';

/* The game's relatives as a bento grid: one tile per kind of relation, each
 * tile as wide as its games need.
 *
 * Rows of equal height spent a full row on a lone original and wrapped forty
 * DLC packs over eight; tiles size to their count instead. A tile spans one
 * column per game up to the grid's width, and the grid packs densely, so
 * small tiles fill in beside large ones rather than leaving holes:
 *
 *   phone  2 cols    sm  3 cols    lg  4 cols
 *
 * The cards are the app's own GameCard, so each carries your status and the
 * menu it has everywhere else. A capped group ends with a tile counting the
 * rest. */
const SPAN = (n) => (
  n <= 1 ? 'col-span-1'
    : n === 2 ? 'col-span-2'
      : n === 3 ? 'col-span-2 sm:col-span-3'
        : 'col-span-2 sm:col-span-3 lg:col-span-4'
);

export default function FamilyBento({ groups }) {
  if (!groups?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 [grid-auto-flow:row_dense]">
      {groups.map((g) => {
        const count = g.games.length + (g.more || 0);
        return (
          <section
            key={g.label}
            data-group={g.label}
            aria-label={`${g.label}, ${count}`}
            className={`border border-white/15 p-3 min-w-0 ${SPAN(g.games.length + (g.more > 0 ? 1 : 0))}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <h3 className="lh-label lh-multiline text-white/60 m-0 min-w-0">{g.label}</h3>
              {count > 1 && <span className="lh-label text-white/60 tabular-nums shrink-0">{count}</span>}
            </div>
            {/* A phone has two columns, and a tile of five wrapped into three rows
                of cards. Below sm a tile is one row that scrolls sideways; from
                sm it is a grid that fills its span. */}
            <ul className="flex gap-3 overflow-x-auto no-scrollbar snap-x m-0 p-0 list-none sm:grid sm:overflow-visible sm:[grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]">
              {g.games.map(game => (
                <li key={game.id} className={`min-w-0 snap-start ${g.games.length > 1 ? 'w-28 shrink-0 sm:w-auto' : 'w-full'}`}>
                  <GameCard game={game} />
                </li>
              ))}
              {g.more > 0 && (
                <li className="min-w-0 w-28 shrink-0 sm:w-auto aspect-[3/4] flex items-center justify-center border border-white/15">
                  <span className="lh-label text-white/60 text-center px-3">And {g.more} more on IGDB</span>
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
