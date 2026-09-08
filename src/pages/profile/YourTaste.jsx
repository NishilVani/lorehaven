import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { tasteStats } from '../../services/tasteStats';
import { getPrefs, setPrefs } from '../../services/db';
import DialGroup from '../../components/ui/DialGroup';
import { TASTE, ERA } from '../../constants/prefs';
import { feelColor, feelTextColor, priorityColor } from '../../constants/stateColors';
import { Card, Swatch, ScrollX } from './parts';

/* Band C — what the library says about you, and what you have told it to do
 * about that.
 *
 * The only band that fetches. Crowd scores land on a library entry only once
 * something has rendered that game, so on the raw library the priority
 * comparison ran on 25 of 134 games. One cached getGamesByIds closes the gap —
 * see tasteStats for why the result is not written back.
 *
 * The two comparisons used to be separate cards of separate bars, which meant
 * the one question they exist to answer — do your instincts before playing track
 * your verdicts after — required reading two scales and doing the subtraction
 * yourself. They share one axis now. That also fixed a quieter lie: a bar chart
 * scaled from zero made an 86.6 and an 83.1 look like near-identical bars, when
 * the whole interesting fact is that the crowd sees almost no gap where you drew
 * a hard line.
 *
 * The two recommendation dials sit here rather than in a menu-launched modal
 * because this is the band that explains what they act on: the studios and
 * franchises above them are exactly what "more like my favourites" means.
 */

/* Below this many games an average is an anecdote. It is still shown — hiding it
 * would be a different kind of lie — but it is drawn as one. */
const MIN_SAMPLE = 5;

/** Whole multiples of 5, wide enough to hold every dot with air either side.
 *  Hardcoding 65–90 would silently push a dot off the end of its own chart the
 *  first time a library disagreed with the one this was designed against. */
function scaleOf(rows) {
  const vals = rows.map(r => r.avg);
  if (!vals.length) return null;
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...vals) + 4) / 5) * 5);
  const span = Math.max(5, hi - lo);
  const step = span / 5;
  return {
    lo,
    hi: lo + span,
    ticks: Array.from({ length: 6 }, (_, i) => Math.round(lo + step * i)),
    at: (v) => ((v - lo) / span) * 100,
  };
}

/* One lane is a name, a dot and a value stacked: about 50px, so 56 with air. */
const LANE_H = 56;

/**
 * How much horizontal room, as a percentage of the track, two stacks need
 * before they can share a lane.
 *
 * The track is never narrower than the ScrollX minimum less its gutters — about
 * 440px — and the widest bucket name ("Perfection") sets about 70px of label,
 * half of it either side of the dot. 18% of 440 is 79px, so two stacks that
 * clear this cannot touch at any width the chart is ever drawn at.
 */
const LANE_GAP = 18;

/**
 * The comp's layout: every bucket in a group on ONE axis line, its name above
 * the dot and the crowd's score below, so the row reads left to right as "who
 * the crowd liked least, through to most".
 *
 * The lanes are the one addition. Drawn flat, this collapses on exactly the data
 * it exists to show — the finding is that your verdicts sit within a few points
 * of each other, and a few points is also the distance at which "Perfection" and
 * "Go for it" print on top of one another. So a stack that cannot clear its
 * neighbour drops to a second lane instead. The dot never moves off its true
 * value; only the row gets taller.
 */
function DotGroup({ label, rows, scale, colorOf, textColorOf }) {
  if (!rows.length) return null;

  /* Ascending, so "furthest right is best" is also the reading order, and so the
     lane search can assume the last x placed in a lane is its largest. */
  const lastX = [];
  const placed = [...rows].sort((a, b) => a.avg - b.avg).map(r => {
    const x = scale.at(r.avg);
    let lane = 0;
    while (lastX[lane] !== undefined && x - lastX[lane] < LANE_GAP) lane++;
    lastX[lane] = x;
    return { ...r, x, lane };
  });
  const height = lastX.length * LANE_H;

  return (
    <>
      <div className="lh-label text-white/60 mt-5 mb-2">{label}</div>
      <div
        className="relative border-r border-white/15"
        style={{
          height,
          backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
          backgroundSize: '20% 100%',
        }}
      >
        {placed.map(r => {
          const thin = r.n < MIN_SAMPLE;
          return (
            <div
              key={r.key}
              title={`${r.key}: crowd average ${r.avg} across ${r.n} ${r.n === 1 ? 'game' : 'games'}`}
              className="absolute -translate-x-1/2 flex flex-col items-center gap-1"
              style={{ left: `${r.x}%`, top: r.lane * LANE_H + 3 }}
            >
              <span className="text-[13px] whitespace-nowrap leading-none" style={{ color: textColorOf(r.key) }}>{r.key}</span>
              <span
                aria-hidden="true"
                className="block"
                style={{
                  width: thin ? 9 : 14,
                  height: thin ? 9 : 14,
                  background: colorOf(r.key),
                  opacity: thin ? 0.55 : 1,
                }}
              />
              <span className="text-[13px] text-white tabular-nums leading-none">{r.avg}</span>
            </div>
          );
        })}
      </div>
      {/* The chart is a picture of this; this is the chart for anyone not
          reading pictures, and it is where the sample size lives in full. */}
      <p className="sr-only">
        {label}. {placed.map(r => `${r.key}: ${r.avg} out of 100, across ${r.n} ${r.n === 1 ? 'game' : 'games'}`).join('. ')}.
      </p>
    </>
  );
}

/**
 * @param {(row) => string|null} [href] — where this name goes. Null for a row
 *   whose IGDB id never arrived: both destinations are addressed by id, and an
 *   entry's own cached metadata carries none, so offline the row is still a row
 *   rather than a link into a route that cannot resolve.
 */
function NameRows({ rows, empty, dotColor, href }) {
  if (!rows.length) return <p className="text-sm text-white/60 m-0">{empty}</p>;
  return (
    <ul className="list-none p-0 m-0">
      {rows.map(r => {
        const to = href?.(r) || null;
        const name = to
          ? (
            <Link
              to={to}
              className="tap text-sm text-white min-w-0 flex-1 break-words hover:underline underline-offset-[3px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white py-1"
            >
              {r.name}
            </Link>
          )
          : <span className="text-sm text-white min-w-0 flex-1 break-words">{r.name}</span>;
        return (
          <li key={r.name} className="flex items-center gap-3 border-b border-white/15 py-2 last:border-b-0">
            {name}
            {dotColor && r.loved > 0 && (
              <span className="flex gap-[3px] shrink-0" title={`${r.loved} you called Perfection`}>
                {Array.from({ length: Math.min(r.loved, 6) }, (_, i) => <Swatch key={i} color={dotColor} size={8} />)}
                <span className="sr-only">{r.loved} called Perfection</span>
              </span>
            )}
            <span className="lh-label text-white/60 tabular-nums shrink-0 whitespace-nowrap">
              {r.games} {r.games === 1 ? 'game' : 'games'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function YourTaste() {
  const [stats, setStats] = useState(null);
  const [failed, setFailed] = useState(false);
  const [prefs, setLocal] = useState(getPrefs);
  /* Off the critical path, but not conditional on being seen.
   *
   * This band is the only one that fetches, and it used to do so during mount:
   * measured on a 2,116-entry library, tasteStats cost 1,856ms — most of it
   * synchronous cache reads and JSON parsing — and every profile visit paid it
   * in long tasks before you could touch the counts at the top, which need no
   * network at all. Narrowing the fetch to the entries the figures actually read
   * took that to 63ms, and running it when the browser is idle takes what is
   * left off the path to first interaction. Measured after: 0ms of blocking time
   * on a profile visit.
   *
   * An IntersectionObserver on the band was the first shape of this, and it was
   * the wrong one twice over. It buys nothing now the work is 63ms, and it makes
   * the content conditional on a callback that some environments never deliver —
   * a hidden or headless renderer fires no intersections at all, and the band
   * sat on "Reading your library…" permanently. Idle time always arrives; a
   * viewport crossing does not.
   */
  useEffect(() => {
    let alive = true;
    const run = () => {
      tasteStats()
        .then(s => { if (alive) setStats(s); })
        .catch(() => { if (alive) setFailed(true); });
    };
    /* The timeout is the ceiling, not the target: on a busy page idle may never
       come on its own, and the band must not wait for quiet that never arrives. */
    const idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(run, { timeout: 2000 })
      : setTimeout(run, 1);
    return () => {
      alive = false;
      if (typeof cancelIdleCallback === 'function' && typeof requestIdleCallback === 'function') cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, []);

  /* Written on every change, same as the dialog: there is nothing to validate
     and nothing to lose, and the next thing you do is go and look at Explore. */
  const update = (patch) => setLocal(setPrefs(patch));

  /* One scale over both rows or the comparison is meaningless — that is the
     entire point of putting them under each other. */
  const scale = stats ? scaleOf([...stats.byFeel, ...stats.byPriority]) : null;
  const thin = stats && [...stats.byFeel, ...stats.byPriority].some(r => r.n < MIN_SAMPLE);

  return (
    <section aria-labelledby="taste-heading" className="mt-12">
      <h2 id="taste-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">Your taste</h2>
      <p className="text-sm text-white/60 mt-0 mb-5">What the finished shelf says about you</p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Two different nothings, and they used to print the same sentence.
            Asking IGDB and getting nothing back is an outage. Never asking —
            because no game in the library qualifies yet — is just a new library,
            and blaming the network for it sent a user to check their connection
            over a page that was working perfectly. */}
        {failed || (stats && stats.askedIgdb && !stats.reachedIgdb && stats.studios.length === 0) ? (
          <Card className="md:col-span-2" headingId="taste-offline" title="Studios and franchises">
            <p className="text-sm text-white/60 m-0">
              Could not reach IGDB, so there is nothing to rank yet. This fills in
              next time the app can fetch.
            </p>
          </Card>
        ) : stats && !stats.askedIgdb && stats.studios.length === 0 ? (
          <Card className="md:col-span-2" headingId="taste-waiting" title="Studios and franchises">
            <p className="text-sm text-white/60 m-0">
              This ranks the studios and series behind the games you play, and reads from
              anything you have marked Playing or Beaten, or given a priority. Nothing in
              your library qualifies yet.
            </p>
          </Card>
        ) : !stats ? (
          <Card className="md:col-span-2" headingId="taste-loading" title="Studios and franchises">
            <p className="text-sm text-white/60 m-0">Reading your library…</p>
          </Card>
        ) : (
          <>
            {scale && (
              <Card className="md:col-span-2" headingId="crowd-heading" title="You against everyone else">
                <p className="text-sm text-white/60 mt-0 mb-5 max-w-[72ch]">
                  Each dot is the crowd&rsquo;s average rating, out of 100, for one group of your
                  games — further right means the crowd rated that group higher. Both groups
                  share one scale, so you can read the two against each other: the top rows are
                  finished games by the verdict you gave them, the bottom rows unplayed ones by
                  the priority you set before playing.
                </p>

                <ScrollX min={520} label="Crowd rating by verdict and by priority">
                  {/* A dot sits ON its value, so the two end dots straddle the
                      ends of the axis and their names need somewhere to be. The
                      gutter is outside the plot rather than taken out of the
                      scale, so the gridlines and the ticks below them still
                      describe the same positions the dots were placed against. */}
                  <div className="px-10">
                    <DotGroup
                      label="After playing — your verdicts"
                      rows={stats.byFeel}
                      scale={scale}
                      colorOf={feelColor}
                      textColorOf={feelTextColor}
                    />
                    <DotGroup
                      label="Before playing — your priorities"
                      rows={stats.byPriority}
                      scale={scale}
                      colorOf={priorityColor}
                      textColorOf={priorityColor}
                    />
                    <div className="flex justify-between border-t border-white/15 mt-3 pt-2">
                      {scale.ticks.map((t, i) => (
                        <span key={t} className="lh-label text-white/50 tabular-nums">
                          {i === 3 ? `crowd rating · ${t}` : t}
                        </span>
                      ))}
                    </div>
                  </div>
                </ScrollX>

                {/* A sentence, not a label. `.lh-label` is an 11px uppercase
                    0.18em track and three lines of it is a barcode. */}
                {/* Capped like the paragraph above it. Uncapped this ran the full
                    width of a two-column card: measured 110ch at 1280 and 135ch at
                    1600, so it got worse the more room it was given, while its
                    sibling four elements up sat correctly at 71ch. */}
                <p className="text-[13px] text-white/60 mt-5 leading-[1.6] max-w-[72ch]">
                  {thin && `A small faint dot is fewer than ${MIN_SAMPLE} games — an average, but not yet a pattern. `}
                  Scored for {stats.coverage.rated} of {stats.coverage.of} entries; a game the crowd has not
                  rated cannot be in either row.
                </p>
              </Card>
            )}

            <Card
              headingId="studios-heading"
              title="Studios you keep going back to"
              note="Ranked the way the recommender ranks them — a game you called Perfection counts triple, a finished one double, a dropped one not at all"
            >
              <NameRows
                rows={stats.studios}
                dotColor={feelColor('Perfection')}
                href={r => (r.id != null ? `/games/company/${r.id}` : null)}
                empty="Nothing to rank yet. Finish a few games and this fills in."
              />
            </Card>

            <Card
              headingId="franchises-heading"
              title="Series you keep going back to"
              note={stats.reachedIgdb ? null : 'From what was already cached — IGDB was not reachable'}
            >
              <NameRows
                rows={stats.franchises}
                href={r => (r.id != null ? `/franchise/${r.id}` : null)}
                empty="No series repeats in your library yet."
              />
            </Card>
          </>
        )}

        <Card className="md:col-span-2" headingId="suggest-heading" title="What we suggest you play">
          <p className="text-sm text-white/60 mt-0 mb-5 max-w-[65ch]">
            These two apply to Explore and to Pick For Me. They act on the taste above.
          </p>
          <div className="grid gap-x-10 md:grid-cols-2">
            <DialGroup
              legend="Taste"
              blurb="How close to your existing taste should suggestions stay?"
              options={TASTE}
              value={prefs.tasteBias}
              onChange={(v) => update({ tasteBias: v })}
            />
            <DialGroup
              legend="Era"
              blurb="Favour games from a particular stretch of time."
              options={ERA}
              value={prefs.releaseEra}
              onChange={(v) => update({ releaseEra: v })}
            />
          </div>
          <Link
            to="/feedback"
            className="tap lh-label text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors inline-block py-2"
          >
            Games you marked Interested or Not Interested →
          </Link>
        </Card>
      </div>
    </section>
  );
}
