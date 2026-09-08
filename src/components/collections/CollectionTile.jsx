import { Link } from 'react-router-dom';
import { MoreVertical, ImageOff } from 'lucide-react';
import DropdownMenu from '../ui/DropdownMenu';

const igdbImg = (id) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${id}.jpg`;

const FACES = 2; // cover slots — the third cell of the plate is always the count

/**
 * CollectionTile — the count plate.
 *
 * Art carries identity, the numeral carries scale. Three equal cells, each
 * exactly 3/4 so covers are never cropped: two faces, then the count. The
 * count cell inverts on hover — the app's signature, used as the tile's
 * one payoff rather than as decoration.
 *
 * Props:
 *  to           {string}  — link target
 *  name         {string}
 *  count        {number}  — number of titles (may exceed games.length)
 *  games        {array}   — [{ name, cover }] (preferred)
 *  covers       {array}   — legacy fallback: bare cover image_ids
 *  meta         {string}  — small label: 'Custom', IGDB type name, 'Franchise'…
 *  mutedMeta    {boolean} — render meta as a bordered muted tag (e.g. franchises)
 *  menuOptions  {array}   — optional DropdownMenu options for the ⋯ button
 */
export default function CollectionTile({ to, name, count = 0, games = [], covers = [], meta = null, mutedMeta = false, menuOptions = [] }) {
  const items = games.length > 0
    ? games.filter(g => g && (g.name || g.cover))
    : covers.map(c => ({ name: null, cover: c }));

  // Cover-havers first — a face slot is too scarce to spend on missing art
  const faces = items.filter(i => i.cover).slice(0, FACES);

  return (
    /* The options button used to sit inside the <Link>. Interactive content nested
       in an anchor is invalid, and screen readers folded the button into the link's
       name. The link is now a sibling overlay and the button sits above it. */
    <div className="group relative block border border-white/15 bg-black hover:border-white/70 transition-colors">
      <Link
        to={to}
        aria-label={name}
        className="absolute inset-0 z-0 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
      />
      {/* The plate — 3 equal cells; container aspect keeps every cell at 3/4 */}
      <div className="flex aspect-[9/4]">
        {Array.from({ length: FACES }, (_, i) => (
          <div
            key={i}
            className="flex-1 min-w-0 overflow-hidden border-r border-white/15 group-hover:border-white/70 transition-colors"
          >
            {faces[i] ? (
              <img
                src={igdbImg(faces[i].cover)}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover block"
              />
            ) : i < count ? (
              /* A title lives here, its art doesn't — same treatment as GameCard */
              <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
                <ImageOff className="w-4 h-4 text-neutral-700" />
              </div>
            ) : (
              /* Nothing on the shelf. Same ground as the missing-art slot above, so
                 an empty slot is not mistaken for a cover that failed to load. */
              <div className="w-full h-full bg-neutral-950" />
            )}
          </div>
        ))}

        {/* Count — the punchline. Inverts on hover. */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1.5 px-1 group-hover:bg-white transition-colors">
          <span className="lh-display text-xl sm:text-2xl leading-none tabular-nums text-white group-hover:text-black transition-colors">
            {count}
          </span>
          <span className="lh-label text-white/60 group-hover:text-black/60 transition-colors">
            {count === 1 ? 'Title' : 'Titles'}
          </span>
        </div>
      </div>

      {/* Caption — stark type resting directly under the plate */}
      <div className="border-t border-white/15 group-hover:border-white/70 transition-colors px-3 pt-2.5 pb-3">
        <div className="flex items-start justify-between gap-1.5">
          <div className="lh-display text-sm leading-tight h-9 line-clamp-2 break-words text-white/90 group-hover:text-white transition-colors min-w-0" title={name}>
            {name}
          </div>
          {menuOptions.length > 0 && (
            <div className="relative z-10">
            <DropdownMenu options={menuOptions} align="right">
              <button
                className="p-1.5 -m-1 shrink-0 text-white/60 hover:text-white transition-colors cursor-pointer"
                aria-label="Collection options"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenu>
            </div>
          )}
        </div>

        {/* Fixed-height meta row keeps tile heights uniform with or without meta */}
        <div className="h-4 mt-1.5 flex items-center min-w-0">
          {meta && (
            mutedMeta ? (
              <span className="lh-label border border-white/20 text-white/50 px-1 py-0.5 leading-none">{meta}</span>
            ) : (
              <span className="lh-label text-white/60 truncate">{meta}</span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
