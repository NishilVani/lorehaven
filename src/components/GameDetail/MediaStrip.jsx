import { Play } from 'lucide-react';
import { SectionHeader } from './parts';

const img = (id, size) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

/* The media, on the page. Screenshots used to exist only inside the lightbox,
   behind a play button on the hero, so a game's art — the one source of colour
   this product allows — was a click away from a page about that game. The strip
   shows the first plates at true 16:9 and every one opens the lightbox at its
   own index; the lightbox stays the place to page through all of them. */
export default function MediaStrip({ media, name, onOpen }) {
  if (!media?.length) return null;
  const shown = media.slice(0, 8);
  return (
    <section className="mb-12" aria-labelledby="media-heading">
      <SectionHeader
        id="media-heading"
        aside={media.length > shown.length && (
          <button
            type="button"
            onClick={() => onOpen(0)}
            className="lh-label text-white/60 hover:text-white focus-visible:text-white underline decoration-white/30 underline-offset-4 py-2 -my-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
          >
            All {media.length}
          </button>
        )}
      >
        Media
      </SectionHeader>
      <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory">
        {shown.map((m, i) => (
          <button
            key={`${m.type}-${m.id}-${i}`}
            type="button"
            onClick={() => onOpen(i)}
            aria-label={`Open ${m.type === 'video' ? (m.name || 'video') : `image ${i + 1}`} of ${name}`}
            className="group relative shrink-0 snap-start w-[72%] sm:w-[46%] lg:w-[calc((100%-1rem)/3)] aspect-video border border-white/15 bg-neutral-900 overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <img
              src={m.type === 'video' ? `https://img.youtube.com/vi/${m.id}/hqdefault.jpg` : img(m.id, 'screenshot_big')}
              alt=""
              loading="lazy"
              draggable={false}
              className="w-full h-full object-cover block transition-opacity group-hover:opacity-80"
            />
            {m.type === 'video' && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-12 h-12 bg-black border border-white/50 flex items-center justify-center text-white group-hover:bg-white group-hover:text-black transition-colors">
                  <Play aria-hidden="true" className="w-5 h-5 ml-0.5" fill="currentColor" />
                </span>
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
