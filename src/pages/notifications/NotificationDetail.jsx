import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import EmptyPlate from '../../components/ui/EmptyPlate';
import ExternalLink from '../../components/ui/ExternalLink';
import useNotifications from './useNotifications';
import { markNotificationsSeen } from '../../services/notifications';
import { UPDATE_TAG } from '../../services/discover';
import { timeAgo } from './timeAgo';

/* One notification: exactly what changed about one game.
 *
 * Each change gets its own block, in the order the list ranks them. Dates and
 * scores show where they were and where they are now; new trailers, screenshots
 * and artwork are shown themselves. Updates found before the feed recorded
 * specifics carry only a count, and say so rather than showing an empty grid. */

const img = (id, size) => `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;

const fmtDate = (sec) => (sec
  ? new Date(sec * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  : 'TBA');

function Block({ title, children }) {
  return (
    <section className="border-t border-white/15 py-6">
      <h2 className="lh-label text-white/60 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function FromTo({ from, to, big = false }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className={`${big ? 'lh-display text-4xl' : 'text-lg'} text-white/50 line-through decoration-1`}>{from}</span>
      <ArrowRight className="w-5 h-5 text-white/60 shrink-0" aria-label="changed to" />
      <span className={`${big ? 'lh-display text-4xl' : 'text-lg'} text-white`}>{to}</span>
    </div>
  );
}

function Unrecorded({ detail, gameId }) {
  return (
    <p className="text-[15px] text-white/60 max-w-[60ch]">
      {detail}. The specific items were not recorded for this update, because it was found before notifications kept them.{' '}
      <Link to={`/game/${gameId}`} className="text-white underline underline-offset-4 hover:bg-white hover:text-black">See them on the game page</Link>.
    </p>
  );
}

function Videos({ items }) {
  const [playing, setPlaying] = useState(null);
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {items.map(v => (
        <li key={v.id}>
          <div className="relative aspect-video bg-neutral-900 border border-white/15 overflow-hidden">
            {playing === v.id && v.video_id ? (
              <iframe
                src={`https://www.youtube.com/embed/${v.video_id}?autoplay=1`}
                title={v.name || 'Trailer'}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            ) : v.video_id ? (
              <button
                type="button"
                onClick={() => setPlaying(v.id)}
                aria-label={`Play ${v.name || 'trailer'}`}
                className="group absolute inset-0 w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
              >
                <img src={`https://img.youtube.com/vi/${v.video_id}/hqdefault.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-12 h-12 flex items-center justify-center bg-black/70 border border-white/40 group-hover:bg-white group-hover:text-black text-white transition-colors">
                    <Play className="w-5 h-5" aria-hidden="true" />
                  </span>
                </span>
              </button>
            ) : null}
          </div>
          {v.name && <p className="mt-2 text-[13px] text-white/70 break-words">{v.name}</p>}
        </li>
      ))}
    </ul>
  );
}

function Images({ items, label }) {
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {items.filter(i => i.image_id).map((i, n) => (
        <li key={i.id}>
          <ExternalLink
            href={img(i.image_id, 't_1080p')}
            aria-label={`Open ${label.toLowerCase()} ${n + 1} full size`}
            className="block aspect-video bg-neutral-900 border border-white/15 overflow-hidden hover:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
          >
            <img src={img(i.image_id, 't_screenshot_med')} alt="" loading="lazy" className="w-full h-full object-cover" />
          </ExternalLink>
        </li>
      ))}
    </ul>
  );
}

function Change({ e, gameId }) {
  const title = UPDATE_TAG[e.type] || 'Update';
  if (e.type === 'released') {
    return <Block title={title}><p className="text-lg text-white">{e.detail}</p></Block>;
  }
  if (e.type === 'date') {
    return (
      <Block title="Release Date">
        {e.change ? <FromTo from={fmtDate(e.change.from)} to={fmtDate(e.change.to)} /> : <p className="text-lg text-white">{e.detail}</p>}
      </Block>
    );
  }
  if (e.type === 'rating') {
    const delta = e.change && e.change.from != null ? e.change.to - e.change.from : null;
    return (
      <Block title="Critic Rating">
        {e.change
          ? (e.change.from == null
            ? <p><span className="lh-display text-4xl text-white">{e.change.to}</span><span className="text-white/60"> / 100, its first critic score</span></p>
            : <>
              <FromTo from={e.change.from} to={e.change.to} big />
              <p className="mt-2 lh-label text-white/60">{delta > 0 ? `Up ${delta}` : `Down ${-delta}`} points, out of 100</p>
            </>)
          : <p className="text-lg text-white">{e.detail}</p>}
      </Block>
    );
  }
  if (e.type === 'video') {
    return <Block title={e.detail}>{e.items?.length ? <Videos items={e.items} /> : <Unrecorded detail={e.detail} gameId={gameId} />}</Block>;
  }
  if (e.type === 'screens' || e.type === 'art') {
    const label = e.type === 'screens' ? 'Screenshot' : 'Artwork';
    const n = e.items?.length || 0;
    return (
      <Block title={n ? `${n} New ${e.type === 'screens' ? 'Screenshots' : 'Artwork'}` : e.detail}>
        {n ? <Images items={e.items} label={label} /> : <Unrecorded detail={e.detail} gameId={gameId} />}
      </Block>
    );
  }
  return <Block title={title}><p className="text-lg text-white">{e.detail}</p></Block>;
}

export default function NotificationDetail() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { list } = useNotifications({ check: false });
  const n = list.find(x => String(x.gameId) === String(gameId));

  useEffect(() => { if (n) markNotificationsSeen(); }, [n]);

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        {!n ? (
          <>
            <PageHeader back={{ label: 'Notifications', onClick: () => navigate('/notifications') }} title="Notification" />
            <EmptyPlate
              title="Not Here Any More"
              body="This notification was cleared, or the game left your library."
              action={<Link to={`/game/${gameId}`} className="lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:bg-white hover:text-black transition-colors">Open The Game</Link>}
            />
          </>
        ) : (
          <>
            <PageHeader
              back={{ label: 'Notifications', onClick: () => navigate('/notifications') }}
              title={n.name || 'Untitled'}
              titleClassName="text-3xl lg:text-5xl"
              count={`${n.events.length} ${n.events.length === 1 ? 'Change' : 'Changes'} · ${timeAgo(n.at)}`}
              actions={
                <Link to={`/game/${n.gameId}`} className="lh-label px-3 py-1.5 border border-white/20 text-white/70 hover:bg-white hover:text-black transition-colors">
                  Open Game
                </Link>
              }
            />
            <div className="flex flex-col sm:flex-row gap-6 sm:gap-10">
              {n.cover && (
                /* A fixed 3:4 box, so the page does not jump when the cover
                   arrives, or collapse to a sliver if it never does. */
                <div className="w-32 sm:w-48 shrink-0 self-start aspect-[3/4] bg-neutral-900 border border-white/15 overflow-hidden">
                  <img src={img(n.cover, 't_cover_big')} alt={`${n.name} cover`} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                {n.events.map(e => <Change key={e.type} e={e} gameId={n.gameId} />)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
