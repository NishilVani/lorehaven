import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { yearStats, completedYears } from '../../services/yearStats';
import { FEEL_ORDER } from '../../services/libraryStats';
import { statusColor, feelColor } from '../../constants/stateColors';
import { Swatch, Legend, ScrollX } from './parts';
import { MONTH_GAP, MONTH_TICK_CELL, monthNameClass } from './monthAxis';

/* The yearly review.
 *
 * A different job from the profile's numbers band, and so a different shape.
 * That band is a table you go to and check; this is read once, top to bottom,
 * and the type is sized to be read that way. Merging them would have made one
 * of the two worse.
 *
 * Each section leads with a sentence about what the chart underneath it shows
 * — not a caption, a finding. "Month by month" over twelve bars asks you to do
 * the reading; "April alone held five completions" has already done it, and the
 * bars are then the evidence rather than the exercise. Every one of those
 * sentences is generated from the same numbers the chart is drawn from, so it
 * cannot drift from what is on screen.
 *
 * The one colour is `--status-solid-beaten`, which is the shelf this entire page
 * is made of — every game here is one you beat. It is not a decorative accent
 * under a different name, and it is used only where the copy already says
 * "finished": the total, and the year's peak month.
 *
 * Nothing here is gated on a minimum. The plan proposed hiding a year under five
 * games on the grounds that it has nothing to say — but a year with three games
 * still has a longest, a busiest month and a verdict, and a link that silently
 * does not exist for 2023 is stranger than a short page. What changes with a
 * thin year is the wording, not the existence.
 */

const cover = (id, size = 't_cover_big') =>
  id ? `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg` : null;

const nf = new Intl.NumberFormat();
const BEATEN = statusColor('Beaten');

/* A dot is 11px; 16px of pitch keeps a stack legible without the dots touching.
   BASE is the room under the lowest row, so a one-deep plot still has air. */
const ROW_H = 16;
const BASE = 34;

/* Past this the stagger stops growing. A 180-square grid multiplied out would
   push the last cell past the end of the scroll range and it would never draw. */
const STAGGER_CAP = 24;

const ORDINAL = ['', 'biggest', 'second-biggest', 'third-biggest', 'fourth-biggest', 'fifth-biggest'];

/** The day you finished it, written out. The list further down groups by month
 *  and prints the month once as a gutter; a card standing on its own has no
 *  such context, so it carries the whole date. */
const fullDate = (at) => new Date(at).toLocaleDateString(undefined, {
  day: 'numeric', month: 'long', year: 'numeric',
});

/**
 * The value is display type but NOT `.lh-display`, which sets
 * `text-transform: uppercase` from outside every cascade layer — no utility can
 * turn that off, and it renders a decade as "THE 2020S", where the plural s
 * reads as part of the number. The other three values are a studio, a series and
 * a score; uppercasing those bought nothing either, and the label above each is
 * already uppercase, so the pair now reads as chrome over data rather than two
 * shouts. Family, weight and tracking are set directly, which is the escape
 * hatch DESIGN.md documents for exactly this.
 */
function Stat({ label, value, detail, to }) {
  const body = (
    <>
      <div className="lh-label text-white/60">{label}</div>
      <div className={`font-display font-bold tracking-[-0.02em] text-xl lg:text-2xl text-white leading-[1.25] break-words mt-3 ${to ? 'group-hover:underline underline-offset-[3px]' : ''}`}>
        {value}
      </div>
      {detail && <div className="text-[13px] text-white/60 mt-2 leading-[1.5]">{detail}</div>}
    </>
  );
  /* Linked only when the id came back. IGDB addresses a studio and a franchise
     by id, and an entry's cached copy of that metadata carries none, so offline
     the card is the same card without a href rather than a dead route. */
  return to
    ? (
      <Link to={to} className="group border border-white/15 p-4 lg:p-5 min-w-0 block hover:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors">
        {body}
      </Link>
    )
    : <div className="border border-white/15 p-4 lg:p-5 min-w-0">{body}</div>;
}

function Cover({ game, i = 0 }) {
  /* t_cover_big (264x374), not t_cover_small (90x128). These render five and six
     to a row on a 1140px page — around 180 CSS px, which the small preset was
     upscaling from 90 and made a mush of on every display, let alone a 2x one. */
  const src = cover(game.cover, 't_cover_big');
  return (
    <Link
      to={`/game/${game.id}`}
      style={{ '--i': Math.min(i, STAGGER_CAP) }}
      className="draw-rise min-w-0 block group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
    >
      <div
        className="aspect-[3/4] border border-white/15 overflow-hidden bg-black"
        style={{ borderTop: `3px solid ${feelColor('Perfection')}` }}
      >
        {src && <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
      </div>
      <div className="text-[13px] text-white mt-2 break-words leading-[1.35] group-hover:underline underline-offset-[3px]">{game.name}</div>
      <div className="text-[13px] text-white/60 mt-1 tabular-nums">{fullDate(game.at)}</div>
    </Link>
  );
}

/**
 * Every finished game placed on one hours axis. A list sorted by length tells
 * you the longest and the shortest; this tells you the shape — whether the year
 * was a cluster of short games with one monster in it, or evenly spread. Ties
 * within a bucket stack upward rather than overprinting, because a dot hiding
 * two games is a chart under-reporting itself.
 */
function HoursPlot({ games }) {
  const timed = games.filter(g => g.hours !== null);
  if (timed.length < 2) return null;

  const max = Math.max(...timed.map(g => g.hours));
  const top = Math.max(10, Math.ceil(max / 10) * 10);
  const bucket = top / 24;
  const stacked = {};
  const dots = timed.map(g => {
    const b = Math.round(g.hours / bucket);
    stacked[b] = (stacked[b] || 0) + 1;
    return { g, x: (g.hours / top) * 100, row: stacked[b] - 1 };
  });

  /* The plot grows to hold its deepest stack instead of assuming one fits.
     Rows were placed at `64% - row * 16%` of a fixed 96px box, which is fine for
     the eighteen games this was built against and false past that: measured on a
     180-game year the stacks ran eleven deep and 79 of 171 dots sat outside the
     box, the highest 98px above it, where the scroll container clipped them
     away. A chart that silently drops 46% of its data is worse than no chart.
     Positions are px from the bottom now, so the arithmetic that places a dot is
     the same arithmetic that sizes the box and they cannot disagree. */
  const deepest = Math.max(...Object.values(stacked));
  const plotH = Math.max(96, BASE + deepest * ROW_H);

  const longest = timed.reduce((a, g) => (g.hours > a.hours ? g : a));
  const shortest = timed.reduce((a, g) => (g.hours < a.hours ? g : a));

  /* Counted over the TIMED games, not the year — this legend keys the dots that
     are actually in this plot, and a verdict that only untimed games carry would
     otherwise appear in a key for a chart it is absent from. */
  const feels = FEEL_ORDER
    .map(key => ({ key, count: timed.filter(g => g.feel === key).length }))
    .filter(f => f.count > 0)
    .reverse();

  return (
    <section aria-labelledby="hours-heading" className="draw-scope mt-14">
      <h2 id="hours-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">How long they took</h2>
      <p className="text-sm text-white/60 mt-0 mb-7">
        Every finished game placed by its time-to-beat.
        {' '}{timed.filter(g => g.hours < 30).length} of {timed.length} came in under 30 hours.
      </p>

      <ScrollX min={520} label="Finished games by time to beat">
        <div className="px-2">
          <div
            className="relative border-r border-white/15"
            style={{ height: plotH, backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '16.666% 100%' }}
          >
            {dots.map((d, i) => (
              <span
                key={d.g.id}
                title={`${d.g.name}: about ${Math.round(d.g.hours)} h${d.g.feel ? ` · ${d.g.feel}` : ''}`}
                className="draw-dot absolute -translate-x-1/2 w-[11px] h-[11px] opacity-85"
                style={{ '--i': Math.min(i, STAGGER_CAP), left: `${d.x}%`, bottom: BASE + d.row * ROW_H, background: feelColor(d.g.feel) }}
              />
            ))}
          </div>
          <div className="flex justify-between border-t border-white/15 mt-2.5 pt-1.5">
            {Array.from({ length: 7 }, (_, i) => Math.round((top / 6) * i)).map((t, i) => (
              <span key={t} className="lh-label text-white/50 tabular-nums">
                {i === 3 ? `hours to beat · ${t}` : t}
              </span>
            ))}
          </div>
        </div>
      </ScrollX>

      {/* The one encoding on either page with no on-screen explanation. Each dot
          is coloured by its verdict, and the only place that said so was the
          `title` — which no touch device will ever show. The squares section
          below has carried a legend all along; this one needed its own. */}
      <Legend items={feels.map(f => ({ key: f.key, label: f.key, color: feelColor(f.key), count: f.count }))} />

      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 mt-4">
        <span className="text-[13px] text-white/60">
          Shortest · <span className="text-white">{shortest.name}</span>{' '}
          <span className="tabular-nums">~{Math.round(shortest.hours)} h</span>
        </span>
        <span className="text-[13px] text-white/60">
          Longest · <span className="text-white">{longest.name}</span>{' '}
          <span className="tabular-nums">~{Math.round(longest.hours)} h</span>
        </span>
      </div>
    </section>
  );
}

export default function YearInReview() {
  const { year: yearParam } = useParams();
  const year = Number(yearParam);

  /* One piece of state carrying the year it describes, rather than a `stats`
     and a separate `state` that have to be reset together. Resetting them meant
     a setState in the effect body on every year change, and the two could
     disagree for a frame — long enough to render last year's totals under this
     year's heading. Which year the result is FOR is the fact that matters, so
     it is the fact that is stored. */
  const [result, setResult] = useState(null);
  const [years] = useState(completedYears);

  useEffect(() => {
    if (!Number.isInteger(year)) return;
    let alive = true;
    yearStats(year)
      .then(data => { if (alive) setResult({ year, data }); })
      .catch(() => { if (alive) setResult({ year, error: true }); });
    return () => { alive = false; };
  }, [year]);

  const showing = result && result.year === year ? result : null;
  const stats = showing?.data ?? null;
  const state = !Number.isInteger(year) ? 'bad-year'
    : !showing ? 'loading'
      : showing.error ? 'failed'
        : stats ? 'ready' : 'empty';

  const idx = years.findIndex(y => y.year === year);
  const newer = idx > 0 ? years[idx - 1] : null;
  const older = idx >= 0 && idx < years.length - 1 ? years[idx + 1] : null;

  const shell = (children) => (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        <nav className="flex flex-wrap items-center justify-between gap-4 mb-10">
          <Link
            to="/profile"
            className="tap lh-label text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors py-2 inline-block"
          >
            ← Profile
          </Link>
          {years.length > 1 && (
            <div className="flex items-center gap-5">
              {older && (
                <Link to={`/profile/year/${older.year}`} className="tap lh-label text-white/60 tabular-nums hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors py-2">
                  ← {older.year}
                </Link>
              )}
              {Number.isInteger(year) && <span className="tap lh-label text-white tabular-nums py-2">{year}</span>}
              {newer && (
                <Link to={`/profile/year/${newer.year}`} className="tap lh-label text-white/60 tabular-nums hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors py-2">
                  {newer.year} →
                </Link>
              )}
            </div>
          )}
        </nav>
        {children}
      </div>
    </div>
  );

  if (state === 'bad-year') {
    return shell(
      <div className="border border-white/15 p-6 max-w-2xl">
        <h1 className="lh-display text-4xl text-white m-0 mb-3">Year in Review</h1>
        <p className="text-sm text-white/60 m-0">That is not a year. Pick one from your profile.</p>
      </div>
    );
  }

  if (state === 'loading') {
    return shell(<p className="lh-label text-white/60">Reading your year…</p>);
  }

  if (state === 'failed' || state === 'empty') {
    return shell(
      <div className="border border-white/15 p-6 max-w-2xl">
        <h1 className="lh-display text-4xl lg:text-5xl text-white m-0 mb-3 tabular-nums">{year}</h1>
        <p className="text-sm text-white/60 m-0">
          {state === 'failed'
            ? 'Could not read that year. Try again in a moment.'
            : `Nothing finished in ${year} — or nothing from ${year} has a completion date on it yet.`}
        </p>
        {years.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-5">
            {years.map(y => (
              <Link
                key={y.year}
                to={`/profile/year/${y.year}`}
                className="lh-label px-4 py-3 border border-white/20 text-white/60 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
              >
                {y.year}
              </Link>
            ))}
          </div>
        ) : state === 'empty' && (
          /* No other year to offer either, so the chip row that normally
             rescues this page renders nothing and the sentence above is the
             whole screen. It names the completion date as the cause and then
             leaves you on a dead end with a back link — which is the one place
             a first-time visitor to this route is most likely to arrive, since
             the route is reachable by URL before any year exists. */
          <p className="text-sm text-white/60 mt-4 mb-0">
            The date lives on the game itself: open one you have finished and set{' '}
            <span className="text-white">Completed On</span>.{' '}
            <Link
              to="/library/beaten"
              className="text-white underline underline-offset-4 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
            >
              Your finished shelf
            </Link>
            .
          </p>
        )}
      </div>
    );
  }

  const s = stats;
  const untimed = s.timed.of - s.timed.covered;
  const monthPeak = Math.max(1, ...s.months.map(m => m.games));
  const emptyMonths = s.months.filter(m => m.games === 0).length;

  /* Where this year sits among the others. A total means nothing on its own —
     eighteen is either a huge year or a quiet one and only your own history
     says which. */
  const ranked = [...years].sort((a, b) => b.games - a.games);
  const rank = ranked.findIndex(y => y.year === year) + 1;
  const ahead = rank > 1 ? ranked[rank - 2] : null;
  const rankLine = years.length < 2 || !ORDINAL[rank] ? null
    : rank === 1
      ? 'Your biggest year so far.'
      : `Your ${ORDINAL[rank]} year, behind ${ahead.year}'s ${ahead.games}.`;

  const everyDays = Math.round(365 / s.count);

  const feelCounts = FEEL_ORDER
    .map(f => ({ key: f, count: s.games.filter(g => g.feel === f).length }))
    .filter(f => f.count > 0)
    .reverse();
  const unrated = s.games.filter(g => !g.feel).length;

  return shell(
    <>
      <header className="mb-16">
        <p className="lh-label text-white/60 m-0">Your year in games</p>
        {/* The page h1 and the biggest thing in it. Fluid the way AwardCeremony's
            h1 is, and capped at `display-hero` (80px) rather than the comp's
            150px — the ramp's ceiling exists so one page cannot quietly invent a
            size the rest of the app has no answer to, and four tabular digits at
            80px are already 200px of year. */}
        <h1
          className="lh-display text-white leading-[.95] tabular-nums m-0 mt-2"
          style={{ fontSize: 'clamp(56px, 13vw, 80px)' }}
        >
          {year}
        </h1>
        {/* No `normal-case` here: `.lh-display` sets uppercase from outside every
            cascade layer, so the utility would be struck through and dead — the
            same trap DESIGN.md records for label sizes. Uppercase is the house
            voice for display type and this reads as the headline it is. */}
        <p className="lh-display text-2xl lg:text-[32px] text-white leading-[1.25] max-w-[22ch] mt-7 m-0">
          You finished {nf.format(s.count)} {s.count === 1 ? 'game' : 'games'}
          {s.hours > 0 && <> — about <span style={{ color: BEATEN }} className="tabular-nums">{nf.format(s.hours)} hours</span> of play</>}.
        </p>
        <p className="text-[15px] text-white/60 mt-4 max-w-[52ch] leading-[1.6]">
          {s.count > 1 && `That's a finished game every ${everyDays} days. `}
          {rankLine}
          {s.hours > 0 && ' Hours are IGDB’s average time-to-beat'}
          {s.hours > 0 && (untimed > 0
            ? `; ${untimed} of the ${s.count} ${untimed === 1 ? 'is not' : 'are not'} timed yet.`
            : '.')}
        </p>
      </header>

      <section aria-labelledby="months-heading" className="mt-14">
        <h2 id="months-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">The shape of the year</h2>
        <p className="text-sm text-white/60 mt-0 mb-6">
          {s.busiest && s.busiest.games > 1
            ? `${s.busiest.label} alone held ${s.busiest.games} completions.`
            : `Spread evenly across ${year} — no month held more than one.`}
          {emptyMonths > 0 && ` ${emptyMonths} of the 12 months held nothing.`}
        </p>
        <div className={`flex items-end ${MONTH_GAP} h-32`}>
          {s.months.map(m => {
            const peak = m.games === monthPeak && m.games > 1;
            return (
              <div
                key={m.label}
                title={`${m.label} ${year}: ${m.games} finished`}
                className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1.5 h-full"
              >
                <span className="lh-label tabular-nums" style={{ color: peak ? BEATEN : '#fff' }}>{m.games || ''}</span>
                <span
                  className="draw-bar w-full min-h-[1px] block"
                  style={{
                    height: m.games ? `${(m.games / monthPeak) * 100}%` : 0,
                    background: peak ? BEATEN : 'rgba(255,255,255,.85)',
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className={`flex ${MONTH_GAP} mt-2`}>
          {s.months.map((m, i) => (
            <div key={m.label} className={MONTH_TICK_CELL}>
              <span className={monthNameClass(i)}>{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      <HoursPlot games={s.games} />

      <section aria-labelledby="superlatives-heading" className="mt-14">
        <h2 id="superlatives-heading" className="sr-only">The year in one line each</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {s.topStudio && s.topStudio.games > 1 && (
            <Stat
              label="Studio of the year"
              value={s.topStudio.name}
              detail={`${s.topStudio.games} of your ${s.count}`}
              to={s.topStudio.id != null ? `/games/company/${s.topStudio.id}` : null}
            />
          )}
          {s.topFranchise && s.topFranchise.games > 1 && (
            <Stat
              label="Series of the year"
              value={s.topFranchise.name}
              detail={`${s.topFranchise.games} entries this year`}
              to={s.topFranchise.id != null ? `/franchise/${s.topFranchise.id}` : null}
            />
          )}
          {s.decades.length > 0 && (
            /* The numerator is the top decade's count and the denominator is how
               many games had a release date at all, so the sentence has to name
               both. It read "10 of 18 with a known release date", which describes
               a quantity this line does not print — and sent me chasing a data bug
               that was never there. */
            <Stat
              label="Mostly from"
              value={`The ${s.decades[0].decade}s`}
              detail={`${s.decades[0].count} of the ${s.datedReleases} with a release date${
                s.datedReleases < s.count ? `, of ${s.count} finished` : ''
              }`}
            />
          )}
          {s.crowd && (
            <Stat
              label="The crowd agreed"
              value={`${s.crowd.avg} / 100`}
              detail={`Their average across ${s.crowd.n} of your ${s.count}`}
            />
          )}
        </div>
      </section>

      {feelCounts.length > 0 && (
        <section aria-labelledby="verdicts-heading" className="mt-14">
          <h2 id="verdicts-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">What you made of them</h2>
          <p className="text-sm text-white/60 mt-0 mb-6">
            All {s.count}, in the order you finished them.
            {' '}{feelCounts[0].count} got {feelCounts[0].key}
            {s.games.some(g => g.feel === 'Skip') ? '' : '; nothing got Skip'}.
          </p>
          {/* One square, one game, left to right in completion order — the same
              sequence the list at the bottom is in, so the two read as one
              object. A run of violet is a good month you can see. */}
          <div className="flex flex-wrap gap-1.5">
            {s.games.map((g, i) => (
              <span
                key={g.id}
                title={`${g.name} · ${g.feel || 'No verdict'}`}
                className="draw-cell w-8 h-8 block"
                style={{ '--i': Math.min(i, STAGGER_CAP), background: feelColor(g.feel) }}
              />
            ))}
          </div>
          <Legend items={feelCounts.map(f => ({ key: f.key, label: f.key, color: feelColor(f.key), count: f.count }))} />
          {unrated > 0 && (
            <p className="text-[13px] text-white/60 mt-3">
              {unrated} of the {s.count} {unrated === 1 ? 'has' : 'have'} no verdict yet.
            </p>
          )}
        </section>
      )}

      {s.loved.length > 0 && (
        <section aria-labelledby="loved-heading" className="mt-14">
          <h2 id="loved-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">
            {s.loved.length === 1 ? 'The one you loved' : `The ${s.loved.length} you loved`}
          </h2>
          <p className="text-sm text-white/60 mt-0 mb-6">
            {s.loved.length} of {s.count} got Perfection, your highest verdict.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {s.loved.map((g, i) => <Cover key={g.id} game={g} i={i} />)}
          </div>
        </section>
      )}

      <section aria-labelledby="all-heading" className="mt-14">
        <h2 id="all-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">Everything you finished, in order</h2>
        <p className="text-sm text-white/60 mt-0 mb-5">Verdict on the left, time-to-beat on the right</p>
        <ul className="list-none p-0 m-0">
          {s.games.map((g, i) => {
            const month = new Date(g.at).toLocaleDateString(undefined, { month: 'short' });
            const prev = i > 0 ? new Date(s.games[i - 1].at).getMonth() : -1;
            return (
              <li key={g.id} className="border-b border-white/15">
                <Link
                  to={`/game/${g.id}`}
                  className="flex items-center gap-4 py-3 px-1 -mx-1 text-white hover:bg-white hover:text-black transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  <span className="lh-label opacity-60 tabular-nums min-w-9 shrink-0">
                    {new Date(g.at).getMonth() === prev ? '' : month}
                  </span>
                  <Swatch color={feelColor(g.feel)} />
                  <span className="text-[15px] min-w-0 flex-1 break-words">{g.name}</span>
                  {/* Named as well as coloured, so the row carries its verdict
                      without the square (WCAG 1.4.1). Hidden on the narrowest
                      screens, where the swatch plus the legend above is what
                      there is room for.

                      The word inherits the row's colour rather than the feel's.
                      The row inverts to white on hover, and an inline colour
                      survives that inversion — "Go for it" green on white is
                      1.9:1, unreadable on exactly the row you are pointing at.
                      The 9px swatch is a fill, not text, so it carries the
                      colour through the inversion safely. */}
                  <span className="text-[13px] shrink-0 hidden sm:inline opacity-60">
                    {g.feel || ''}
                  </span>
                  <span className="lh-label opacity-60 tabular-nums min-w-14 text-right shrink-0">
                    {g.hours === null ? '—' : `~${Math.round(g.hours)} h`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {(newer || older) && (
        <nav aria-label="Other years" className="flex items-center justify-between gap-4 border-t border-white/15 mt-14 pt-6">
          {older ? (
            <Link to={`/profile/year/${older.year}`} className="tap text-sm text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors py-2">
              ← {older.year} · {older.games} {older.games === 1 ? 'game' : 'games'}
            </Link>
          ) : <span />}
          {newer && (
            <Link to={`/profile/year/${newer.year}`} className="tap text-sm text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors py-2 ml-auto">
              {newer.year} · {newer.games} {newer.games === 1 ? 'game' : 'games'} →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
