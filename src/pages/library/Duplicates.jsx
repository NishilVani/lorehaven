import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { GitMerge, ImageOff, RotateCcw, ChevronDown, Eye } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import Dialog from '../../components/ui/Dialog';
import GamePreview from '../../components/games/GamePreview';
import { getLibrary, saveManyToLibrary, removeFromLibrary } from '../../services/db';
import { getGamesRelations } from '../../services/igdb';
import {
  findDuplicateGroups, defaultKeep, mergeConflicts, planMerge, mergeUndo,
  dismissPatch, restorePatch, versionLabel, isCustom,
} from '../../services/duplicates';
import { moveCollections, restoreCollections } from '../../services/libraryTransfer';
import { toast } from '../../components/ui/toastBus';
import { statusColor, feelColor, priorityColor, normalizeStatus } from '../../constants/stateColors';

/* A resolved group folds shut before it leaves the list. Without it the group
   under the pointer vanishes and the next one jumps up into its place, and the
   next click lands on a Merge the user never looked at. 200ms, ease-out, and
   nothing at all under reduced motion. */
const LEAVE_MS = 200;

const REASON = {
  edition: ['One is an edition of the other', 'Editions of the same game'],
  expanded: ['One is an expanded version of the other', 'Expanded versions of the same game'],
  bundle: ['One is a bundle that contains the other', 'A bundle and a game it contains'],
  custom: ['A custom entry and the same game from IGDB', 'Custom entries and the same game from IGDB'],
  name: ['Matched by name only', 'Matched by name only'],
  remake: ['One is a remake of the other', 'Remakes of the same game'],
  remaster: ['One is a remaster of the other', 'Remasters of the same game'],
};
const reasonText = (group) => REASON[group.reason][group.members.length > 2 ? 1 : 0];

const FIELD_LABEL = {
  status: 'Status', feel: 'Rating', priority: 'Priority',
  dateCompleted: 'Completed', user_time_to_beat: 'Time to Beat',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clip = (s, max = 26) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const listNames = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

const yearOf = (entry, relation) => {
  const t = relation?.first_release_date ?? entry.first_release_date;
  if (t) return new Date(t * 1000).getUTCFullYear();
  return typeof entry.release_year === 'number' ? entry.release_year : null;
};

const displayValue = (field, v) => {
  if (field === 'status') return normalizeStatus(v) || String(v);
  if (field === 'user_time_to_beat') {
    const hours = typeof v === 'number' ? v : Object.values(v || {}).find(Number.isFinite);
    return hours != null ? `${hours} h` : 'Set';
  }
  return String(v);
};

/* Picking a status, priority or rating takes that scale's colour, as every
   other place a state is chosen does (DESIGN.md, "Two status treatments"). */
const valueColor = (field, v) => (
  field === 'status' ? statusColor(normalizeStatus(v) || v)
    : field === 'priority' ? priorityColor(v)
      : field === 'feel' ? feelColor(v)
        : null
);

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* The preview docks as a right-hand rail from 1440px. It first docked at 1280
   inside the page's centred 1280px column, which on a wide window left empty
   margin to the panel's right while the groups gave up their width to it. As a
   rail on the window's edge it takes 24rem from the margin, not from the
   groups, and 1440 is where 220px of nav plus 24rem still leaves the groups
   two full columns. Below that it opens over the page: a right-hand panel, or
   a bottom sheet on a phone. */
const WIDE = '(min-width: 1440px)';
const subscribeWide = (cb) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const getWide = () => window.matchMedia(WIDE).matches;

export default function Duplicates() {
  const [library, setLibrary] = useState(() => getLibrary());
  const [scan, setScan] = useState({ state: 'loading', relations: new Map() });
  const [attempt, setAttempt] = useState(0);
  const [choices, setChoices] = useState({});
  const [leaving, setLeaving] = useState(() => new Set());
  const [resolved, setResolved] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);
  const [preview, setPreview] = useState(null);
  const focusNext = useRef(null);
  const previewTrigger = useRef(null);
  const previewHeading = useRef(null);
  const focusPreview = useRef(false);
  const isWide = useSyncExternalStore(subscribeWide, getWide, () => false);

  const reload = useCallback(() => setLibrary(getLibrary()), []);

  /* Another tab, the sync, or the library page can change the library while
     this is open; groups are derived from it, so they follow. */
  useEffect(() => {
    window.addEventListener('moctale_lib_update', reload);
    window.addEventListener('moctale_sync_update', reload);
    return () => {
      window.removeEventListener('moctale_lib_update', reload);
      window.removeEventListener('moctale_sync_update', reload);
    };
  }, [reload]);

  /* One relations request for the whole library, on open and on Try Again.
     Merges do not refetch: a merge only removes entries, and the relations of
     what remains have not changed. */
  useEffect(() => {
    let live = true;
    const ids = [...new Set(getLibrary().filter(g => !isCustom(g)).map(g => Number(g.id)).filter(Number.isFinite))]
      .sort((a, b) => a - b);
    (ids.length ? getGamesRelations(ids) : Promise.resolve([]))
      .then(rows => { if (live) setScan({ state: 'done', relations: new Map((rows || []).map(r => [String(r.id), r])) }); })
      .catch(() => { if (live) setScan({ state: 'partial', relations: new Map() }); });
    return () => { live = false; };
  }, [attempt]);

  const groups = useMemo(
    () => (scan.state === 'loading' ? null : findDuplicateGroups(library, scan.relations)),
    [library, scan],
  );
  const open = groups ? [...groups.same, ...groups.related] : [];

  /* Focus follows the work. The Merge button that was pressed is gone, and a
     focus dropped to <body> sends a keyboard user back to the top of the page. */
  useEffect(() => {
    if (focusNext.current == null || !groups) return;
    const els = document.querySelectorAll('[data-dup-group]');
    const target = els[Math.min(focusNext.current, els.length - 1)] || document.getElementById('dup-outcome');
    focusNext.current = null;
    target?.focus();
  }, [groups]);

  const nameOf = useCallback(
    (g) => g?.name || scan.relations.get(String(g?.id))?.name || 'Untitled game',
    [scan.relations],
  );

  const keepFor = (group) => choices[group.key]?.keep ?? defaultKeep(group.members, scan.relations);

  /* Moving Keep resets the picks, so every conflict starts again from the new
     kept game's own values rather than from choices made against the old one. */
  const setKeep = (group, id) => setChoices(c => ({ ...c, [group.key]: { keep: id, fields: {} } }));
  const setField = (group, field, id) => setChoices(c => ({
    ...c,
    [group.key]: { keep: keepFor(group), fields: { ...(c[group.key]?.fields || {}), [field]: id } },
  }));

  /* Pressing Preview on the game already shown closes it, like any pressed
     toggle. Focus moves into the panel when it opens and back to the button
     that opened it when it closes; the Dialog does both on its own, and the
     docked panel does them here. */
  const openPreview = (group, id, trigger) => {
    if (preview && preview.groupKey === group.key && String(preview.id) === String(id)) {
      closePreview();
      return;
    }
    previewTrigger.current = trigger;
    focusPreview.current = true;
    setPreview({ groupKey: group.key, id });
  };
  const closePreview = () => {
    setPreview(null);
    const trigger = previewTrigger.current;
    requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); });
  };

  const previewGroup = preview ? open.find(g => g.key === preview.groupKey) : null;
  const previewOpen = !!previewGroup && previewGroup.members.some(m => String(m.id) === String(preview.id));
  const docked = previewOpen && isWide;

  useEffect(() => {
    if (!focusPreview.current || !previewOpen) return;
    focusPreview.current = false;
    previewHeading.current?.focus();
  }, [previewOpen, preview]);

  /* Escape closes the docked panel from anywhere on the page. It is not modal,
     so focus is often back on a Keep chip or a conflict choice; a handler on the
     panel alone ignored Escape from there. The Dialog below xl has its own. */
  useEffect(() => {
    if (!docked) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPreview(null);
      const trigger = previewTrigger.current;
      requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked]);

  /* The toast stack lives in the bottom-right corner, which the rail now
     occupies: Merge and Not Duplicates announced their Undo on top of the rail's
     last row. While docked the stack moves in by the rail's width. */
  useEffect(() => {
    if (!docked) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--toast-right', 'calc(24rem + 1rem)');
    return () => root.style.removeProperty('--toast-right');
  }, [docked]);

  const leave = (group) => {
    /* A resolved group takes its preview with it; left in state, an Undo that
       brought the group back would reopen the panel unasked. */
    if (preview?.groupKey === group.key) setPreview(null);
    focusNext.current = Math.max(0, open.findIndex(g => g.key === group.key));
    setResolved(n => n + 1);
    if (reducedMotion()) { reload(); return; }
    setLeaving(s => new Set(s).add(group.key));
    setTimeout(() => {
      reload();
      setLeaving(s => { const next = new Set(s); next.delete(group.key); return next; });
    }, LEAVE_MS);
  };

  /* Written before the fold starts, so leaving the page mid-animation loses
     nothing. Kept entry first, then collections, then the removals: a failure
     part way leaves an extra entry behind, never a lost one. */
  const merge = (group) => {
    const keepId = keepFor(group);
    const keep = group.members.find(m => String(m.id) === String(keepId));
    const { patch, removeIds } = planMerge(group.members, keepId, choices[group.key]?.fields);
    const undo = mergeUndo(group.members, keepId, patch);
    saveManyToLibrary([patch]);
    const moved = removeIds.flatMap(id => moveCollections(id, keepId));
    removeIds.forEach(id => removeFromLibrary(id));
    leave(group);
    toast(`Merged into "${clip(nameOf(keep), 28)}"`, 'info', {
      label: 'Undo',
      onClick: () => {
        saveManyToLibrary([undo.keepRestore, ...undo.reAdd]);
        restoreCollections(moved);
        setResolved(n => Math.max(0, n - 1));
        reload();
      },
    });
  };

  const dismiss = (group, related) => {
    const before = group.members.map(m => ({ id: m.id, notDuplicateOf: m.notDuplicateOf || [] }));
    saveManyToLibrary(dismissPatch(group.members));
    leave(group);
    toast(related ? 'Kept both versions' : 'Marked as not duplicates', 'info', {
      label: 'Undo',
      onClick: () => {
        saveManyToLibrary(before);
        setResolved(n => Math.max(0, n - 1));
        reload();
      },
    });
  };

  const restore = (group) => {
    saveManyToLibrary(restorePatch(group.members));
    reload();
    toast('Back in the list to review');
  };

  const retry = () => {
    setScan({ state: 'loading', relations: new Map() });
    setAttempt(a => a + 1);
  };

  const total = library.length;
  const renderGroup = (group, related) => (
    <Group
      key={group.key}
      group={group}
      related={related}
      relations={scan.relations}
      nameOf={nameOf}
      keepId={keepFor(group)}
      fields={choices[group.key]?.fields}
      leaving={leaving.has(group.key)}
      onKeep={(id) => setKeep(group, id)}
      onField={(field, id) => setField(group, field, id)}
      onMerge={() => merge(group)}
      onDismiss={() => dismiss(group, related)}
      previewId={previewOpen && preview.groupKey === group.key ? preview.id : null}
      onPreview={(id, trigger) => openPreview(group, id, trigger)}
    />
  );

  const previewBody = previewOpen && (
    <GamePreview
      group={previewGroup}
      previewId={preview.id}
      relations={scan.relations}
      nameOf={nameOf}
      onSelect={(id) => setPreview(p => ({ ...p, id }))}
      onClose={closePreview}
      headingId="dup-preview-title"
      headingRef={previewHeading}
    />
  );

  return (
    /* Docked, the page gives the rail its 24rem as right padding and the
       content column re-centres in what is left, so the groups keep their
       width wherever the window has room for both. */
    <div className={`min-h-screen antialiased pt-8 pb-16 bg-black text-white ${docked ? 'pr-[24rem]' : ''}`}>
      <div className="content-container">
        <PageHeader
          back={{ label: 'Library', to: '/library/backlog' }}
          className="mb-3 mt-2"
          titleClassName="text-[32px] lg:text-[56px]"
          title="Duplicates"
          count={groups && open.length > 0 ? plural(open.length, 'Group', 'Groups') : undefined}
          meta={groups && open.length > 0 ? [
            `${groups.same.length} same game`,
            plural(groups.related.length, 'related version', 'related versions'),
          ] : undefined}
        />
        <p className="text-[13px] text-white/60 mb-8 max-w-[65ch]">
          The same game entered more than once: editions, bundles, a custom entry beside its IGDB twin, and names that differ only by an edition. Merge keeps one entry and moves your status, rating, notes, platforms and collections onto it.
        </p>

        <div>
        <div className="min-w-0">
        <div aria-live="polite" className="text-[13px] text-white/60">
          {scan.state === 'loading' && (
            <p className="m-0">Checking {plural(total, 'game', 'games')} for editions, bundles, remakes and matching names.</p>
          )}
        </div>

        {scan.state === 'partial' && (
          <div role="status" className="border border-[var(--warning-border)] px-4 py-3 mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <p className="text-[13px] text-white/80 m-0 max-w-[70ch]">
              <span className="text-[var(--warning)]">IGDB did not respond,</span> so editions, bundles, remakes and remasters were not checked. Matches by name and custom entries are below.
            </p>
            <button
              onClick={retry}
              className="tap lh-label inline-flex items-center gap-2 px-3 py-2 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Try Again
            </button>
          </div>
        )}

        {groups && open.length === 0 && (
          total === 0 ? (
            <Plate
              title="Nothing to Check"
              body="Duplicates can only come from games in your library, and it is empty."
              action={<PlateLink to="/">Explore Games</PlateLink>}
            />
          ) : resolved > 0 ? (
            <Plate
              title="All Resolved"
              body={`Nothing left to review in ${plural(total, 'game', 'games')}.`}
              action={<PlateLink to="/library/backlog">Back to Library</PlateLink>}
            />
          ) : (
            <Plate
              title="No Duplicates"
              body={scan.state === 'partial'
                ? `No matching names or custom entries in ${plural(total, 'game', 'games')}. Editions, bundles and remakes were not checked.`
                : `Checked ${plural(total, 'game', 'games')} for editions, bundles, remakes, remasters, custom entries and matching names.`}
              action={<PlateLink to="/library/backlog">Back to Library</PlateLink>}
            />
          )
        )}

        {groups && groups.same.length > 0 && (
          <Section
            id="dup-same"
            title="Same Game"
            count={groups.same.length}
            blurb="Different entries for one game. The entry marked Keep stays; the others are removed once their data is on it."
          >
            {groups.same.map(g => renderGroup(g, false))}
          </Section>
        )}

        {groups && groups.related.length > 0 && (
          <Section
            id="dup-related"
            title="Related Versions"
            count={groups.related.length}
            quiet
            blurb="Remakes and remasters. Owning both is often on purpose, so these are suggestions, not problems."
          >
            {groups.related.map(g => renderGroup(g, true))}
          </Section>
        )}

        {groups && groups.dismissed.length > 0 && (
          <div className="mt-12 border-t border-white/15 pt-4">
            <button
              onClick={() => setShowDismissed(s => !s)}
              aria-expanded={showDismissed}
              aria-controls="dup-dismissed"
              className="tap lh-label inline-flex items-center gap-2 py-2 text-white/60 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${showDismissed ? 'rotate-180' : ''}`} aria-hidden="true" />
              {plural(groups.dismissed.length, 'Dismissed Group', 'Dismissed Groups')}
            </button>
            {showDismissed && (
              <ul id="dup-dismissed" className="mt-2 m-0 p-0 list-none">
                {groups.dismissed.map(g => (
                  <li key={g.key} className="flex items-center justify-between gap-4 py-2 border-t border-white/10 min-w-0">
                    <span className="text-[13px] text-white/70 truncate min-w-0">{listNames(g.members.map(nameOf))}</span>
                    <button
                      onClick={() => restore(g)}
                      className="tap lh-label shrink-0 px-3 py-1.5 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        </div>

        {docked && (
          <aside
            aria-labelledby="dup-preview-title"
            /* A second rail, the mirror of the nav on the left: full height on
               the window's right edge, below the desktop titlebar, one 1px rule
               where it meets the page. Enters from 12px right with a fade over
               200ms via @starting-style and leaves at once: arriving is the event
               worth showing, going away is not. Nothing moves under reduced
               motion. */
            className="fixed right-0 bottom-0 top-[var(--titlebar-h,0px)] z-40 w-[24rem] flex flex-col border-l border-white/15 bg-black transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none starting:opacity-0 starting:translate-x-3"
          >
            {previewBody}
          </aside>
        )}
        </div>

        {previewOpen && !isWide && (
          <Dialog
            open
            onClose={closePreview}
            labelledBy="dup-preview-title"
            initialFocus={previewHeading}
            /* A right-hand panel from sm, a bottom sheet below it that drags
               down to close. Both enter on the drawer curve `.animate-in`
               carries; the global reduced-motion rule flattens it. */
            alignClassName="items-end sm:items-stretch justify-center sm:justify-end"
            className="p-0"
            panelClassName="w-full sm:max-w-md max-h-[90vh] sm:max-h-none flex flex-col overflow-hidden animate-in [animation-name:fade-in-up] sm:[animation-name:slide-in-right]"
          >
            {/* The sheet drags down to close, and a sheet that can be dragged
                should look like it. Flat and square, like everything else. */}
            <div aria-hidden="true" className="sm:hidden flex justify-center pt-2 shrink-0">
              <span className="w-10 h-1 bg-white/30" />
            </div>
            {previewBody}
          </Dialog>
        )}
      </div>
    </div>
  );
}

function Section({ id, title, count, blurb, quiet = false, children }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="flex items-baseline justify-between gap-4 border-b border-white/15 pb-3">
        <h2 id={id} className={`lh-display text-[20px] lg:text-[28px] m-0 ${quiet ? 'text-white/70' : 'text-white'}`}>{title}</h2>
        <span className="lh-label text-white/60 tabular-nums">{plural(count, 'Group', 'Groups')}</span>
      </div>
      <p className="text-[13px] text-white/60 mt-3 mb-5 max-w-[65ch]">{blurb}</p>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Group({ group, related, relations, nameOf, keepId, fields, leaving, onKeep, onField, onMerge, onDismiss, previewId, onPreview }) {
  const conflicts = mergeConflicts(group.members, keepId, fields);
  const headingId = `dup-h-${group.key.replace(/[^a-z0-9_-]/gi, '-')}`;
  /* A custom entry and its IGDB twin, or a game and its remake, often share a
     name exactly, and "from Glass Rook" twice says nothing. Where names collide
     the source also says which entry it is. */
  const sourceOf = (id) => {
    const m = group.members.find(x => String(x.id) === String(id));
    const name = nameOf(m);
    const collides = group.members.some(x => x !== m && nameOf(x) === name);
    /* Never clipped: "Game of the Year Edition" is the part that tells two
       editions apart, and it is the part a clip removes first. */
    if (!collides) return name;
    const rel = relations.get(String(m.id));
    return `${name}, ${(versionLabel(m, rel) || yearOf(m, rel) || 'other entry').toString().toLowerCase()}`;
  };

  return (
    /* grid-template-rows 1fr to 0fr folds the group to nothing without knowing
       its height; the inner min-h-0 is what lets the row actually shrink. */
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
        leaving ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
      }`}
      inert={leaving}
    >
      <article
        data-dup-group
        tabIndex={-1}
        aria-labelledby={headingId}
        className="min-h-0 overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white"
      >
        <div className={`border ${related ? 'border-white/10' : 'border-white/20'}`}>
          <h3 id={headingId} className="lh-label text-white/70 m-0 px-4 py-3 border-b border-white/15">{reasonText(group)}</h3>

          <fieldset className="border-0 m-0 p-0 min-w-0">
            <legend className="sr-only">Which entry to keep</legend>
            {/* Rules drawn by each column's right and bottom edge, with the
                outer ones clipped, rather than a 1px gap over a grey ground:
                when three columns wrap to two, the gap method filled the empty
                cell with that grey, which read as a missing column. */}
            <div className="overflow-hidden">
            <div className="grid -mr-px -mb-px grid-cols-1 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
              {group.members.map(m => (
                <Column
                  key={String(m.id)}
                  entry={m}
                  relation={relations.get(String(m.id))}
                  name={nameOf(m)}
                  groupKey={group.key}
                  kept={String(m.id) === String(keepId)}
                  related={related}
                  onKeep={() => onKeep(m.id)}
                  previewing={previewId != null && String(previewId) === String(m.id)}
                  onPreview={(trigger) => onPreview(m.id, trigger)}
                />
              ))}
            </div>
            </div>
          </fieldset>

          {conflicts.length > 0 && (
            <div className="px-4 py-4 border-t border-white/15 flex flex-col gap-3">
              <p className="text-[13px] text-white/60 m-0">These differ between the entries. Pick the value the kept game ends with.</p>
              {conflicts.map(c => {
                const labelId = `${headingId}-${c.field}`;
                return (
                  <div key={c.field} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
                    <span id={labelId} className="lh-label text-white/60 sm:w-28 shrink-0">{FIELD_LABEL[c.field]}</span>
                    <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2 min-w-0">
                      {c.options.map(o => {
                        const active = String(o.id) === String(c.chosen);
                        return (
                          <label
                            key={String(o.id)}
                            className={`tap inline-flex items-center gap-2 px-3 py-2 border max-w-full text-left cursor-pointer transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-white has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-black ${
                              active ? 'border-white bg-white text-black' : 'border-white/20 text-white/70 hover:border-white/70 hover:text-white'
                            }`}
                          >
                            <input
                              type="radio"
                              name={labelId}
                              checked={active}
                              onChange={() => onField(c.field, o.id)}
                              className="sr-only"
                            />
                            {/* Black on the chosen chip, as the state cell flips its
                                swatch when filled: on white, 13 of the 14 state
                                colours measure under 3:1. */}
                            {valueColor(c.field, o.value) && (
                              <span
                                aria-hidden="true"
                                className={`w-2 h-2 shrink-0 ${active ? 'bg-black' : ''}`}
                                style={active ? undefined : { backgroundColor: valueColor(c.field, o.value) }}
                              />
                            )}
                            <span className="lh-label shrink-0">{displayValue(c.field, o.value)}</span>
                            <span className={`text-[13px] min-w-0 break-words ${active ? 'text-black/70' : 'text-white/60'}`}>
                              from {sourceOf(o.id)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-white/15">
            <button
              onClick={onDismiss}
              className="lh-label px-4 py-2.5 border border-white/20 text-white/60 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              {related ? (group.members.length > 2 ? 'Keep All' : 'Keep Both') : 'Not Duplicates'}
            </button>
            {/* The one control that writes. Related versions keep it outlined:
                merging a remake into its original is allowed, never suggested. */}
            <button
              onClick={onMerge}
              className={`lh-label inline-flex items-center gap-2 px-5 py-2.5 border active:scale-[0.97] transition-[transform,background-color,color] duration-150 ease-out motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                related ? 'border-white/40 text-white hover:bg-white hover:text-black' : 'border-white bg-white text-black hover:bg-neutral-200'
              }`}
            >
              <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
              Merge
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function Column({ entry, relation, name, groupKey, kept, related, onKeep, previewing, onPreview }) {
  const cover = entry.cover_id || relation?.cover?.image_id || null;
  const meta = [yearOf(entry, relation), versionLabel(entry, relation)].filter(Boolean).join(' · ');
  const status = normalizeStatus(entry.status) || entry.status || null;
  const owned = [...(entry.user_platforms || []), ...(entry.user_stores || [])]
    .map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
  const notes = String(entry.notes || '').trim();

  return (
    /* A subgrid three rows deep (fate, title, facts), so the rows are shared by
       every column in the same line of the group. A title that wraps to two
       lines used to push only its own column's facts down, 21px out of step
       with the column beside it, on a page whose whole job is reading rows
       across. */
    <div className={`bg-black p-4 grid grid-rows-subgrid row-span-3 gap-y-4 min-w-0 border-r border-b border-white/15 ${kept ? 'outline outline-1 outline-white -outline-offset-1' : ''}`}>
      {/* Two rows in every column, kept or not: the chip, then what happens to
          this entry. Letting the label wrap only where it did not fit put the
          removed columns' facts 40px below the kept column's once the preview
          narrowed them, and reading rows across columns is the page's job. */}
      <div className="flex flex-col items-start gap-2 min-w-0">
        {/* The same chip as a conflict's choices below: one grammar for "pick
            one of these" on the whole page, inverted when chosen. */}
        <label
          className={`tap inline-flex items-center px-3 py-1.5 border whitespace-nowrap cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-black ${
            kept ? 'border-white bg-white text-black' : 'border-white/20 text-white/70 hover:border-white/70 hover:text-white'
          }`}
        >
          <input type="radio" name={`keep-${groupKey}`} checked={kept} onChange={onKeep} className="sr-only" />
          {/* "Keep This" on an unchosen column, so it never reads "Keep" beside
              "Removed After Merge". The accessible name stays "Keep this, <game>,
              <year>, <kind>" in both states and carries the year and kind, since
              a custom entry and its IGDB twin share a name exactly. */}
          {/* One sr-only string rather than visible text plus a fragment:
              Chromium puts a space at an absolutely positioned span's edge, so
              the fragments announced "Keep This , Night Harbour". The name still
              contains both visible labels (2.5.3). */}
          <span aria-hidden="true" className="lh-label">{kept ? 'Keep' : 'Keep This'}</span>
          <span className="sr-only">{['Keep this', name, yearOf(entry, relation), versionLabel(entry, relation)].filter(Boolean).join(', ')}</span>
        </label>
        {/* Destructive red where a merge is the expected answer. Among related
            versions it is only a consequence, so it stays grey. */}
        <span className={`lh-label whitespace-nowrap ${kept || related ? 'text-white/60' : 'text-[var(--destructive)]'}`}>
          {kept ? 'Stays In Library' : related ? 'Removed If Merged' : 'Removed After Merge'}
        </span>
      </div>

      <div className="flex gap-3 min-w-0">
        <span className="w-14 h-[4.6rem] shrink-0 bg-neutral-900 border border-white/10 overflow-hidden flex items-center justify-center">
          {cover
            ? <img src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${cover}.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
            : <ImageOff className="w-4 h-4 text-white/50" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-white leading-snug m-0 line-clamp-3 break-words">{name}</p>
          <p className="lh-label text-white/60 mt-1.5 mb-0">{meta || 'Year unknown'}</p>
          {/* Outlined, never inverted: inversion on this page means "chosen to
              keep", and previewing a game chooses nothing. The game being
              previewed gets a full-white edge and aria-pressed instead. */}
          <button
            type="button"
            onClick={(e) => onPreview(e.currentTarget)}
            aria-pressed={previewing}
            className={`tap mt-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              previewing ? 'border-white text-white' : 'border-white/20 text-white/70 hover:border-white/70 hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span aria-hidden="true" className="lh-label">Preview</span>
            <span className="sr-only">{['Preview', name, yearOf(entry, relation), versionLabel(entry, relation)].filter(Boolean).join(', ')}</span>
          </button>
        </div>
      </div>

      {/* content-start: the subgrid stretches this list to the tallest facts
          block in the line, and without it the rows spread to fill that
          height, so Rating to Notes drifted up to 19px out of step while Status
          stayed level. */}
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] content-start gap-x-3 gap-y-2 m-0 text-[13px]">
        <Fact term="Status">{status && <Swatch color={statusColor(status)}>{status}</Swatch>}</Fact>
        <Fact term="Rating">{entry.feel && <Swatch color={feelColor(entry.feel)}>{entry.feel}</Swatch>}</Fact>
        <Fact term="Priority">{entry.priority && <Swatch color={priorityColor(entry.priority)}>{entry.priority}</Swatch>}</Fact>
        <Fact term="Owned On">{owned.length > 0 && <span className="text-white/80 break-words">{owned.join(', ')}</span>}</Fact>
        <Fact term="Notes">{notes && <span className="text-white/80 line-clamp-2 break-words">{notes}</span>}</Fact>
      </dl>
    </div>
  );
}

function Fact({ term, children }) {
  return (
    <>
      <dt className="lh-label text-white/60 pt-0.5">{term}</dt>
      <dd className="m-0 min-w-0">{children || <span className="text-white/50">None</span>}</dd>
    </>
  );
}

function Swatch({ color, children }) {
  return (
    <span className="inline-flex items-center gap-2 text-white/80">
      <span aria-hidden="true" className="w-2 h-2 shrink-0" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

function Plate({ title, body, action }) {
  return (
    <div className="border border-white/15 px-6 py-14 flex flex-col items-center gap-3 text-center">
      <GitMerge className="w-8 h-8 text-white/50" strokeWidth={1.25} aria-hidden="true" />
      <h2 id="dup-outcome" tabIndex={-1} className="lh-display text-xl text-white/70 m-0 outline-none">{title}</h2>
      <p className="text-[13px] text-white/60 max-w-[46ch] m-0">{body}</p>
      {action}
    </div>
  );
}

function PlateLink({ to, children }) {
  return (
    <Link
      to={to}
      className="lh-label mt-2 inline-flex items-center px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
    >
      {children}
    </Link>
  );
}
