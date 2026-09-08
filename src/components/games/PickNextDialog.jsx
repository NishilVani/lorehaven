import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Dialog from '../ui/Dialog';
import { pickNextGame, suggestablePicks } from '../../services/pickNext';
import { statusColor } from '../../constants/stateColors';

/* Pick Next — your shelf, narrowed down to one, in front of you.
 *
 * ── Why this was rebuilt ────────────────────────────────────────────────────
 * The previous version rode a horizontal strip of covers past a fixed reading
 * frame, decelerating onto the winner. The motion was right and the runners-up
 * beside it were real. The PAYOFF was not: the answer ended as a 100px tile
 * among five equals, distinguished by a hairline, with the verdict delivered as
 * a text line underneath. You asked the app to decide, and the decision arrived
 * smaller than a library card.
 *
 * It was also a slot reel. The deceleration was borrowed from one, the strip
 * was filler between the real entries, and nothing on screen was the thing the
 * scorer actually did.
 *
 * ── The form ────────────────────────────────────────────────────────────────
 * The scorer's own work, made visible. The dialog opens on your whole
 * suggestable shelf as a dense field of covers — every game that could be the
 * answer, at once. Then the field is cut:
 *
 *   1. Everything the scorer did not shortlist drains away in one ripple,
 *      leaving its outline behind. What is left is the eight it kept.
 *   2. The runners-up go one at a time, worst rank first, so the last cover
 *      standing beside the winner is the game that came closest.
 *   3. The survivor grows out of its cell into the plate.
 *
 * Every frame of that is real: the field is your library, the survivors are the
 * scorer's ranked shortlist, and the order they fall in is the ranking. There
 * is no filler and nothing to fake, because the narrowing IS the algorithm.
 *
 * ── What the research asked for ─────────────────────────────────────────────
 *   Buell & Norton (2011) — visible effort raises perceived value. The effort
 *     shown here is the actual work: a field of N reduced to one.
 *   Schultz — anticipation carries the charge, not the outcome, so the budget
 *     goes into the cut rather than into the reveal.
 *   Kahneman — peak and end survive. The peak is the last runner-up falling;
 *     the end is the survivor at full size.
 *   Wilson et al. (2005) — making sense of a good thing ends the pleasure of
 *     it, so the pick holds unexplained before the reasoning is read out.
 *   Slot research — the deceleration was worth stealing; the manufactured
 *     near-miss was not. Nothing here is manufactured: a tile survives the cut
 *     if and only if the scorer ranked it, and falls in rank order.
 */

const coverUrl = (id, size = 't_cover_big') =>
  id ? `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg` : null;

const COVER_SIZE = 't_cover_small';

/* The field's box. Fixed, and matched by the reveal row's min-height, so the
   dialog does not resize under the pointer when the plate lands. */
const STAGE_H = 200;
const GAP = 5;
/* Past ten columns the covers stop being recognisable as your own games, which
   is the only reason the field is worth showing instead of a number. */
const MAX_COLS = 10;
const MIN_COLS = 3;

/* The field sits whole for a beat before anything is taken from it — you have
   to see what is being cut down before the cutting means anything. */
const FIELD_HOLD_MS = 300;
/* The mass cut, as one ripple across the whole field rather than a fade. */
const CUT_MS = 520;
const CUT_FADE_MS = 320;
/* The shortlist stands alone, counted, before the last cut starts. */
const CONTENTION_HOLD_MS = 380;
/* The runners-up, one at a time. Slow enough to read as individuals: this is
   the near-miss, and it is only worth having because it is true. */
const FINAL_STAGGER_MS = 90;
/* ── The strike ──────────────────────────────────────────────────────────────
   The narrowing was the work; this is the celebration, and it is three moves on
   ONE impact frame rather than three effects that happen to be near each other.

   1. The survivor's plate grows out of its cell FAST and stops dead. The first
      version of this decelerated politely into position over 480ms and read as
      a layout change, so it was given a back-out overshoot instead — which was
      the wrong repair twice over. A stamp does not spring back, and the impact
      was already being paid for by moves 2 and 3, so the rebound was charging
      for the same moment a second time. The weight is in the velocity profile:
      the same exponential curve the strike uses, over 300ms rather than 460.
   2. The field it beat flares white and dies behind it (`pick-flare`).
   3. The verdict is struck across in a white bar (`pick-stamp` / `pick-struck`
      in index.css), so the name ARRIVES with the impact instead of having been
      sitting there through it. */
const PLATE_MS = 300;
/* Ease-out-quint, the same curve as .pick-stamp: the flight and the strike that
   follows it are one gesture, so they must not be two easings. */
const PLATE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/* Must match .pick-flare and .pick-stamp in index.css. */
const FLARE_MS = 420;
const STAMP_MS = 420;
/* The pick stands unexplained for this long AFTER the strike, then the rows
   arrive at reading pace rather than as a flurry. */
const REASON_HOLD_MS = 240;
const REASON_STAGGER_MS = 180;
/* Ceremony decay. Draw one of a session gets all of the above; each reroll gets
   0.7 of the last, floored so it never becomes a hard cut. Duration neglect
   says shortening costs little of what is actually remembered, and the
   alternative is a gesture that turns into a toll by the fifth press. */
const CEREMONY_DECAY = 0.7;
const CEREMONY_FLOOR = 0.4;
/* Below this there is no field to narrow — three covers losing two of their
   number is arithmetic, not a cut. */
const MIN_FIELD = 4;

const shuffled = (a) => {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The largest tiles that hold `n` covers inside `w` × STAGE_H.
 *
 * Ascending from the fewest columns and returning the first arrangement that
 * fits, because fewer columns means wider tiles: a shelf of six should be six
 * large covers, not six thumbnails marooned in the corner of a grid sized for
 * sixty. Only when nothing fits does the field get capped — the readout still
 * quotes the true count, so a capped field under-shows rather than over-claims.
 */
const gridPlan = (w, n) => {
  const fit = (cols) => {
    const tw = (w - (cols - 1) * GAP) / cols;
    const th = tw * 4 / 3;                                     // covers are 3:4
    const rowsFit = Math.max(1, Math.floor((STAGE_H + GAP) / (th + GAP)));
    return { cols, tw, th, rows: Math.min(rowsFit, Math.ceil(n / cols)), cap: cols * rowsFit };
  };
  for (let cols = MIN_COLS; cols <= MAX_COLS; cols++) {
    const p = fit(cols);
    if (p.cap >= n) return { ...p, count: n };
  }
  const p = fit(MAX_COLS);
  return { ...p, count: p.cap };
};

/* Mounted only while open — the caller renders it conditionally. That is what
   lets the first state BE the drawing state instead of an effect setting it
   synchronously on open, which cascades a render every time the dialog opens. */
export default function PickNextDialog({ onClose }) {
  const navigate = useNavigate();
  /* phase: 'draw' while the field is being cut, 'rest' once one is left. */
  const [state, setState] = useState({ phase: 'draw' });
  // Ids already offered this session, so Pick Another walks the shortlist.
  const [seen, setSeen] = useState([]);
  const [field, setField] = useState([]);
  const [plan, setPlan] = useState(null);
  /* Which cells have been cut, and how long each waits before it goes. One
     state object for the whole field: CSS transition-delay does the ripple, so
     a cut of thirty covers is one render rather than thirty timers. */
  const [cut, setCut] = useState({ out: new Set(), delay: new Map() });
  /* The field outlives the draw by one beat so it can be blown out by the
     landing. Without it the thirty rules the winner beat simply stopped
     existing on the frame the plate appeared, which is a cut, not an impact. */
  const [flare, setFlare] = useState(false);
  const [ceremony, setCeremony] = useState(1);

  const stageRef = useRef(null);
  const cellRefs = useRef(new Map());
  /* The winning cell's viewport rect, captured before the field unmounts and
     read by the plate's callback ref in the very next commit. */
  const flipFrom = useRef(null);
  /* Two guards, because there are two ways a draw can go stale. `live` is the
     mount, and it is SET on mount rather than only cleared on unmount —
     latched false by StrictMode's simulated unmount it never came back, and the
     dialog sat on its skeleton with the answer already in hand. `token` is the
     draw: a second Pick Another must not let the older request finish last. */
  const live = useRef(true);
  const token = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  /**
   * The survivor's growth, run from the plate's callback ref.
   *
   * A callback ref fires synchronously after React has mutated the DOM and
   * before the browser paints, which is the only moment where the plate's final
   * rect can be measured AND the inverted transform applied without a frame of
   * the plate sitting at full size first. Waiting on requestAnimationFrame here
   * showed a pop: the field is gone in that commit, so a full-size plate has
   * nothing covering it.
   */
  const plateRef = useCallback((el) => {
    const from = flipFrom.current;
    if (!el || !from) return;
    flipFrom.current = null;
    const to = el.getBoundingClientRect();
    if (!to.width || !from.width) return;
    const s = from.width / to.width;
    el.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})` },
        { transform: 'none' },
      ],
      {
        duration: PLATE_MS * (Number(el.dataset.ceremony) || 1),
        easing: PLATE_EASING,
        /* backwards, not both: the animation must own the element from the
           first painted frame, and must hand the position back afterwards so
           nothing downstream reads a transform that is no longer true. */
        fill: 'backwards',
        composite: 'replace',
      },
    );
  }, []);

  /* One draw, start to finish, owning its own timing. A straight sequence
     rather than effects reacting to a phase variable: each beat has to wait for
     the one before it and for the request, which is one instruction in a line
     here and four cooperating effects otherwise. */
  const runDraw = useCallback(async (exclude) => {
    const mine = ++token.current;
    const current = () => live.current && token.current === mine;

    /* Read off `exclude` rather than a counter: it advances once per COMPLETED
       draw, so StrictMode's aborted first pass cannot age the ceremony before
       anyone has seen it. */
    const scale = Math.max(CEREMONY_FLOOR, CEREMONY_DECAY ** exclude.length);
    setCeremony(scale);

    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    /* The shelf is on disk and needs no request, so the covers under
       consideration are on screen before the scorer has said anything. */
    const shelf = suggestablePicks().filter(p => p.cover_id);
    const w = stageRef.current?.clientWidth || 0;
    const cuts = !still && shelf.length >= MIN_FIELD && w > 0;

    setCut({ out: new Set(), delay: new Map() });
    setFlare(false);
    setState({ phase: 'draw', shelfSize: shelf.length, cuts });

    const request = pickNextGame({ exclude });
    if (!cuts) {
      /* No field to narrow, or motion is not wanted. Nothing is staged and
         nothing is delayed — the answer is simply the answer. */
      setField([]);
      const result = await request;
      if (!current()) return;
      setState({ phase: 'rest', ...result, cuts: false });
      if (result.game) setSeen(prev => [...prev, String(result.game.id)]);
      return;
    }

    const p = gridPlan(w, shelf.length);
    const tiles = shuffled(shelf).slice(0, p.count)
      .map((t, i) => ({ ...t, key: `f-${mine}-${i}` }));
    setPlan(p);
    setField(tiles);

    /* Both, not either: the field stands for at least the length of the beat,
       and nothing is cut before there is a ranking to cut by. On a warm profile
       cache the request wins by a mile and FIELD_HOLD_MS is what you watch. */
    const [result] = await Promise.all([request, wait(FIELD_HOLD_MS * scale)]);
    if (!current()) return;

    const winner = result.game
      ? { name: result.game.name, cover_id: result.game.cover_id || result.game.cover?.image_id }
      : null;
    const runners = (result.shortlist || [])
      .filter(s => !s.picked && s.game?.id !== result.game?.id && s.game?.cover_id)
      .map(s => ({ name: s.game.name, cover_id: s.game.cover_id }));

    if (!winner?.cover_id) {
      setState({ phase: 'rest', ...result, cuts: false });
      setField([]);
      if (result.game) setSeen(prev => [...prev, String(result.game.id)]);
      return;
    }

    /* Seat the shortlist in the field.
       A capped field is a sample of the shelf, so the games the scorer kept are
       not guaranteed to be in it — and a cut that ends on a cover nobody was
       shown is a cut nobody can follow. Anything missing is written into a free
       cell now, one commit before the mass cut lands, where a single tile
       changing among thirty going out is not something you can see. Matched on
       cover id: the shelf projection carries name and cover only, and two
       entries of the same game share an id long before they share a title. */
    const seats = [];
    const taken = new Set();
    const swaps = new Map();
    for (const g of [winner, ...runners]) {
      let idx = tiles.findIndex((t, i) => !taken.has(i) && t.cover_id === g.cover_id);
      if (idx < 0) {
        const free = tiles.map((_, i) => i).filter(i => !taken.has(i));
        if (!free.length) break;
        idx = free[Math.floor(Math.random() * free.length)];
        swaps.set(idx, g);
      }
      taken.add(idx);
      seats.push(idx);
    }
    const winIndex = seats[0];
    const runnerCells = seats.slice(1);
    if (swaps.size) {
      setField(prev => prev.map((t, i) => (
        swaps.has(i) ? { ...swaps.get(i), key: `s-${mine}-${i}` } : t
      )));
    }

    /* ── Beat one: everything the scorer did not keep ─────────────────────── */
    const losers = shuffled(tiles.map((_, i) => i).filter(i => !taken.has(i)));
    const step = losers.length ? (CUT_MS * scale) / losers.length : 0;
    setCut({
      out: new Set(losers),
      delay: new Map(losers.map((idx, i) => [idx, Math.round(i * step)])),
    });
    /* Guarded: a shelf no bigger than the shortlist has nothing to cut here, and
       an unguarded wait spent 840ms of the draw on a field that never moved. */
    if (losers.length) {
      await wait(CUT_MS * scale + CUT_FADE_MS);
      if (!current()) return;
    }

    /* The count flips only once the picture agrees with it. Set at the START of
       the cut it read "8 in contention" over a field of thirty covers and stayed
       wrong for 700ms — measured — which turns the one honest readout in the
       sequence into the thing that spoils it. */
    setState(prev => ({ ...prev, contention: seats.length }));

    /* ── Beat two: the runners-up, worst rank first ───────────────────────── */
    await wait(CONTENTION_HOLD_MS * scale);
    if (!current()) return;
    const falling = runnerCells.slice().reverse();     // rank 8 falls, rank 2 last
    const step2 = FINAL_STAGGER_MS * scale;
    setCut(prev => ({
      out: new Set([...prev.out, ...falling]),
      delay: new Map([...prev.delay, ...falling.map((idx, i) => [idx, Math.round(i * step2)])]),
    }));
    await wait(step2 * falling.length + CUT_FADE_MS);
    if (!current()) return;

    /* ── Beat three: the strike ───────────────────────────────────────────── */
    flipFrom.current = cellRefs.current.get(winIndex)?.getBoundingClientRect() || null;
    /* All three of these land in ONE commit, which is what makes this an impact
       rather than a sequence. React batches them, so the frame that paints the
       plate at its inverted (cell-sized) position is the same frame that empties
       the winning cell underneath it and starts the field's flare. Split across
       commits, the winner's cover blinked out of the grid before the plate
       covered the hole. */
    setCut(prev => ({ out: new Set([...prev.out, winIndex]), delay: new Map(prev.delay) }));
    setFlare(true);
    setState({ phase: 'rest', ...result, cuts: true });
    if (result.game) setSeen(prev => [...prev, String(result.game.id)]);

    await wait(FLARE_MS * scale);
    if (!current()) return;
    setFlare(false);
    setField([]);
  }, []);

  /* Deferred by a tick rather than called straight from the effect body:
     runDraw sets state on its first lines, and a synchronous setState inside an
     effect is the cascading-render pattern this project lints against. It also
     needs the stage laid out, so it can measure the field's width. */
  useEffect(() => {
    const id = setTimeout(() => runDraw([]), 0);
    return () => clearTimeout(id);
  }, [runDraw]);

  const { phase, game, reasons = [], poolSize = 0, shelfSize = 0, contention = 0 } = state;
  const drawing = phase === 'draw';
  const cover = coverUrl(game?.cover_id || game?.cover?.image_id);
  /* The strike only exists where there was a landing. With motion turned off or
     a shelf too small to narrow, the answer is simply the answer and every one
     of these delays would be a stall in front of it. */
  const struck = state.cuts !== false;
  const impact = struck ? Math.round(PLATE_MS * ceremony) : 0;
  /* When the reasoning may start: after the plate has landed AND the strike has
     finished crossing it. */
  const settled = impact + (struck ? Math.round(STAMP_MS * ceremony) : 0);

  /* The narrowing, in one line: how many are on your shelves, how many the
     scorer had in contention, and then the one it took. Three counted facts
     falling as the field closes — the only thing in this sequence with the
     shape of a peak. */
  const readout = drawing
    ? (contention ? `${contention} in contention` : shelfSize > 1 ? `${shelfSize} on your shelves` : 'Reading your shelves')
    : null;

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="pick-next-title"
      describedBy={game ? 'pick-next-body' : undefined}
      panelClassName="w-full max-w-lg p-6"
    >
      <h3 id="pick-next-title" className="lh-display text-xl text-white mb-5">Play This Next</h3>

      {/* ── The stage ────────────────────────────────────────────────────────
          One box, two occupants. The field of covers is cut down inside it, and
          the survivor grows into the plate that replaces it. Held at the same
          height throughout so the dialog does not resize under the pointer at
          the exact moment there is finally something to press. */}
      <div ref={stageRef} className="relative" style={{ minHeight: STAGE_H }}>
        {(drawing || flare) && plan && field.length > 0 && (
          <div
            className={`absolute inset-0 grid content-center ${flare ? 'pick-flare motion-reduce:animate-none' : ''}`}
            style={{
              gridTemplateColumns: `repeat(${plan.cols}, ${plan.tw}px)`,
              gap: GAP,
              justifyContent: 'center',
              animationDuration: `${Math.round(FLARE_MS * ceremony)}ms`,
            }}
            aria-hidden="true"
          >
            {field.map((t, i) => {
              const out = cut.out.has(i);
              return (
                /* The outline is the residue: a cover that has been cut leaves
                   the space it occupied behind rather than collapsing the grid.
                   Inversion and hairlines are the only elevation this world
                   has, so a field of empty rules is what "considered and
                   rejected" looks like here. */
                <div
                  key={t.key}
                  ref={el => { if (el) cellRefs.current.set(i, el); else cellRefs.current.delete(i); }}
                  className="relative border transition-colors duration-300 ease-out"
                  style={{
                    width: plan.tw,
                    height: plan.th,
                    /* On impact every rule in the field goes to full white at
                       once, delays zeroed — the flash has to be one frame, not
                       a second ripple chasing the first. */
                    borderColor: flare ? 'rgba(255,255,255,0.85)'
                      : out ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.22)',
                    transitionDelay: flare ? '0ms' : `${cut.delay.get(i) || 0}ms`,
                  }}
                >
                  <img
                    src={coverUrl(t.cover_id, COVER_SIZE)}
                    alt=""
                    decoding="async"
                    className="w-full h-full object-cover transition-opacity ease-out"
                    style={{
                      opacity: out ? 0 : 0.9,
                      transitionDuration: `${CUT_FADE_MS}ms`,
                      transitionDelay: flare ? '0ms' : `${cut.delay.get(i) || 0}ms`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {drawing ? (
          <div className="absolute inset-x-0 bottom-0 pointer-events-none">
            {/* Sat on black under the field it was unreadable against the
                covers, so it rides its own band. */}
            <div className="lh-label text-white/70 tabular-nums bg-black/85 px-2 py-1 inline-block">
              {readout}
            </div>
          </div>
        ) : !game ? (
          /* The only empty case left. There used to be a second one — "that is
             all N of them" — which stopped Pick Another once every game had
             been shown once. It reported 11 to someone holding 123 suggestable
             games, because the pool was Backlog and Playing only. The pool is
             wider now and it wraps rather than stopping, so running out is no
             longer a state. */
          <p className="text-[15px] leading-relaxed text-white/60">
            Nothing on your Backlog, Wishlist or Dropped shelves yet. Shelve a game
            and this will have something to pick from.
          </p>
        ) : (
          /* Above the flaring field: the plate has to cover the cell it grew
             out of from the first painted frame, and an absolutely positioned
             grid outranks a static sibling without this. */
          <div className="relative z-10 flex gap-4 sm:gap-5">
            {cover && (
              <img
                ref={plateRef}
                data-ceremony={ceremony}
                src={cover}
                alt=""
                /* A resolved cover id can still fail to load — a stale image id,
                   an offline device, a blocked CDN — and that failure is
                   indistinguishable from "no cover" once it renders. Saying so
                   separates the two causes when someone reports a blank
                   poster. */
                onError={() => console.warn('[picknext] cover failed to load', {
                  id: game.id, name: game.name, src: cover,
                })}
                /* The plate. Four times the area the old strip gave the answer,
                   and the border strikes full white as it lands: this world's
                   only exclamation mark. origin-top-left because the growth is
                   an inverted FLIP from the winning cell, which is measured from
                   its top-left corner. */
                className="w-[120px] h-[160px] sm:w-[150px] sm:h-[200px] object-cover border border-white/25 shrink-0 origin-top-left pick-land motion-reduce:animate-none"
                /* pick-land fills `both`, so this delay does two things: the
                   plate carries a full-white edge through the whole flight, and
                   the cool-back to white/55 starts at the landing rather than
                   at the takeoff. Undelayed, the one flourish this world has
                   was spent on a thumbnail before anyone could see it. */
                style={{ animationDelay: `${impact}ms` }}
              />
            )}
            {/* self-start so the stamp bar covers the verdict block and not the
                200px of stretched column under it. */}
            <div className="min-w-0 flex-1 self-start relative">
              {/* Marked for the gate so the test stops finding it by a
                  font-size utility. */}
              <div
                className={struck ? 'pick-struck motion-reduce:animate-none' : undefined}
                style={struck ? { animationDelay: `${impact}ms` } : undefined}
              >
                <div data-pick-name className="lh-display text-[22px] sm:text-[24px] leading-tight text-white">{game.name}</div>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    aria-hidden="true"
                    className="lh-swatch w-2 h-2 shrink-0"
                    style={{ backgroundColor: statusColor(game.status) }}
                  />
                  <span className="lh-label text-white/60">{game.status}</span>
                </div>
                {/* The service has always counted the pool and the dialog used
                    to throw it away. It is what makes the answer a judgement:
                    one of twenty-four considered, not one game on its own. */}
                {poolSize > 1 && (
                  <div className="lh-label text-white/60 mt-2 tabular-nums">
                    One of {poolSize} considered
                  </div>
                )}
              </div>
              {/* The bar. Hidden outright under reduced motion rather than left
                  to `animate-none`, which would strand a white slab over the
                  verdict forever. */}
              {struck && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-white pointer-events-none pick-stamp motion-reduce:hidden"
                  style={{ animationDelay: `${impact}ms` }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* The reasoning, ruled like everything else in this world rather than set
          as grey footnotes. reasonsFor returns them strongest first, so the
          order carries information and the first is set brighter: it is the term
          that actually moved the score.

          Held back, then read out a line at a time. Wilson et al. found that
          making sense of a good thing is what ends the pleasure of it, and these
          used to land 180ms behind the pick — near enough to simultaneous that
          the answer never got a moment of being simply true. The hold buys that
          moment; arriving at reading pace makes it a verdict rather than a
          caption block.

          Absent entirely for a game the scorer had nothing to say about, which
          is the common case on a new library. The plate and the count above it
          are a finished verdict on their own — nothing here is load-bearing. */}
      {!drawing && reasons.length > 0 && (
        <ul id="pick-next-body" className="mt-5 border-t border-white/15">
          {reasons.map((r, i) => (
            <li
              key={r}
              style={{ animationDelay: `${settled + Math.round((REASON_HOLD_MS + i * REASON_STAGGER_MS) * ceremony)}ms` }}
              className={`border-b border-white/10 py-2.5 text-[13px] leading-snug animate-in fade-in slide-in-from-bottom-4 motion-reduce:animate-none ${
                i === 0 ? 'text-white/80' : 'text-white/60'
              }`}
            >
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-6">
        {/* Rendered from the first frame, disabled until there is something to
            open. Conditional on `game`, it did not exist during the draw and
            then appeared at the head of the row — the primary action
            materialising under the pointer, shoving Pick Another sideways at
            the moment you were about to press it. Absent once the empty state
            has settled: no answer is ever coming there, and a permanently dead
            primary button is furniture. */}
        {(game || drawing) && (
          <button
            onClick={() => { if (game) { onClose(); navigate(`/game/${game.id}`); } }}
            disabled={drawing || !game}
            /* Unarmed as an outline, armed as the white slab — the fill arrives
               with the answer. Held at bg-white and greyed by opacity it was the
               brightest thing on a screen that had nothing to open yet. */
            className={`lh-label px-4 py-2 border cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
              game && !drawing
                ? 'border-white bg-white text-black hover:bg-neutral-200'
                : 'border-white/20 text-white/50 cursor-default'
            }`}
          >
            Open
          </button>
        )}
        <button
          onClick={() => runDraw(seen)}
          disabled={drawing || !game}
          className="lh-label inline-flex items-center gap-2 px-4 py-2 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${drawing ? 'animate-spin motion-reduce:animate-none' : ''}`}
            aria-hidden="true"
          />
          {/* Says what it will do, not what it is */}
          Pick Another
        </button>
        <button
          onClick={onClose}
          className="lh-label px-4 py-2 text-white/60 hover:text-white transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ml-auto"
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
