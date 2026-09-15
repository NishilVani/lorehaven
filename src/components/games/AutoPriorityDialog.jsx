import { useEffect, useMemo, useState } from 'react';
import { X, ArrowRight, ImageOff, RotateCcw } from 'lucide-react';
import Dialog from '../ui/Dialog';
import Checkbox from '../ui/Checkbox';
import { getGamesProfile } from '../../services/igdb';
import { PRIORITIES, priorityColor, normalizeStatus } from '../../constants/stateColors';
import {
  planAutoPriority, publicScore, tasteScore, buildBeatenTaste,
  countRatedBeaten, MIN_RATED_BEATEN,
} from '../../services/autoPriority';

/* The bands, said once beside the counts they produce, so nobody has to guess
   why a 74 landed in Maybe. The numbers live in autoPriority.js; this is copy. */
const RANGE = { 'Next Up': '85 and up', 'Soon': '75 to 84', 'Maybe': '65 to 74', 'Someday': 'Under 65' };

const isCustom = (g) => !!g.is_custom || String(g.id).startsWith('custom_');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Auto Priority for one shelf.
 *
 * The preview IS the confirmation. Everything that would be written is on
 * screen, recomputed as the method and the Replace toggle change, and nothing
 * is saved until the one primary button. A separate "are you sure" step would
 * only repeat the list the user is already reading.
 */
export default function AutoPriorityDialog({ shelf, games, library, onApply, onClose }) {
  const [method, setMethod] = useState('public');
  const [replace, setReplace] = useState(false);
  const [profiles, setProfiles] = useState(null);
  const [profileError, setProfileError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const rated = useMemo(() => countRatedBeaten(library), [library]);
  const tasteReady = rated >= MIN_RATED_BEATEN;

  /* Profiles only when the taste method is chosen: the public method needs
     nothing the shelf does not already carry, and most people will never pay for
     the request. getGamesProfile is cached for a week, and it swallows failures
     and returns what it got, so an empty answer to a non-empty question is the
     failure signal. Without that check an IGDB outage would quietly score every
     game on its public rating under a heading that says taste. */
  useEffect(() => {
    if (method !== 'taste' || profiles || profileError) return undefined;
    let live = true;
    const beaten = library.filter(g => normalizeStatus(g.status) === 'Beaten' && g.feel);
    const ids = [...new Set([...games, ...beaten].filter(g => !isCustom(g)).map(g => Number(g.id)))]
      .filter(Number.isFinite).sort((a, b) => a - b);
    getGamesProfile(ids)
      .then(rows => {
        if (!live) return;
        if (ids.length > 0 && (!rows || rows.length === 0)) { setProfileError(true); return; }
        setProfiles(new Map((rows || []).map(p => [String(p.id), p])));
      })
      .catch(() => { if (live) setProfileError(true); });
    return () => { live = false; };
  }, [method, profiles, profileError, games, library, attempt]);

  const taste = useMemo(() => (profiles ? buildBeatenTaste(library, profiles) : []), [profiles, library]);
  const loading = method === 'taste' && !profiles && !profileError;

  const plan = useMemo(() => {
    if (method === 'taste' && !profiles) return null;
    const scoreOf = method === 'taste'
      ? (g) => tasteScore(g, profiles.get(String(g.id)) || null, taste)
      : publicScore;
    return planAutoPriority({ games, scoreOf, replace });
  }, [method, profiles, taste, games, replace]);

  const changes = plan?.changes.length ?? 0;

  /* One sentence per state, and each one says what would change the answer. */
  let note = null;
  if (games.length === 0) note = `${shelf} is empty, so there is nothing to prioritise.`;
  else if (plan && changes === 0) {
    if (!replace && plan.alreadySet === games.length) note = 'Every game here already has a priority. Turn on Replace to rescore them.';
    else if (plan.rows.length === 0 && method === 'public') note = 'No game here has a public rating yet.';
    else if (plan.rows.length === 0) note = 'No game here has a public rating or resembles a game you rated.';
    else note = 'Every game is already in the band its score gives it.';
  }

  const summary = plan && games.length > 0 ? [
    plural(changes, 'change', 'changes'),
    plan.skipped > 0 && `${plan.skipped} skipped, no rating`,
    plan.alreadySet > 0 && `${plan.alreadySet} already set`,
  ].filter(Boolean).join(' · ') : null;

  const applyLabel = loading ? 'Scoring Games'
    : changes > 0 ? `Set ${plural(changes, 'Priority', 'Priorities')}` : 'Nothing to Change';

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="auto-priority-title"
      describedBy="auto-priority-desc"
      /* A bottom sheet below sm: on a phone the centred panel floated with dead
         page above and below and no change row in view. Anchored to the bottom
         edge it gets the height, sits under the thumb, and Dialog's drag down
         dismisses it. The entrance scales from that edge, not from mid-air. */
      alignClassName="items-end sm:items-center justify-center"
      className="p-0 sm:p-4"
      panelClassName="w-full sm:max-w-xl flex flex-col max-h-[88vh] sm:max-h-[90vh] overflow-hidden origin-bottom sm:origin-center"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/20">
        <div className="min-w-0">
          <h2 id="auto-priority-title" className="lh-display text-base text-white m-0">Auto Priority</h2>
          <p id="auto-priority-desc" className="text-[13px] text-white/60 mt-1">
            {shelf}, {plural(games.length, 'game', 'games')}. Nothing is saved until you apply.
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="tap-block -m-1 p-1.5 flex text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="px-5 py-5 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-6">
        <fieldset className="border-0 p-0 m-0 min-w-0">
          <legend className="lh-label text-white/60 mb-2 p-0">Method</legend>
          {/* Native radios, visually replaced: arrow keys, disabled and the
              group's name all come from the platform rather than from a
              role="radio" button that has to reimplement them. */}
          <div className="grid gap-px bg-white/15 border border-white/15">
            <MethodRow
              value="public"
              checked={method === 'public'}
              onSelect={setMethod}
              title="By Public Rating"
              description="Each game's IGDB rating, read straight into the bands."
            />
            <MethodRow
              value="taste"
              checked={method === 'taste'}
              disabled={!tasteReady}
              onSelect={setMethod}
              title="By Your Taste"
              description={tasteReady
                ? `How much each game resembles the ${rated} beaten games you rated, blended with its public rating.`
                : `Rate ${plural(MIN_RATED_BEATEN - rated, 'more beaten game', 'more beaten games')} to use this. It learns from what you finished and how you rated it.`}
            />
          </div>
        </fieldset>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <span className="mt-0.5 flex"><Checkbox checked={replace} onChange={(e) => setReplace(e.target.checked)} /></span>
          <span className="min-w-0">
            <span className="lh-label text-white block">Replace existing priorities</span>
            <span className="block text-[13px] text-white/60 mt-1">
              {replace ? 'Every game here is rescored, including ones you prioritised yourself.' : 'Only games with no priority get one.'}
            </span>
          </span>
        </label>

        <section aria-labelledby="auto-priority-result" aria-busy={loading}>
          <h3 id="auto-priority-result" className="sr-only">Result</h3>
          {/* The counts are the point of the dialog: fixed bands can put forty
              games in Next Up on a strong backlog, and this is where that shows
              before it is written. An em dash, not a zero, while there is no
              basis yet (DESIGN.md, The No-Zero Rule). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/15 border border-white/15">
            {PRIORITIES.map(p => (
              <div key={p} className="bg-black px-3 py-3 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="w-2 h-2 shrink-0" style={{ backgroundColor: priorityColor(p) }} />
                  <span className="lh-label text-white/70 truncate">{p}</span>
                </div>
                <div className="lh-display text-[24px] leading-none text-white tabular-nums mt-3">
                  {plan && games.length > 0 ? plan.counts[p] : '—'}
                </div>
                <div className="text-[13px] text-white/60 mt-1.5">{RANGE[p]}</div>
              </div>
            ))}
          </div>

          <div aria-live="polite" className="mt-3 text-[13px] text-white/60 min-h-[1.25rem]">
            {loading && `Reading genres, studios and series for ${plural(games.length, 'game', 'games')}.`}
            {!loading && profileError && method === 'taste' && (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>IGDB did not send what these games are like, so taste cannot be scored right now.</span>
                <button
                  onClick={() => { setProfileError(false); setAttempt(a => a + 1); }}
                  className="tap lh-label inline-flex items-center gap-1.5 py-1 text-white underline decoration-white/30 underline-offset-4 hover:decoration-white cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Try Again
                </button>
              </span>
            )}
            {!loading && summary && <span className="tabular-nums">{summary}.</span>}
            {!loading && note && <span className="block mt-1 text-white/70">{note}</span>}
          </div>

          {changes > 0 && (
            <ul aria-label="Changes" className="mt-3 border border-white/15 divide-y divide-white/10">
              {plan.changes.map(r => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2 min-w-0">
                  <Cover id={r.cover_id} />
                  <span className="flex-1 min-w-0 text-[13px] text-white truncate">{r.name || 'Untitled game'}</span>
                  <span className="text-[13px] text-white/60 tabular-nums w-7 text-right shrink-0">
                    <span className="sr-only">Score </span>{r.score}
                  </span>
                  <span className="flex items-center justify-end gap-1.5 shrink-0 w-[9.5rem]">
                    <span className="lh-label text-white/50 truncate">{r.from || 'None'}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-white/50 shrink-0" aria-hidden="true" />
                    <span className="sr-only">becomes</span>
                    <span className="lh-label truncate" style={{ color: priorityColor(r.to) }}>{r.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/20 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="lh-label px-4 py-2.5 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Cancel
        </button>
        {/* Pressed feedback is a 0.97 scale over 150ms: the one control here that
            writes, so it is the one that acknowledges the press physically. */}
        <button
          onClick={() => onApply(plan.changes)}
          disabled={loading || changes === 0}
          className="lh-label px-5 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:bg-transparent disabled:text-white/50 disabled:border-white/20 disabled:cursor-default disabled:active:scale-100"
        >
          {applyLabel}
        </button>
      </div>
    </Dialog>
  );
}

/* The chosen method inverts, the way every chosen option does in this world
   (DialGroup, the library tabs). An earlier draft drew a square radio mark,
   which sat one row above the Replace checkbox and read as a second checkbox. */
function MethodRow({ value, checked, disabled = false, onSelect, title, description }) {
  return (
    <label
      /* The focus outline is drawn inside the row with its own colour on both
         sides of it. A ring on the row's edge put black against the near-black
         panel on the chosen row, and read as the white block shrinking. */
      className={`group block px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 ${
        checked ? 'bg-white has-[:focus-visible]:outline-black' : 'bg-black has-[:focus-visible]:outline-white'
      } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <input
        type="radio"
        name="auto-priority-method"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span className={`lh-label block transition-colors ${
        checked ? 'text-black' : disabled ? 'text-white/50' : 'text-white/70 group-hover:text-white'
      }`}>{title}</span>
      <span className={`block text-[13px] mt-1 ${checked ? 'text-black/70' : disabled ? 'text-white/50' : 'text-white/60'}`}>{description}</span>
    </label>
  );
}

function Cover({ id }) {
  return (
    <span className="w-8 h-11 shrink-0 bg-neutral-900 border border-white/10 overflow-hidden flex items-center justify-center">
      {id
        ? <img src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${id}.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
        : <ImageOff className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />}
    </span>
  );
}
