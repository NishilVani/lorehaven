import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronRight } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import EmptyPlate from '../../components/ui/EmptyPlate';
import useNotifications from './useNotifications';
import { groupByDay, hasDetail, getSeenAt, markNotificationsSeen } from '../../services/notifications';
import { clearLibraryUpdates, UPDATE_TAG } from '../../services/discover';
import { timeAgo } from './timeAgo';

/* The notification center: what changed about the games in your library.
 *
 * One row per game, newest first, under day headings. A row whose only news is
 * "released" opens the game itself, since there is nothing more to say about a
 * release than the game page already does. Anything else opens the
 * notification's own page, which shows exactly what changed.
 *
 * Opening the center marks everything read, but the unread marks are taken
 * from the moment the page opened, so the rows that were new stay marked for
 * this visit instead of vanishing under the cursor. */

const cover = (id) => `https://images.igdb.com/igdb/image/upload/t_cover_small/${id}.jpg`;

function Row({ n, unread }) {
  const to = hasDetail(n) ? `/notifications/${n.gameId}` : `/game/${n.gameId}`;
  return (
    <li>
      <Link
        to={to}
        className="group flex items-start gap-4 px-2 sm:px-4 py-4 border-t border-white/10 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white transition-colors"
      >
        <span className="w-2 shrink-0 self-center flex justify-center" aria-hidden="true">
          {unread && <span className="w-2 h-2 bg-white" />}
        </span>
        <span className="w-12 h-16 shrink-0 bg-neutral-900 border border-white/15 overflow-hidden">
          {n.cover && <img src={cover(n.cover)} alt="" loading="lazy" className="w-full h-full object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-white font-medium break-words">{n.name || 'Untitled'}</span>
            {unread && <span className="sr-only">(new)</span>}
          </span>
          <span className="flex flex-wrap gap-1.5 mt-2">
            {n.events.map(e => (
              <span key={e.type} className="lh-label px-1.5 py-1 border border-white/25 text-white/70">
                {UPDATE_TAG[e.type] || 'Update'}
              </span>
            ))}
          </span>
          <span className="block mt-2 text-[13px] leading-snug text-white/60">
            {n.events.map(e => e.detail).join(' · ')}
          </span>
        </span>
        <span className="shrink-0 flex items-center gap-2 self-center">
          <span className="lh-label text-white/50 tabular-nums">{timeAgo(n.at)}</span>
          <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const { list } = useNotifications();
  /* Read at mount, before this visit marks anything seen. */
  const [seenAtOpen] = useState(getSeenAt);

  useEffect(() => {
    markNotificationsSeen();
  }, [list.length]);

  const groups = groupByDay(list);
  const newCount = list.filter(n => n.at > seenAtOpen).length;

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        <PageHeader
          back={{ label: 'Explore', onClick: () => navigate('/') }}
          title="Notifications"
          titleRef={headingRef}
          count={list.length === 0
            ? 'Nothing yet'
            : `${list.length} ${list.length === 1 ? 'Game' : 'Games'}${newCount ? ` · ${newCount} new` : ''}`}
          actions={list.length > 0 && (
            /* Clearing removes this button, so focus goes to the heading
               rather than falling to <body>. WCAG 2.4.3. */
            <button
              onClick={() => { clearLibraryUpdates(); window.dispatchEvent(new Event('moctale_notif_update')); headingRef.current?.focus(); }}
              className="lh-label px-3 py-1.5 border border-white/20 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer"
            >
              Clear All
            </button>
          )}
        />

        {list.length === 0 ? (
          <EmptyPlate
            icon={Bell}
            title="All Quiet"
            body="When a game in your library gets a release date, a trailer, new screenshots or a critic score, it shows up here."
          />
        ) : (
          groups.map(g => (
            <section key={g.label} aria-labelledby={`notif-${g.label}`} className="mb-8">
              <h2 id={`notif-${g.label}`} className="lh-label text-white/60 mb-2 px-2 sm:px-4">{g.label}</h2>
              <ul className="border-b border-white/10">
                {g.items.map(n => <Row key={n.gameId} n={n} unread={n.at > seenAtOpen} />)}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
