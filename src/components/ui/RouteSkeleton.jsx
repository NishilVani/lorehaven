import { useLocation } from 'react-router-dom';
import { Skeleton, GameCardSkeleton } from './Skeleton';

/* What a page looks like before its code has arrived: its shape, never the
 * word "Loading". Route chunks are prefetched (motion/routes.js), so this
 * mostly shows on a cold first load of a deep link.
 *
 *   detail  game, franchise, collection, event, ceremony: hero, poster, title
 *   grid    library, explore lists, browse, category, collections: heading
 *           and a grid of cards
 *   list    everything else: heading and rows */
const DETAIL = /^\/(game|franchise|collection|event|awards\/)[^]*$/;
const GRID = /^\/(library|explore|browse|games|collections|wallpapers)\b|^\/$/;

function shapeFor(pathname) {
  if (/^\/awards\/?$/.test(pathname)) return 'list';
  if (DETAIL.test(pathname)) return 'detail';
  if (GRID.test(pathname)) return 'grid';
  return 'list';
}

export default function RouteSkeleton() {
  const { pathname } = useLocation();
  const shape = shapeFor(pathname);
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page</span>
      {shape === 'detail' && (
        <>
          <Skeleton className="w-full h-[28vh] min-h-[200px] md:h-[44vh] lg:-mt-8 border-b border-white/15" />
          <div className="content-container pt-3 pb-8 md:pt-8 flex gap-4 md:gap-8 items-start">
            <Skeleton className="w-24 sm:w-32 lg:w-44 aspect-[3/4] shrink-0 -mt-15 md:-mt-28" />
            <div className="flex-1 min-w-0 pt-6">
              <Skeleton className="h-3 w-24 mb-4" />
              <Skeleton className="h-10 w-2/3 mb-4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </>
      )}
      {shape === 'grid' && (
        <div className="content-container py-8">
          <Skeleton className="h-10 w-48 mb-8" />
          <div className="game-grid">
            {Array.from({ length: 8 }, (_, i) => <GameCardSkeleton key={i} />)}
          </div>
        </div>
      )}
      {shape === 'list' && (
        <div className="content-container py-8">
          <Skeleton className="h-10 w-48 mb-8" />
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full mb-2" />)}
        </div>
      )}
    </div>
  );
}
