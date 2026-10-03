import Figure from '../ui/Figure';
import { SectionHeader, Line } from './parts';

/* The lead block: the first thing under the tracker bar, and the only part of
 * the game page that changes with your relationship to the game.
 *
 * The page used to answer one question for five different visitors. Someone
 * deciding whether to play it, someone planning when, someone halfway through,
 * someone who finished it and someone waiting for it all got the same nine-row
 * metadata table, with a few rows switched off. Each now gets the block that
 * answers their question, and everything below it stays where it was.
 *
 *   decide   not shelved, released      — is this for me?
 *   plan     Wishlist / Backlog          — when, against what else is queued?
 *   playing  Playing                     — where did I leave off?
 *   record   Beaten / Dropped            — what did I make of it?
 *   waiting  not out yet                 — when, and how much is it wanted?
 *
 * Every figure is counted, never estimated. A figure with nothing true to say
 * renders the No-Zero statement and a caption saying what would fill it. */

function ScoreFigure({ score }) {
  if (!score) {
    return <Figure size="sm" label="Public Score" pending pendingText="No score yet" detail="Nobody has rated it on IGDB yet." />;
  }
  if (score.thin) {
    return (
      <Figure
        size="sm"
        label="Public Score"
        pending
        pendingText="Too few ratings to say"
        detail={`${score.count} ${score.count === 1 ? 'rating' : 'ratings'} so far. Below ${score.floor} the number is noise.`}
      />
    );
  }
  return (
    <Figure
      size="sm"
      label="Public Score"
      value={score.value}
      unit="/ 100"
      detail={[`${score.count.toLocaleString()} ratings`, score.critics].filter(Boolean).join(' · ')}
    />
  );
}

function LengthFigure({ length, against }) {
  if (!length) {
    return <Figure size="sm" label="Length" pending pendingText="Not measured yet" detail="IGDB has no time to beat for it." />;
  }
  return (
    <Figure
      size="sm"
      label="Length"
      value={length.normal ?? length.any}
      unit="h"
      detail={against || length.range}
    />
  );
}

function TasteFigure({ fit }) {
  let body;
  if (!fit) body = <p className="text-sm text-white/60 m-0">Reading your shelves…</p>;
  else if (fit.thin) body = <p className="text-sm text-white m-0">Not enough on your shelves yet to compare</p>;
  else if (fit.reasons.length === 0) {
    /* An honest negative. A page that can only ever argue for adding a game is
       a storefront. */
    body = <p className="text-sm text-white m-0">Nothing here matches what you usually play</p>;
  } else {
    body = (
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
        {fit.reasons.map(r => <li key={r} className="text-sm text-white">{r}</li>)}
      </ul>
    );
  }
  return <Figure size="sm" label="Your Taste">{body}</Figure>;
}

function Swatched({ color, children }) {
  return (
    <span className="lh-display text-2xl lg:text-3xl text-white leading-none flex items-center gap-3">
      <span aria-hidden="true" className="w-3 h-3 shrink-0" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

/* Two up on a phone with the third figure spanning the row under them, three
   across from sm. One per row stacked three full-height cards between the
   title and everything else. */
const grid = 'grid grid-cols-2 sm:grid-cols-3 gap-3 [&>*:nth-child(3)]:col-span-2 sm:[&>*:nth-child(3)]:col-span-1';

export default function LeadBlock({
  mode, score, length, verdict, libEntry, notes, completed,
  priority, priorityColor, priorityPeers, feel, feelColor, addedText,
  release, anticipation, shownAt,
}) {
  if (mode === 'decide') {
    return (
      <section className="mb-12" aria-labelledby="lead-heading">
        <SectionHeader id="lead-heading">Before You Decide</SectionHeader>
        <div className={grid}>
          <ScoreFigure score={score} />
          <LengthFigure length={length} />
          <TasteFigure fit={verdict?.fit} />
        </div>
        {(verdict?.against || verdict?.neighbours?.length > 0) && (
          <div className="border border-white/15 mt-3">
            <Line label="Your Queue">{verdict.against}</Line>
            {verdict.neighbours.map((l, i) => <Line key={l} label={i === 0 ? 'Your Shelf' : ''}>{l}</Line>)}
          </div>
        )}
      </section>
    );
  }

  if (mode === 'plan') {
    return (
      <section className="mb-12" aria-labelledby="lead-heading">
        <SectionHeader id="lead-heading">Before You Play</SectionHeader>
        <div className={grid}>
          {priority ? (
            <Figure
              size="sm"
              label="Priority"
              detail={priorityPeers > 1 ? `One of ${priorityPeers} games marked ${priority}.` : `The only game marked ${priority}.`}
            >
              <Swatched color={priorityColor}>{priority}</Swatched>
            </Figure>
          ) : (
            <Figure size="sm" label="Priority" pending pendingText="Not set" detail="Set one from the bar to rank it against your queue." />
          )}
          <LengthFigure length={length} against={verdict?.against} />
          <ScoreFigure score={score} />
        </div>
        {(verdict?.neighbours?.length > 0 || addedText) && (
          <div className="border border-white/15 mt-3">
            {verdict?.neighbours?.map((l, i) => <Line key={l} label={i === 0 ? 'Your Shelf' : ''}>{l}</Line>)}
            <Line label="Shelved">{addedText}</Line>
          </div>
        )}
      </section>
    );
  }

  if (mode === 'playing') {
    return (
      <section className="mb-12" aria-labelledby="lead-heading">
        <SectionHeader id="lead-heading">Where You Left Off</SectionHeader>
        {notes}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <LengthFigure length={length} />
          <ScoreFigure score={score} />
        </div>
        {addedText && (
          <div className="border border-white/15 mt-3"><Line label="Shelved">{addedText}</Line></div>
        )}
      </section>
    );
  }

  if (mode === 'record') {
    const beaten = libEntry.status === 'Beaten';
    return (
      <>
        <section className="mb-12" aria-labelledby="lead-heading">
          <SectionHeader id="lead-heading">Your Record</SectionHeader>
          <div className={grid}>
            {beaten ? (
              feel ? (
                <Figure size="sm" label="Your Rating" detail="Change it from the bar.">
                  <Swatched color={feelColor}>{feel}</Swatched>
                </Figure>
              ) : (
                <Figure size="sm" label="Your Rating" pending pendingText="Not rated" detail="Rate it from the bar. Perfection, Go for it, Timepass or Skip." />
              )
            ) : (
              <Figure size="sm" label="Status" detail="Kept for the record. Move it back from the bar any time.">
                <Swatched color="var(--status-solid-dropped)">Dropped</Swatched>
              </Figure>
            )}
            {beaten ? (
              <Figure size="sm" label="Completed On">{completed}</Figure>
            ) : (
              <ScoreFigure score={score} />
            )}
            <LengthFigure length={length} />
          </div>
        </section>
        <section className="mb-12" aria-labelledby="notes-heading">
          <SectionHeader id="notes-heading">{beaten ? 'Review' : 'Notes'}</SectionHeader>
          {notes}
        </section>
      </>
    );
  }

  // waiting
  return (
    <section className="mb-12" aria-labelledby="lead-heading">
      <SectionHeader id="lead-heading">Coming</SectionHeader>
      <div className={grid}>
        {release.date ? (
          <Figure size="sm" label="Release" value={release.date} detail={release.detail} />
        ) : (
          <Figure size="sm" label="Release" pending pendingText="To be announced" detail="No date on IGDB yet." />
        )}
        {anticipation ? (
          <Figure size="sm" label="Anticipation" value={anticipation.value} detail={anticipation.detail} />
        ) : (
          <Figure size="sm" label="Anticipation" pending pendingText="Not tracked yet" detail="No one has followed it on IGDB." />
        )}
        {shownAt ? (
          <Figure size="sm" label="Shown At" detail={shownAt.detail}>
            <span className="lh-display text-xl lg:text-2xl text-white leading-tight block">{shownAt.name}</span>
          </Figure>
        ) : (
          <Figure size="sm" label="Shown At" pending pendingText="No showcase yet" detail="It has not appeared at an event IGDB records." />
        )}
      </div>
      <div className="border border-white/15 mt-3">
        <Line label="Your Shelf">
          {libEntry
            ? 'Shelved as Unreleased. It moves to your Wishlist once it is out.'
            : 'Add it and it waits on your Unreleased shelf, then moves to Wishlist on release.'}
        </Line>
      </div>
    </section>
  );
}
