import { Link } from 'react-router-dom';
import { FEEL_ORDER, PRIORITY_ORDER } from '../../services/libraryStats';
import { statusColor, feelColor, feelTextColor, priorityColor } from '../../constants/stateColors';
import { Card, Swatch, Legend, ScrollX } from './parts';
import { MONTH_GAP, MONTH_TICK_CELL, monthNameClass } from './monthAxis';

/* Band B — the library in numbers.
 *
 * Always true, always current, dense, no ceremony. This is the band you come to
 * check, which is why it is counts and proportions and not a story; the story is
 * the yearly view and it lives on its own route.
 *
 * Nothing here fetches. Every figure is derived from fields already on the
 * library entries, so the band paints on first render with no spinner and no
 * empty state to design around.
 *
 * Where a figure is incomplete it says so on the same line rather than in a
 * footnote. Hours come from IGDB's time-to-beat, which is missing on some
 * entries — measured, 59 of 66 Beaten — so the total is prefixed "about" and
 * the shortfall is printed. A number that quietly under-counts is worse than no
 * number, because you cannot tell which one you are looking at.
 *
 * The colour is the three sanctioned state scales and nothing else. A shelf
 * split drawn in six greys is unreadable at a glance and the six shelves already
 * own six colours everywhere else in the app; borrowing them here is the same
 * fact in the same paint, not decoration. Every colour is repeated in a legend
 * that names it, so nothing depends on seeing hue (WCAG 1.4.1).
 */

const nf = new Intl.NumberFormat();

/* The Beaten shelf's own colour. Every completion chart on this page is made of
   Beaten games, so the accent is the shelf, not decoration — and it is the same
   value the year page gives its total. */
const BEATEN = statusColor('Beaten');

/** The tallest dot stack a 150px column can hold once the count above it has
 *  taken its 17px: 10 x 9 + 9 x 3 + 17 = 134. Above this the month row stops
 *  counting in dots and starts drawing bars — see the chart for why. */
const MAX_DOTS = 10;

/** The label-plus-bar row the verdict and priority breakdowns share. */
function ScaleRow({ label, count, of, color, textColor }) {
  const pct = of > 0 ? Math.round((count / of) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <Swatch color={color} />
      <span className="text-sm w-[92px] shrink-0" style={{ color: textColor || 'rgba(255,255,255,.85)' }}>{label}</span>
      <span className="flex-1 min-w-0 h-2 block bg-white/10" aria-hidden="true">
        <span className="block h-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="text-sm text-white tabular-nums min-w-7 text-right shrink-0">{nf.format(count)}</span>
    </div>
  );
}

/* `pending` is the case where the figure has no basis at all — not a small
   number, an absent one. It renders the dash instead of the value, which is
   what Backlog weight already did for an empty backlog shelf and what the other
   two cards did not: a library of one game printed "0 h" and "0%" at 72px, and
   a fresh library built the way Explore invites you to build one — every game
   wishlisted, none shelved — printed "you finish 0% of the games you commit to"
   about someone who had not yet committed to any.

   The dash is the file's own existing answer and it stays at full white rather
   than dimming to `state-none`: at 11px-to-72px this is the value slot, and a
   value slot at 2.4:1 is unreadable exactly when it is carrying the news that
   there is nothing to read. The caption below it does the explaining, and it
   leads with what would fill the card. */
function Figure({ label, value, unit, detail, className = '', big, pending }) {
  return (
    <div className={`border border-white/15 p-4 lg:p-6 min-w-0 ${className}`}>
      <div className="lh-label text-white/60">{label}</div>
      <div className={`lh-display text-white leading-none tabular-nums mt-3 ${big ? 'text-5xl lg:text-7xl' : 'text-4xl lg:text-5xl'}`}>
        {pending ? <span className="lh-label text-white/40">Not enough data</span> : value}
        {!pending && unit && <span className={`text-white/60 ${big ? 'text-3xl lg:text-5xl' : 'text-2xl lg:text-3xl'}`}> {unit}</span>}
      </div>
      <p className="text-[13px] text-white/60 mt-4 m-0 leading-[1.6]">{detail}</p>
    </div>
  );
}

/** "about nine months" — a backlog measured in hours means nothing until it is
 *  measured in the only currency that matters, which is how long it will take
 *  you specifically. */
const spanText = (months) => {
  if (months < 1) return 'under a month';
  if (months < 2) return 'about a month';
  if (months < 24) return `about ${Math.round(months)} months`;
  return `about ${Math.round(months / 12)} years`;
};

export default function LibraryNumbers({ stats: s }) {
  if (s.total === 0) {
    return (
      <section aria-labelledby="numbers-heading" className="mt-12 max-w-2xl">
        <h2 id="numbers-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-4">Your Library</h2>
        <div className="border border-white/15 p-6">
          <p className="text-sm text-white/60 m-0">
            Nothing shelved yet. Add a game and this fills in — hours played, what you
            finish, what you drop, and where your library lives.
          </p>
        </div>
      </section>
    );
  }

  const { hoursBeaten: hb, hoursBacklog: bl, completions: c } = s;
  const shelfRows = Object.entries(s.shelves).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const shelfTotal = shelfRows.reduce((a, [, n]) => a + n, 0);

  const feelTotal = FEEL_ORDER.reduce((a, f) => a + (s.feels[f] || 0), 0);
  const feelPeak = Math.max(1, ...FEEL_ORDER.map(f => s.feels[f] || 0));
  const prioTotal = PRIORITY_ORDER.reduce((a, p) => a + (s.priorities[p] || 0), 0);
  const prioPeak = Math.max(1, ...PRIORITY_ORDER.map(p => s.priorities[p] || 0));

  const followPct = s.started > 0 ? Math.round((s.completed / s.started) * 100) : 0;
  const dropPct = s.started > 0 ? Math.round((s.droppedCount / s.started) * 100) : 0;

  /* The pace the backlog is divided by is a real year, named, rather than a
     lifetime average that flatters a year you did not have. The most recent
     complete calendar year is the honest one: this year is a fraction of a year
     and would make the backlog look years deep in January. */
  const thisYear = new Date().getFullYear();
  const paceYear = [...c.byYear].reverse().find(y => y.year < thisYear && y.hours > 0)
    ?? [...c.byYear].reverse().find(y => y.hours > 0)
    ?? null;
  const backlogSpan = paceYear && bl.hours > 0 ? spanText((bl.hours / paceYear.hours) * 12) : null;

  const yearPeak = Math.max(1, ...c.byYear.map(y => y.games));
  const soleBestYear = c.byYear.filter(y => y.games === yearPeak).length === 1;
  const monthPeak = Math.max(1, ...c.byMonth.map(m => m.games));
  /* Can every month still be drawn as one dot per game? The moment the busiest
     one cannot, dots stop being a count and become a cap, so the whole row
     changes form rather than quietly flattening. */
  const countable = monthPeak <= MAX_DOTS;
  const busiestMonth = c.byMonth.reduce((a, m) => (m.games > a.games ? m : a), c.byMonth[0]);
  const busiestYear = c.byYear.reduce((a, y) => (y.games > a.games ? y : a), c.byYear[0] || null);
  const yearsDesc = [...c.byYear].reverse();

  return (
    <>
      <section aria-labelledby="glance-heading" className="mt-12">
        <h2 id="glance-heading" className="sr-only">Your library at a glance</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* The one figure worth setting at display size. "About" is not hedging —
              the hours are IGDB's community average for each game, not a clock
              that ran while you played, and the page should never imply otherwise. */}
          <Figure
            big
            className="lg:col-span-2"
            label="Time played, about"
            pending={hb.covered === 0}
            value={nf.format(hb.hours)}
            unit="h"
            detail={
              hb.covered === 0
                ? (s.completed === 0
                  ? "This sums IGDB's average time-to-beat across the games you move to Beaten. Nothing on that shelf yet."
                  : `IGDB has no time-to-beat yet for any of the ${nf.format(s.completed)} ${s.completed === 1 ? 'game' : 'games'} you finished, so there is nothing to sum.`)
                : `IGDB's average time-to-beat, summed over the ${nf.format(s.completed)} ${s.completed === 1 ? 'game' : 'games'} you finished.`
                  + (hb.covered < hb.of ? ` ${hb.of - hb.covered} of them ${hb.of - hb.covered === 1 ? 'is' : 'are'} not timed yet.` : '')
            }
          />
          <Figure
            label="Follow-through"
            pending={s.started === 0}
            value={`${followPct}%`}
            detail={
              s.started === 0
                ? 'Wishlisted and unreleased games do not count towards this. Move one to Playing, Backlog or Beaten and it starts keeping score.'
                : `You finish ${nf.format(s.completed)} of the ${nf.format(s.started)} games you commit to. `
                  + `${nf.format(s.droppedCount)} dropped — a ${dropPct}% drop rate. Wishlisted and unreleased do not count.`
            }
          />
          <Figure
            label="Backlog weight"
            pending={!(bl.hours > 0)}
            value={bl.hours > 0 ? `~${nf.format(bl.hours)}` : null}
            unit={bl.hours > 0 ? 'h' : null}
            detail={
              bl.of === 0
                ? 'Nothing on the backlog shelf.'
                : `${nf.format(bl.of)} backlogged ${bl.of === 1 ? 'game' : 'games'}, end to end.`
                  + (backlogSpan ? ` At your ${paceYear.year} pace, ${backlogSpan}.` : '')
                  + (bl.covered < bl.of ? ` ${bl.of - bl.covered} not timed.` : '')
            }
          />
        </div>
      </section>

      <section aria-labelledby="shelves-heading" className="mt-12">
        <h2 id="shelves-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">Where everything sits</h2>
        <p className="text-sm text-white/60 mt-0 mb-5">
          {nf.format(s.total)} {s.total === 1 ? 'entry' : 'entries'} across {shelfRows.length} {shelfRows.length === 1 ? 'shelf' : 'shelves'}
        </p>
        {/* Proportional, so the shape of the library is the thing you read first —
            the exact counts are one line below and are what anyone actually
            quotes.

            A picture, not a control. Each segment was briefly a link to its
            shelf, which is a fine idea and an impossible target: Playing is 2 of
            236, which is eight pixels wide at this width and fails 2.5.8 by a
            factor of three. Widening it to a legal 24px would have made the one
            thing the bar is for — proportion — a lie. The shelves are one click
            away in the rail either way. */}
        <div className="draw-unroll flex gap-0.5 h-9" role="img" aria-labelledby="shelf-split-text">
          {shelfRows.map(([name, n]) => (
            <div
              key={name}
              title={`${name}: ${nf.format(n)}`}
              className="min-w-[3px]"
              style={{ flex: `${n} 1 0%`, background: statusColor(name) }}
            />
          ))}
        </div>
        <Legend items={shelfRows.map(([name, n]) => ({ key: name, label: name, color: statusColor(name), count: nf.format(n) }))} />
        <p id="shelf-split-text" className="sr-only">
          Shelf split: {shelfRows.map(([name, n]) => `${name} ${n}`).join(', ')}, of {nf.format(shelfTotal)}.
        </p>
      </section>

      <section aria-labelledby="verdicts-heading" className="mt-12">
        <h2 id="verdicts-heading" className="sr-only">Verdicts and priorities</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {feelTotal > 0 && (
            <Card
              headingId="feels-heading"
              title="What you thought of them"
              note={`Your verdict on ${nf.format(feelTotal)} of the ${nf.format(s.completed)} you finished`}
            >
              {/* Scaled against the largest verdict, not the total. Against the
                  total every bar on a four-way split is short and they all look
                  the same; against the peak the shape of your taste is the
                  first thing on the row. */}
              {[...FEEL_ORDER].reverse().map(f => (
                <ScaleRow
                  key={f}
                  label={f}
                  count={s.feels[f] || 0}
                  of={feelPeak}
                  color={feelColor(f)}
                  textColor={feelTextColor(f)}
                />
              ))}
            </Card>
          )}

          {prioTotal > 0 && (
            <Card
              headingId="prios-heading"
              title="What you mean to play"
              note={`${nf.format(prioTotal)} unfinished ${prioTotal === 1 ? 'game carries' : 'games carry'} a priority`}
            >
              {PRIORITY_ORDER.map(p => (
                <ScaleRow
                  key={p}
                  label={p}
                  count={s.priorities[p] || 0}
                  of={prioPeak}
                  color={priorityColor(p)}
                />
              ))}
            </Card>
          )}
        </div>
      </section>

      {/* Finished games, none of them dated. The whole history section below is
          gated on `byYear`, so this user saw nothing at all — no heading, no
          year cards, no route to Year in Review — and nothing anywhere told them
          the feature existed or that one optional field is what stands between
          them and it. The date input only appears on a game already marked
          Beaten, which makes it findable by accident and by nothing else.

          Not a nag and not a checklist: the section it is standing in for,
          holding its place until it has data, saying which field fills it and
          where that field is. It disappears the moment one date exists. */}
      {c.byYear.length === 0 && c.of > 0 && (
        <section aria-labelledby="history-pending-heading" className="mt-12">
          <h2 id="history-pending-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">
            Years of finishing games
          </h2>
          <p className="text-sm text-white/60 mt-0 mb-5">
            Not yet — no completion date on {c.of === 1 ? 'the one game' : `any of the ${nf.format(c.of)} games`} you have finished
          </p>
          <div className="border border-white/15 p-6 max-w-2xl">
            <p className="text-[13px] text-white/60 m-0 leading-[1.6]">
              Open a finished game and set <span className="text-white">Completed On</span>. One date makes that
              year&rsquo;s review — what you finished, how long it took, when in the year you finished it, and how
              your verdicts fell.
            </p>
            <Link
              to="/library/beaten"
              className="tap lh-label text-white mt-5 inline-flex border border-white/40 px-4 py-2.5 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
            >
              Your finished shelf &rarr;
            </Link>
          </div>
        </section>
      )}

      {c.byYear.length > 0 && (
        <section aria-labelledby="history-heading" className="mt-12">
          <h2 id="history-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">
            {c.byYear.length === 1 ? 'A year of finishing games' : `${c.byYear.length} years of finishing games`}
          </h2>
          <p className="text-sm text-white/60 mt-0 mb-5">
            {nf.format(c.dated)} dated {c.dated === 1 ? 'completion' : 'completions'} since {c.byYear[0].year}
            {busiestYear && busiestYear.games > 1 && ` · busiest year ${busiestYear.year}`}
            {busiestMonth.games > 0 && ` · busiest month ${busiestMonth.label}`}
            {c.dated < c.of && ` · ${c.of - c.dated} finished ${c.of - c.dated === 1 ? 'game has' : 'games have'} no completion date`}
          </p>

          <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
            <Card className="draw-scope" headingId="by-year-heading" title="Games finished by year">
              {/* The best year wears the Beaten colour, the same one the year
                  page gives its total. Only when it is a clear winner: a tie
                  painted twice says "your best year" about two of them. */}
              {/* Scrolled, and the floor grows with the data. This row cannot
                  shrink past its own labels — "5,244h" needs 35px — so at eight
                  years in a 309px card it stopped shrinking and pushed the whole
                  PAGE 69px sideways at 375. A chart with more years than fit is
                  a chart you scroll, not a page that breaks. */}
              <ScrollX min={Math.max(260, c.byYear.length * 46)} label="Games finished by year">
                <div className="flex items-end gap-2 h-[150px]">
                  {c.byYear.map(y => {
                    const peak = y.games === yearPeak && soleBestYear;
                    return (
                      <div key={y.year} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1.5 h-full">
                        <span className="lh-label tabular-nums" style={{ color: peak ? BEATEN : '#fff' }}>{y.games}</span>
                        <div
                          title={`${y.year}: ${y.games} ${y.games === 1 ? 'game' : 'games'}${y.covered > 0 ? `, about ${nf.format(y.hours)} hours` : ''}${peak ? ' — your best year' : ''}`}
                          className="draw-bar w-full min-h-[2px]"
                          style={{ height: `${(y.games / yearPeak) * 100}%`, background: peak ? BEATEN : 'rgba(255,255,255,.85)' }}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* The hours line is not `.lh-label`: its 0.18em track made
                    "5,244h" need 49px in a 35px column, and the class pins the
                    size so no utility could bring it back. */}
                <div className="flex gap-2 mt-2">
                  {c.byYear.map(y => (
                    <div key={y.year} className="flex-1 min-w-0 text-center">
                      <div className="lh-label text-white/60 tabular-nums">&rsquo;{String(y.year).slice(2)}</div>
                      <div className="font-sans font-medium text-[10px] leading-none tracking-[0.02em] text-white/60 tabular-nums mt-1.5">
                        {y.covered > 0 ? `${nf.format(y.hours)}h` : <span className="text-white/40">no hours</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollX>
            </Card>

            {/* The question the year bars cannot answer: not which years you
                finished things in, but which part of a year you finish things
                in, whatever the year.

                One dot, one game — while that is literally true. Past MAX_DOTS
                the column cannot hold another dot, and capping it was a lie the
                chart told with a straight face: measured on a 227-completion
                library, April's 99 drew the same ten dots as June's nine, so
                every month looked identical and the one real pattern in the data
                was invisible. Above the dot budget the whole row switches to
                proportional bars and the caption switches with it. A chart that
                cannot say something true at this size should change form, not
                keep the form and drop the truth. */}
            <Card
              headingId="by-month-heading"
              title="When in the year you finish — all years combined"
              note={`${countable ? 'One dot, one finished game.' : 'Bars are to scale against your busiest month.'}${
                busiestMonth.games > 1 ? ` ${busiestMonth.label} is your busiest month, ${nf.format(busiestMonth.games)} across every year.` : ''
              }`}
            >
              <div className={`flex items-end ${MONTH_GAP} h-[150px]`}>
                {c.byMonth.map(m => (
                  <div
                    key={m.label}
                    title={`${m.label}: ${nf.format(m.games)} finished across all years`}
                    className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1.5 h-full"
                  >
                    <span className="lh-label text-white tabular-nums">{m.games || ''}</span>
                    {countable ? (
                      <span className="flex flex-col gap-[3px] w-full items-center" aria-hidden="true">
                        {Array.from({ length: m.games }, (_, i) => (
                          <span key={i} className="draw-dot w-[9px] h-[9px] shrink-0" style={{ '--i': i, background: BEATEN }} />
                        ))}
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="draw-bar w-full block"
                        style={{ height: `${(m.games / monthPeak) * 100}%`, background: BEATEN }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className={`flex ${MONTH_GAP} mt-2`}>
                {c.byMonth.map((m, i) => (
                  <div key={m.label} className={MONTH_TICK_CELL}>
                    <span className={monthNameClass(i)}>{m.label}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Every year gets a card, not the five that fit a row. A year the
              chart above draws a bar for and this grid has no way into is a
              dead end, and 2020's single game still has a longest, a verdict
              and a month. */}
          <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mt-4 list-none p-0 m-0">
            {yearsDesc.map(y => (
              <li key={y.year} className="min-w-0">
                <Link
                  to={`/profile/year/${y.year}`}
                  className="h-full border border-white/15 p-4 lg:p-5 flex flex-col text-white hover:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
                >
                  <span className="lh-display text-[28px] text-white leading-none tabular-nums">{y.year}</span>
                  <span className="text-[13px] text-white/60 mt-3">
                    {y.games} beaten{y.covered > 0 && ` · ~${nf.format(y.hours)} h`}
                  </span>
                  <span className="text-[13px] text-white/50 mt-1 min-h-[1.5em]">
                    {[
                      y.peakMonth && `Busiest ${y.peakMonth}`,
                      y.loved > 0 && `${y.loved} called Perfection`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  <span className="lh-label text-white/60 mt-auto pt-4">Year in review →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
