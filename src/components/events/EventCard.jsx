import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import MarqueeText from '../ui/MarqueeText';

export default function EventCard({ evt }) {
  const eventDate = evt.start_time
    ? new Date(evt.start_time * 1000).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : '';

  return (
    <Link
      to={`/event/${evt.id}`}
      className="flex-shrink-0 w-40 flex flex-col cursor-pointer group event-card p-2 rounded-lg transition-colors duration-200 -m-2 relative overflow-visible z-10"
    >
      {/* Backdrop container stack */}
      <div className="event-card-bg">
        {evt.event_logo?.image_id && (
          <>
            {/* Blurred background layer */}
            <img
              src={`https://images.igdb.com/igdb/image/upload/t_logo_med/${evt.event_logo.image_id}.png`}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-40"
            />
            {/* Dark overlay for contrast */}
            <div className="absolute inset-0 bg-black/30" />
          </>
        )}
      </div>

      {/* Foreground container — transparent 4:3 cover */}
      <div className="w-full h-[108px] relative flex items-center justify-center z-10 rounded-md overflow-hidden">
        {evt.event_logo?.image_id ? (
          <img
            src={`https://images.igdb.com/igdb/image/upload/t_logo_med/${evt.event_logo.image_id}.png`}
            alt={evt.name}
            className="w-full h-auto max-h-full object-contain opacity-90 scale-[0.75] group-hover:scale-100 group-hover:opacity-100 transition-all duration-300 rounded-md"
          />
        ) : (
          <Calendar className="w-8 h-8 text-white/50" />
        )}
      </div>

      {/* Footer */}
      <div className="mt-2 flex flex-col gap-1 relative z-10">
        <MarqueeText
          text={evt.name}
          className="text-sm font-bold text-white/90 group-hover:text-white transition-colors duration-200"
        />
        {eventDate && (
          <span className="text-[10px] font-extrabold tracking-[0.15em] uppercase text-white/50">
            {eventDate}
          </span>
        )}
      </div>
    </Link>
  );
}
