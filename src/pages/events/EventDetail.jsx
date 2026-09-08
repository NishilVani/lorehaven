import { useState, useEffect, useMemo } from 'react';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { useParams, useNavigate, Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import GameCard from '../../components/games/GameCard';
import { useLibraryCards } from '../../components/games/useLibraryCards';
import { Skeleton } from '../../components/ui/Skeleton';
import { getEventById } from '../../services/igdb';
import { ceremonyForEvent, awardTally } from '../../services/wikidata/eventLink';

/* An event is not an appointment. It is the moment a slate of games entered the
 * world, and that is the only thing anyone is here for once the broadcast ends —
 * which is every visit but the two hours it was live.
 *
 * The page this replaced was a broadcast listing. It opened with the title, a
 * press-kit logo, and a table reading STARTS / ENDS / DURATION / GAMES / STREAM,
 * then four paragraphs of the publisher's own future-tense marketing copy
 * ("tune in", "stay tuned", "watch both broadcasts live on September 3") sitting
 * directly beneath a badge that said CONCLUDED. The 34 games the event actually
 * delivered were last on the page, in an undifferentiated grid, with nothing
 * saying which of them were already yours.
 *
 * So the slate leads and the broadcast follows. Duration is gone entirely: no
 * one has ever needed to know that a showcase ran two hours. The live window is
 * the one time the schedule is the story, and it takes the top for exactly that
 * long.
 */

const fmtFull = (unix) =>
  unix
    ? new Date(unix * 1000).toLocaleString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;

const fmtDay = (unix) =>
  unix
    ? new Date(unix * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

/* How long ago, in the words someone would actually use. The page is an archive
   entry for all but two hours of its life, so the date it carries should read as
   history rather than as a booking. */
const ago = (unix, now) => {
  if (!unix) return null;
  const days = Math.floor((now - unix * 1000) / 86400000);
  if (days < 0) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 18) return months <= 1 ? 'last month' : `${months} months ago`;
  const years = Math.round(days / 365.25);
  return years <= 1 ? 'last year' : `${years} years ago`;
};

const countdown = (ms) => {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor(ms / 3600000) % 24;
  const m = Math.floor(ms / 60000) % 60;
  return [d > 0 && `${d}D`, (d > 0 || h > 0) && `${h}H`, `${m}M`].filter(Boolean).join(' ');
};

/* Map a nested IGDB game -> the shape GameCard reads */
const mapGame = (g) => ({
  id: g.id,
  name: g.name,
  cover_id: g.cover?.image_id || null,
  dev: g.involved_companies?.find(c => c.company?.name)?.company?.name || null,
  release_year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
  first_release_date: g.first_release_date || null,
  total_rating: g.total_rating || null,
});

/** One figure in the slate strip. The number leads; the label explains it. */
function Tally({ n, label }) {
  return (
    <div className="min-w-0">
      <div className="lh-display text-2xl lg:text-3xl text-white leading-none tabular-nums">{n}</div>
      <div className="lh-label text-white/60 mt-2">{label}</div>
    </div>
  );
}

/** A titled band of game cards. */
function Slate({ id, title, note, games, statusBadge, menuOptions }) {
  if (games.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 id={id} className="lh-display text-[22px] lg:text-[28px] text-white m-0">{title}</h2>
        <span className="lh-label text-white/60 tabular-nums shrink-0">{games.length}</span>
        <div className="flex-1 self-center h-px bg-white/15" />
      </div>
      {note && <p className="text-sm text-white/60 mt-0 mb-5 max-w-[65ch]">{note}</p>}
      <div className="game-grid">
        {games.map(game => (
          <GameCard
            key={game.id}
            game={game}
            statusBadge={statusBadge(game)}
            menuOptions={menuOptions(game)}
          />
        ))}
      </div>
    </section>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const { libraryMap, statusBadge, menuOptions } = useLibraryCards();

  /* Ticks only while the event is live — see the effect below. A detail page for
     something that finished in 2024 has no reason to re-render on a timer. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setEvent(null);
    getEventById(id)
      .then(data => { if (!cancelled) setEvent(data); })
      .catch(err => { console.error('Error fetching event:', err); if (!cancelled) setLoadError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const start = event?.start_time ? event.start_time * 1000 : null;
  const end = event?.end_time ? event.end_time * 1000 : start ? start + 4 * 3600 * 1000 : null;
  const isLive = !!start && now >= start && now < end;
  const isUpcoming = !!start && now < start;

  /* One minute is the resolution the countdown displays, so that is the interval.
     It runs for the live window and the run-up and nothing else. */
  useEffect(() => {
    if (!isLive && !isUpcoming) return;
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [isLive, isUpcoming]);

  const games = useMemo(
    () => (event?.games || []).filter(g => g?.id).map(mapGame),
    [event],
  );

  /* The slate, split the way someone reads it: what is already yours, and what
     has actually shipped since. Both are answerable from data the page already
     holds, and neither was on the page before. */
  const slate = useMemo(() => {
    const mine = [], rest = [];
    let released = 0;
    for (const g of games) {
      if (g.first_release_date && g.first_release_date * 1000 <= now) released++;
      (libraryMap[String(g.id)] ? mine : rest).push(g);
    }
    return { mine, rest, released, pending: games.length - released };
  }, [games, libraryMap, now]);

  /* How much of this slate went on to win something.
     A local lookup against the shipped award index — no query, and the index is
     ~8.6 kB gzipped rather than the 335 kB corpus, because the only question
     here is whether a game won, not what it won. That belongs on the game.
     Loaded after paint, so the slate never waits on it. */
  const [awards, setAwards] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const ids = games.map(g => g.id);
    /* The empty case resolves through the same promise rather than setting state
       synchronously: an early `setAwards(null)` here is a sync setState inside an
       effect, which cascades a render, and returning early instead would leave
       the previous event's tally on screen after navigating to one with no
       games. */
    Promise.resolve(ids.length ? awardTally(ids) : { won: 0, nominated: 0 })
      .then(t => { if (!cancelled) setAwards(t); })
      .catch(() => { /* the tally is an extra, never a blocker */ });
    return () => { cancelled = true; };
  }, [games]);

  /* The one place Wikidata's ceremonies and IGDB's events are the same thing.
     Exact name match only — see eventLink.js for why fuzzy is off the table. */
  const ceremony = useMemo(() => ceremonyForEvent(event?.name), [event?.name]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white pb-16">
        <div className="content-container py-4 lg:py-12">
          <Skeleton className="h-4 w-16 mb-6" />
          <Skeleton className="h-12 w-2/3 mb-4" />
          <Skeleton className="h-4 w-48 mb-10" />
          <Skeleton className="h-20 w-full mb-10" />
          <div className="game-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-black text-white pb-16">
        <div className="content-container py-4 lg:py-12">
          <PageHeader back={{ label: 'Back', onClick: () => navigate(-1) }} title="Event Unavailable" />
          <div className="max-w-2xl"><EmptyPlate failed title="The index did not answer" body="LoreHaven could not reach IGDB. Nothing here is missing; it has not loaded yet." /></div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-black text-white pb-16">
        <div className="content-container py-4 lg:py-12">
          <PageHeader back={{ label: 'Back', onClick: () => navigate(-1) }} title="Event Not Found" />
          <div className="border border-white/15 p-6 max-w-2xl">
            <div className="lh-label text-white/60">IGDB has no record for this id</div>
            <Link
              to="/events"
              className="tap lh-label text-white mt-5 inline-flex border border-white/40 px-4 py-2.5 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
            >
              All events &rarr;
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const art = event.event_logo?.image_id
    ? `https://images.igdb.com/igdb/image/upload/t_720p/${event.event_logo.image_id}.jpg`
    : null;

  /* History by default. The date reads as a position in the past, not as a
     booking, because that is what it is on all but one visit. */
  const when = isLive ? 'Live now'
    : isUpcoming ? `Starts in ${countdown(start - now)}`
      : [fmtDay(event.start_time), ago(event.start_time, now)].filter(Boolean).join(' · ');

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4 lg:py-12">

        <PageHeader
          back={{ label: 'Back', onClick: () => navigate(-1) }}
          title={event.name}
          meta={when || undefined}
          actions={
            /* Demoted from a 380px hero to an identifying mark. Event logos are
               publisher marketing assets in someone else's brand — the beige
               full-bleed one on the index was the loudest colour in the app, on
               a page whose One Voice Rule says colour comes from cover art. Here
               the covers below carry it, which is also what the event is about. */
            art && (
              <img
                src={art}
                alt=""
                className="hidden sm:block w-28 h-16 object-contain border border-white/15 bg-neutral-950 shrink-0"
              />
            )
          }
        />

        {/* The live window is the one time a schedule is the story. It takes the
            top for exactly as long as that is true, and never afterwards. */}
        {isLive && (
          <div className="border border-white flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 mb-8">
            <span className="lh-label bg-white text-black px-3 py-2 flex items-center gap-2 shrink-0">
              <span aria-hidden="true" className="w-1.5 h-1.5 bg-current motion-safe:animate-pulse" />
              Live
            </span>
            {end && <span className="lh-label text-white/60 tabular-nums">Ends in {countdown(end - now)}</span>}
            {event.live_stream_url && (
              <a
                href={event.live_stream_url}
                target="_blank"
                rel="noopener noreferrer"
                className="tap lh-label text-white ml-auto border border-white/40 px-4 py-2.5 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
              >
                Watch the stream &rarr;
              </a>
            )}
          </div>
        )}

        {/* ── The slate, in numbers ── */}
        {games.length > 0 && (
          <section aria-label="What this event showed" className="border-y border-white/15 py-6 mb-4">
            <div className="flex flex-wrap gap-x-10 gap-y-6">
              <Tally n={games.length} label={games.length === 1 ? 'Game shown' : 'Games shown'} />
              <Tally n={slate.mine.length} label="On your shelves" />
              {/* "Out now" rather than "released since the event": the second
                  reads as a claim about what this event delivered, and the data
                  cannot support it — a game already on sale when the showcase
                  aired would be counted as though the showcase produced it.
                  These two also partition the slate exactly, which "released
                  since" would not. */}
              <Tally n={slate.released} label="Out now" />
              <Tally n={slate.pending} label="Still to come" />
              {/* Only once it is known and non-zero. A "0 Award-winning" on a
                  showcase of unreleased games is a true number that reads as a
                  judgement, and while the index is still loading the absence of
                  a figure is honest where a zero would not be. */}
              {awards?.won > 0 && <Tally n={awards.won} label="Award-winning" />}
            </div>
          </section>
        )}

        {/* ── The one crossing between the two datasets ──
            IGDB models broadcasts; Wikidata models award ceremonies, and they
            overlap only where a ceremony IS a broadcast. Across all 934 IGDB
            events that is 14 links over 3 ceremonies, almost all of them The
            Game Awards. Rare enough that it is worth surfacing when it happens,
            and far too rare to build a matching UI around. */}
        {ceremony && (
          <Link
            to={`/awards/${ceremony.qid}`}
            className="tap-block flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-white/15 px-4 py-4 mb-4 text-white hover:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
          >
            <span className="lh-label text-white/60">Award ceremony</span>
            <span className="lh-label text-white">{ceremony.label}</span>
            <span className="lh-label text-white/60 ml-auto">Every winner and nominee &rarr;</span>
          </Link>
        )}

        {/* ── The slate, as games ── */}
        {games.length === 0 ? (
          <div className="border border-white/15 p-6 max-w-2xl mt-8">
            <p className="text-sm text-white/60 m-0">
              IGDB lists no games for this event. That usually means the line-up has not been
              recorded yet rather than that nothing was shown.
            </p>
          </div>
        ) : (
          <>
            <Slate
              id="slate-yours"
              title="From your shelves"
              note="Games this event showed that you already track. Their status is on the card."
              games={slate.mine}
              statusBadge={statusBadge}
              menuOptions={menuOptions}
            />
            <Slate
              id="slate-rest"
              title={slate.mine.length > 0 ? 'Everything else shown' : 'What it showed'}
              games={slate.rest}
              statusBadge={statusBadge}
              menuOptions={menuOptions}
            />
          </>
        )}

        {/* ── The broadcast, kept and demoted ──
            Still here, because a stream link and a start time are real facts and
            someone will want them. Below the slate, because they are not why
            anyone opened the page. */}
        <section aria-labelledby="broadcast-heading" className="mt-14">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 id="broadcast-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0">The broadcast</h2>
            <div className="flex-1 self-center h-px bg-white/15" />
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="border border-white/15">
              <div className="flex items-baseline gap-4 py-3 px-3 border-white/10">
                <span className="lh-label text-white/60 w-20 shrink-0">Started</span>
                <span className="lh-label text-white flex-1 min-w-0 break-words">{fmtFull(event.start_time) || 'Not recorded'}</span>
              </div>
              {event.end_time && (
                <div className="flex items-baseline gap-4 py-3 px-3 border-t border-white/10">
                  <span className="lh-label text-white/60 w-20 shrink-0">Ended</span>
                  <span className="lh-label text-white flex-1 min-w-0 break-words">{fmtFull(event.end_time)}</span>
                </div>
              )}
              {event.live_stream_url && (
                <div className="flex items-baseline gap-4 py-3 px-3 border-t border-white/10">
                  <span className="lh-label text-white/60 w-20 shrink-0">Stream</span>
                  <a
                    href={event.live_stream_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    /* py-2 -my-2 grows the hit box without moving the line box.
                       `.tap` alone was not enough: it is gated on pointer:coarse,
                       so this measured 198x11 on desktop and failed 2.5.8 there
                       while passing on mobile. 24px is every pointer's floor. */
                    className="tap lh-label text-white flex-1 min-w-0 break-words py-2 -my-2 underline underline-offset-4 decoration-white/30 hover:decoration-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
                  >
                    Watch
                  </a>
                </div>
              )}
            </div>

            {/* The publisher's own words, attributed as such. Unlabelled, this
                read as Lorehaven's voice — future-tense promo copy under a
                heading that had just called the event concluded. */}
            {event.description && (
              <div>
                <p className="lh-label text-white/60 m-0 mb-3">As the organisers described it</p>
                <p className="text-[15px] text-white/70 leading-[1.7] whitespace-pre-line m-0 max-w-[70ch]">
                  {event.description}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
