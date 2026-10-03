import GameCard from '../games/GameCard';

/* One labelled row of related games, scrolling sideways rather than wrapping:
   a game with forty DLC packs should cost one row of height, not eight. The
   cards are the app's own GameCard, so each one carries your status and the
   same menu it has on every other screen. */
export default function RelatedRow({ label, games, more = 0 }) {
  if (!games?.length) return null;
  return (
    <div className="mb-8 last:mb-0">
      <div className="flex items-baseline gap-3 mb-3">
        <h3 className="lh-label text-white/60 m-0">{label}</h3>
        <span className="lh-label text-white/60 tabular-nums">{games.length + more}</span>
      </div>
      <ul className="flex gap-3 overflow-x-auto no-scrollbar snap-x m-0 p-0 list-none">
        {games.map(g => (
          <li key={g.id} className="w-32 sm:w-36 shrink-0 snap-start">
            <GameCard game={g} />
          </li>
        ))}
        {more > 0 && (
          <li className="w-32 sm:w-36 shrink-0 flex items-center justify-center border border-white/15 aspect-[3/4]">
            <span className="lh-label text-white/60 text-center px-3">And {more} more on IGDB</span>
          </li>
        )}
      </ul>
    </div>
  );
}
