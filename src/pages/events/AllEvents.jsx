import { useState, useEffect, useMemo } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useNavigate, Link } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { getEvents } from '../../services/igdb';
import { getLibrary } from '../../services/db';
import useAnnounce from '../../components/ui/useAnnounce';
import PageHeader from '../../components/ui/PageHeader';

/* Two tabs, not three.
 *
 * The third was "Awards", and it was a substring search wearing a category's
 * clothes: getEvents matched event NAMES against *"award"* | *"vga"* |
 * *"golden joystick"*, so it returned "Women-Led Games Showcase: The Game Awards
 * Edition", "Day of the Devs: The Game Awards Digital Showcase" and "The Game
 * Awards For Games Who Can't Afford The Game Awards" alongside the one real
 * ceremony. More than half of it was showcases that happen to have the word in
 * their title.
 *
 * Meanwhile /awards holds 41 ceremonies from Wikidata with categories, nominees
 * and winners. Two doors marked awards, one of them a text match that disagrees
 * with the other, is a trust problem rather than a navigation one. The tab is
 * gone and the real archive is linked instead. */
const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'events', label: 'Past' },
];

const LIMIT = 24;

const fmtDate = (unix) =>
  unix ? new Date(unix * 1000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Date TBA';

/* Live = between start and end; events without an end run a nominal 4h (matches getEvents) */
const relStatus = (event, now) => {
  if (!event.start_time) return null;
  const start = event.start_time * 1000;
  const end = event.end_time ? event.end_time * 1000 : start + 4 * 3600 * 1000;
  if (now >= start && now < end) return { live: true, text: 'Live' };
  if (now >= end) return null;

  const diff = start - now;
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor(diff / 3600000) % 24;
  const mins = Math.floor(diff / 60000) % 60;
  return { live: false, text: days > 0 ? `In ${days}D` : hrs > 0 ? `In ${hrs}H` : `In ${mins}M` };
};

export default function AllEvents() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // One clock for every countdown on the page
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Debounce search so typing doesn't fire a request per keystroke
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQuery(query); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  /* The request the list is about to make. Raising `loading` here rather than
     in the effect below means the spinner and the new request start in the same
     render, instead of the old results being painted once more first. Initial
     render is a no-op: loading already starts true. */
  const requestKey = `${offset}|${debouncedQuery}|${tab}`;
  const [loadingFor, setLoadingFor] = useState(requestKey);
  if (loadingFor !== requestKey) {
    setLoadingFor(requestKey);
    setLoading(true);
    if (offset === 0) setLoadError(null);
  }

  useEffect(() => {
    let cancelled = false;
    getEvents(LIMIT, offset, debouncedQuery, tab)
      .then(data => {
        if (cancelled) return;
        setEvents(prev => {
          if (offset === 0) return data;
          // IGDB pages overlap at the seam; the same event must not render twice.
          const seen = new Set(prev.map(e => e.id));
          return [...prev, ...data.filter(e => !seen.has(e.id))];
        });
        setHasMore(data.length === LIMIT);
      })
      .catch(err => { console.error('Error fetching events:', err); if (!cancelled) { setLoadError(err); setHasMore(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, debouncedQuery, tab]);

  const selectTab = (id) => { setTab(id); setOffset(0); setEvents([]); };

  /* The library, read once, as a Set of id strings. The list carries `games` as
     bare ids, so the crossover is a lookup rather than a request. */
  const owned = useMemo(() => new Set(getLibrary().map(g => String(g.id))), []);
  const mineIn = (event) => {
    if (!event.games?.length || owned.size === 0) return 0;
    let n = 0;
    for (const gid of event.games) if (owned.has(String(gid))) n++;
    return n;
  };

  /* ── Hero spotlight — live event, or the next upcoming one ── */
  const heroEvent = (tab === 'upcoming' && !debouncedQuery && events.length > 0)
    ? (events.find(e => relStatus(e, now)?.live) || events.find(e => relStatus(e, now)) || events[0])
    : null;
  const listEvents = heroEvent ? events.filter(e => e.id !== heroEvent.id) : events;
  const heroStatus = heroEvent ? relStatus(heroEvent, now) : null;
  /* Fuller countdown for the hero, driven by the same 60s clock */
  const heroCountdown = (() => {
    if (!heroEvent || !heroStatus || heroStatus.live) return null;
    const diff = heroEvent.start_time * 1000 - now;
    const days = Math.floor(diff / 86400000);
    const hrs = Math.floor(diff / 3600000) % 24;
    const mins = Math.floor(diff / 60000) % 60;
    return [days > 0 && `${days}D`, `${hrs}H`, `${mins}M`].filter(Boolean).join(' ');
  })();

  // Tab switches and searches previously reloaded the list in silence. 4.1.3.
  useAnnounce(loading ? 'Loading events'
    : `${events.length} ${events.length === 1 ? 'event' : 'events'}${hasMore ? ', more available' : ''}`);

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4 lg:py-12">

        {/* ── Header ── */}
        <PageHeader
          className="mb-5"
          title="Events"
          count={`${events.length} ${events.length === 1 ? 'Entry' : 'Entries'}`}
        />

        {/* ── Tabs, and the door the removed one used to be ──
            Deleting the Awards tab without saying where awards went would just
            move the confusion. The link names the real archive and what is in
            it, so the two surfaces stop competing for the same word. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-4">
          <div className="flex overflow-x-auto no-scrollbar border border-white/15 w-max max-w-full">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => selectTab(t.id)}
                aria-pressed={tab === t.id}
                className={`lh-label px-4 py-2.5 border-r last:border-r-0 border-white/10 whitespace-nowrap transition-colors cursor-pointer ${
                  tab === t.id ? 'bg-white text-black' : 'text-white/50 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* py-2 alongside `.tap`, not instead of it. `.tap` is gated on
              pointer:coarse, so on its own this measured 155x11 and failed 2.5.8
              on every pointer-fine shell — the same slip as the stream link on
              the detail page, made twice in one sitting. */}
          <Link
            to="/awards"
            className="tap lh-label text-white/60 py-2 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
          >
            Award ceremonies &rarr;
          </Link>
        </div>

        {/* ── Search ── */}
        <div className="relative mb-8">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/60" />
          <input
                aria-label="Search events"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SEARCH EVENTS"
            className="w-full h-8 pl-9 pr-8 bg-black border border-white/40 focus:border-white/70 lh-label text-white placeholder:text-white/50 outline-none transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 -m-2 text-white/60 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ── Next up ──
            Typographic, not a billboard. This was a full-bleed 16:7 crop of the
            event's own logo, and IGDB event logos are publisher marketing assets
            in someone else's brand: the current one is a beige, blue and orange
            fan-convention wordmark, which made it the single loudest colour in
            the app, on a pitch-black page whose One Voice Rule says colour comes
            from cover art. It also gave the first viewport away to whichever
            event happened to be soonest.

            The name at display size does the same job. The logo stays as a small
            identifying mark, which is what it is good for. */}
        {heroEvent && (
          <button
            onClick={() => navigate(`/event/${heroEvent.id}`)}
            className="group block w-full text-left border border-white/15 mb-8 p-4 sm:p-6 hover:bg-white hover:text-black transition-colors cursor-pointer"
          >
            <div className="flex items-start gap-4 sm:gap-6">
              {heroEvent.event_logo?.image_id && (
                <img
                  src={`https://images.igdb.com/igdb/image/upload/t_thumb/${heroEvent.event_logo.image_id}.jpg`}
                  alt=""
                  className="hidden sm:block w-20 h-20 object-contain border border-white/15 group-hover:border-black/20 bg-neutral-950 shrink-0 transition-colors"
                  loading="lazy"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="lh-label text-white/60 group-hover:text-black/60 transition-colors">
                  {heroStatus?.live ? 'Live now' : 'Next up'}
                </div>
                <div className="lh-display text-2xl sm:text-4xl mt-2 [overflow-wrap:anywhere]">{heroEvent.name}</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                  <span className="lh-label text-white/60 group-hover:text-black/60 transition-colors">
                    {fmtDate(heroEvent.start_time)}
                  </span>
                  {heroStatus?.live ? (
                    <span className="lh-label flex items-center gap-2 px-3 py-1.5 bg-white text-black border border-white group-hover:bg-black group-hover:text-white group-hover:border-black transition-colors">
                      <span aria-hidden="true" className="w-1.5 h-1.5 bg-current motion-safe:animate-pulse" />
                      Live
                    </span>
                  ) : heroCountdown ? (
                    <span className="lh-label tabular-nums text-white group-hover:text-black transition-colors">
                      Starts in {heroCountdown}
                    </span>
                  ) : null}
                  {heroEvent.games?.length > 0 && (
                    <span className="lh-label text-white/60 group-hover:text-black/60 tabular-nums transition-colors">
                      {heroEvent.games.length} {heroEvent.games.length === 1 ? 'game' : 'games'} listed
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        )}

        {/* ── Index rows ── */}
        {loading && events.length === 0 ? (
          <div className="border border-white/15">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 sm:gap-4 px-3 py-3 border-t first:border-t-0 border-white/10">
                <Skeleton className="w-12 h-12 sm:w-16 sm:h-16 shrink-0" />
                <div className="flex-1 min-w-0">
                  <Skeleton className="h-4 w-1/2 mb-2" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." />
        ) : events.length === 0 ? (
          <EmptyPlate title="No Events" body={query ? 'Nothing matches that search' : 'IGDB lists nothing for this tab'} />
        ) : listEvents.length === 0 ? null : (
          <div className="border border-white/15">
            {listEvents.map(event => {
              const status = relStatus(event, now);
              return (
                <button
                  key={event.id}
                  onClick={() => navigate(`/event/${event.id}`)}
                  className="group w-full text-left flex items-center gap-3 sm:gap-4 px-3 py-3 border-t first:border-t-0 border-white/10 hover:bg-white hover:text-black transition-colors cursor-pointer"
                >
                  {/* Logo — the only colour in the row */}
                  <div className="w-12 h-12 sm:w-16 sm:h-16 shrink-0 border border-white/15 group-hover:border-black/20 bg-neutral-950 overflow-hidden transition-colors">
                    {event.event_logo?.image_id ? (
                      <img
                        src={`https://images.igdb.com/igdb/image/upload/t_thumb/${event.event_logo.image_id}.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center lh-label text-white/50 group-hover:text-black/30">
                        No Art
                      </div>
                    )}
                  </div>

                  {/* From sm up the badge sits beside the meta; on a phone it drops under
                      it. Side by side they overflowed a 375 row by 55px and the
                      truncation ate the "N yours" figure the row exists to show. */}
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="lh-display text-base sm:text-lg truncate">{event.name}</div>
                    {/* The date alone made every row identical in weight — a Sony
                        State of Play and a streamer's indie roundup read the
                        same. How many games it showed, and how many of them are
                        already yours, is the difference between them. `mine` is
                        omitted rather than shown as zero: on an empty library
                        every row would carry a "0 yours" that means nothing. */}
                    <div className="lh-label text-white/60 group-hover:text-black/60 mt-1.5 truncate transition-colors tabular-nums">
                      {[
                        fmtDate(event.start_time),
                        event.games?.length > 0 && `${event.games.length} ${event.games.length === 1 ? 'game' : 'games'}`,
                        mineIn(event) > 0 && `${mineIn(event)} yours`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>

                  {status && (
                    <span
                      className={`lh-label shrink-0 self-start sm:self-auto mt-1.5 sm:mt-0 px-2 py-1 whitespace-nowrap tabular-nums transition-colors ${
                        status.live
                          ? 'bg-white text-black border border-white group-hover:bg-black group-hover:text-white group-hover:border-black'
                          : 'text-white/60 group-hover:text-black/60'
                      }`}
                    >
                      {status.text}
                    </span>
                  )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Pagination ── */}
        {hasMore && events.length > 0 && (
          <div className="flex justify-center mt-8">
            {/* `disabled` on a control that disables itself throws focus to <body> — the
                keyboard user is dumped to the top of the page mid-task. aria-disabled
                keeps it focusable and the handler guards the action. WCAG 2.4.3. */}
            <button
              onClick={() => { if (!loading) setOffset(prev => prev + LIMIT); }}
              aria-disabled={loading}
              className="lh-label px-6 py-3 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors cursor-pointer aria-disabled:opacity-40 aria-disabled:cursor-default"
            >
              {loading ? 'Loading…' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
