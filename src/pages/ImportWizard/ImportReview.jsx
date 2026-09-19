/* The review every store import ends at: a row per game, ticked or not, with a
 * status to choose and a way to find anything the store's ids missed.
 *
 * Written for Steam first and lifted here when Xbox arrived. What differs
 * between two stores is small and named: what a row is called, what its second
 * and third lines say, which views the filter offers, and whatever one control
 * only that store needs -- Xbox's console, which titlehub cannot tell us for
 * certain. Everything else is one implementation, so a fix to the row height,
 * the sticky bar or the bulk status reaches both.
 *
 * A `source` is that difference, as data:
 *
 *   service    'Steam' | 'Xbox', for labels and wording
 *   filters    the views, each { id, label, test }
 *   nameOf     what to call a row that IGDB has no name for
 *   searchSeed what to type into the IGDB search when the panel opens
 *   lines      up to two lines under the name, each a string or null
 *   extras     an optional control, drawn beside the status
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ImageOff, RotateCcw, Search, X } from 'lucide-react';
import Checkbox from '../../components/ui/Checkbox';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { searchGames } from '../../services/igdb';
import { statusColor } from '../../constants/stateColors';
import { STATUSES, TYPE_LABEL, nf, plural } from './importFormat';

const gameYear = (g) => (g?.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);
const gameMeta = (g) => [gameYear(g), TYPE_LABEL[g?.game_type]].filter(Boolean).join(' · ');

/** What a read is doing, one line per step, the finished ones ticked. */
export function Progress({ steps }) {
  return (
    <div aria-live="polite" aria-busy="true" className="max-w-2xl border border-white/15">
      <ol className="m-0 p-0 list-none">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-4 px-5 py-4 border-b border-white/15 last:border-b-0">
            {/* A bare check and a pulsing point, not boxes: a filled square with
                a tick is this app's checkbox, and nothing here can be ticked. */}
            <span aria-hidden="true" className="w-5 h-5 shrink-0 flex items-center justify-center">
              {s.done ? <Check className="w-4 h-4 text-white" strokeWidth={2.5} /> : <span className="w-2 h-2 bg-white animate-pulse motion-reduce:animate-none" />}
            </span>
            <span className="flex-1 min-w-0 text-[15px] text-white">{s.label}</span>
            {s.detail && <span className="text-[13px] text-white/60 tabular-nums">{s.detail}</span>}
            <span className="sr-only">{s.done ? 'done' : 'in progress'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* The IGDB search for one row, drawn from state the row owns: what it found,
   what it is still looking for, and what the owner typed. */
function LinkPanel({ name, search, onQuery, onRun, onPick, onClose }) {
  const { query, results, busy } = search;
  return (
    <div className="border border-white/15 mt-3 mb-1">
      <div className="flex border-b border-white/15">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" aria-hidden="true" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onRun(query); }}
            aria-label={`Search IGDB for ${name}`}
            placeholder="Search IGDB"
            className="tap-block w-full h-11 pl-9 pr-3 bg-black lh-label text-white outline-none placeholder:text-white/50 focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-inset"
          />
        </div>
        <button
          type="button"
          onClick={() => onRun(query)}
          aria-disabled={busy || undefined}
          className="tap lh-label px-4 border-l border-white/15 text-white/70 hover:bg-white hover:text-black transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-inset"
        >
          {busy ? 'Searching' : 'Search'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close the IGDB search for ${name}`}
          className="tap px-3 border-l border-white/15 text-white/60 hover:bg-white hover:text-black transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-inset"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto custom-scrollbar" aria-busy={busy || undefined}>
        {busy || results === null
          ? <p className="lh-label text-white/60 px-4 py-5 m-0">Searching IGDB</p>
          : results.length === 0
            ? <p className="lh-label text-white/60 px-4 py-5 m-0">No match on IGDB. Try another name, or leave it as a custom entry.</p>
            : results.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g)}
                aria-label={`Match ${name} to ${g.name}`}
                className="tap-block group w-full flex items-center gap-3 p-3 text-left border-b border-white/10 last:border-b-0 text-white hover:bg-white hover:text-black transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-inset"
              >
                <span className="w-8 h-11 shrink-0 bg-neutral-900 border border-white/10 overflow-hidden flex items-center justify-center">
                  {g.cover?.image_id
                    ? <img src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${g.cover.image_id}.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <ImageOff className="w-3.5 h-3.5 text-white/50 group-hover:text-black/50" aria-hidden="true" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] leading-snug truncate">{g.name}</span>
                  <span className="block lh-label text-white/60 group-hover:text-black/60 truncate">{gameMeta(g) || 'Game'}</span>
                </span>
              </button>
            ))}
      </div>
    </div>
  );
}

/* Memoised on the row object: setRow replaces only the row that changed, so a
   status picked on one game re-renders one row, not a thousand. onLink and
   onUnlink are stable for the same reason. */
const Row = memo(function Row({ row, source, setRow, onLink, onUnlink }) {
  /* null while the panel is closed, so no row holds search results it is not
     showing. The search runs from the click that opens the panel, never from an
     effect. */
  const [search, setSearch] = useState(null);

  const runSearch = async (text) => {
    const q = (text ?? '').trim();
    if (q.length < 2) { setSearch(s => (s ? { ...s, query: q, results: [], busy: false } : s)); return; }
    setSearch(s => (s ? { ...s, query: q, busy: true } : s));
    let found = [];
    try { found = await searchGames(q); } catch { found = []; }
    setSearch(s => (s ? { ...s, results: found, busy: false } : s));
  };

  /* The store's own name for it is the obvious first search, so opening the
     panel runs it. */
  const openSearch = () => {
    const q = source.searchSeed(row) || '';
    setSearch({ query: q, results: null, busy: true });
    runSearch(q);
  };

  const name = source.nameOf(row);
  const cover = row.igdb?.cover?.image_id;
  const meta = row.igdb
    ? gameMeta(row.igdb)
    : row.selected ? 'Not on IGDB, imported as a custom entry' : 'Not on IGDB. Tick to add it as a custom entry';
  const shownStatus = row.status || row.existing?.status || null;
  /* What the control says when the row carries no status of its own: a game
     already in the library keeps the one it has, a new one has none yet. */
  const restLabel = row.existing ? `Keep ${row.existing.status || 'As Is'}` : 'Choose Status';
  const statusOptions = [
    ...STATUSES.map(s => ({
      label: s,
      color: statusColor(s),
      isActive: row.status === s,
      onClick: () => setRow(row.key, { status: s, selected: true }),
    })),
    ...(row.status ? [{
      /* Clearing it: a library game goes back to the status it already has, a
         new one back to none. */
      label: row.existing ? restLabel : 'No Status',
      dividerAbove: true,
      isActive: false,
      onClick: () => setRow(row.key, { status: null }),
    }] : []),
  ];

  const lines = (source.lines?.(row) || []).filter(Boolean);
  const extras = source.extras?.(row, setRow) || null;

  return (
    /* content-visibility lets the browser skip laying out rows far off screen,
       which is what keeps a thousand-row library scrolling smoothly. */
    <li className="grid grid-cols-[auto_auto_minmax(0,1fr)] sm:grid-cols-[auto_auto_minmax(0,1fr)_13rem] items-center gap-x-4 gap-y-2 py-3 border-b border-white/15 [content-visibility:auto] [contain-intrinsic-size:auto_76px]">
      {/* Inside a label on purpose. Checkbox hides its native input with
          pointer-events: none and draws its own box, so on its own the box
          ignores a click; the label is what forwards the click to the input,
          and it gives the 16px box a 24px target. */}
      <label className="tap inline-flex items-center justify-center min-w-6 min-h-6 cursor-pointer">
        <Checkbox
          checked={row.selected}
          onChange={() => setRow(row.key, { selected: !row.selected })}
          aria-label={`Import ${name}`}
        />
      </label>
      <span className="w-9 h-12 shrink-0 bg-neutral-900 border border-white/10 overflow-hidden flex items-center justify-center">
        {cover
          ? <img src={`https://images.igdb.com/igdb/image/upload/t_cover_small/${cover}.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <ImageOff className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        <p className={`text-[15px] leading-snug m-0 truncate ${row.selected ? 'text-white' : 'text-white/60'}`}>{name}</p>
        <p className="lh-label text-white/60 mt-1 mb-0 truncate">
          {row.existing ? `In your library as ${row.existing.status || 'no status'}` : meta}
        </p>
        {lines.map((line, i) => (
          <p key={i} className="text-[13px] text-white/60 mt-0.5 mb-0 truncate">{line}</p>
        ))}

        {/* A game the store's ids missed can still be found by name, the way the
            CSV import's review does it. Ticking it without searching still
            imports it as a custom entry. */}
        {!row.igdb && (
          <button
            type="button"
            onClick={() => (search ? setSearch(null) : openSearch())}
            aria-expanded={!!search}
            className="tap lh-label inline-flex items-center min-h-6 gap-1.5 mt-1.5 text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            {search ? 'Close Search' : 'Find It on IGDB'}
          </button>
        )}
        {(row.linkedByHand || row.byName) && (
          <span className="lh-label text-white/60 inline-flex flex-wrap items-center gap-2 mt-1.5">
            {row.linkedByHand ? 'Matched by hand' : 'Matched by name, check it'}
            <button
              type="button"
              onClick={() => onUnlink(row.key)}
              className="tap inline-flex items-center min-h-6 gap-1.5 text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              {row.linkedByHand ? 'Undo Match' : 'Not This Game'}
            </button>
          </span>
        )}
      </div>

      {/* The state cell: once a game has a status the control fills with that
          status's colour and its label turns black (DESIGN.md, the three
          shapes). No amber on arrival: most rows start ticked with no status
          because the page ticked them, which is not a problem to flag; the
          import bar's count says how many are waiting. */}
      <div className="col-span-3 sm:col-span-1 flex flex-col gap-2 pl-[calc(1.5rem+2.25rem+2rem)] sm:pl-0">
        <DropdownMenu align="left" matchAnchorWidth options={statusOptions}>
          <button
            type="button"
            aria-label={`Status for ${name}`}
            style={shownStatus ? { backgroundColor: statusColor(shownStatus), borderColor: statusColor(shownStatus) } : undefined}
            className={`tap-block w-full h-9 flex items-center justify-between gap-2 border pl-3 pr-2.5 lh-label cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              shownStatus ? 'text-black' : 'bg-black border-white/20 text-white/80 hover:border-white/70'
            }`}
          >
            <span className="truncate">{row.status || restLabel}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenu>
        {extras}
      </div>

      {search && !row.igdb && (
        <div className="col-span-3 sm:col-span-4">
          <LinkPanel
            name={name}
            search={search}
            onQuery={(v) => setSearch(s => (s ? { ...s, query: v } : s))}
            onRun={runSearch}
            onPick={(g) => { onLink(row.key, g); setSearch(null); }}
            onClose={() => setSearch(null)}
          />
        </div>
      )}
    </li>
  );
});

/**
 * The review itself: the views, the bulk controls, the rows, and the one button
 * that writes. `summary` is the store's own sentence about what it found;
 * everything below it is the same wherever the games came from.
 */
export function ImportReview({ source, rows, setRows, summary, onImport, onStartOver, ready, needsStatus }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const setRow = useCallback((key, patch) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }, [setRows]);

  /* Read through a ref so the two callbacks below never change identity: a new
     onLink on every keystroke would re-render all thousand memoised rows. */
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  /* Matched to an IGDB game by hand. Refused when that game is already a row of
     its own, because two rows writing one game would import it twice and the
     second write would win. */
  const onLink = useCallback((key, game) => {
    if (rowsRef.current.some(r => r.key === `igdb:${game.id}`)) {
      source.onDuplicate?.(game);
      return;
    }
    setRows(rs => rs.map(r => (r.key === key ? source.link(r, game) : r)));
    source.onLinked?.(game);
  }, [setRows, source]);

  const onUnlink = useCallback((key) => {
    setRows(rs => rs.map(r => (r.key === key ? source.unlink(r) : r)));
  }, [setRows, source]);

  const counts = useMemo(
    () => Object.fromEntries(source.filters.map(f => [f.id, rows.filter(f.test).length])),
    [rows, source],
  );
  const shown = useMemo(() => {
    const test = source.filters.find(f => f.id === filter)?.test || (() => true);
    const q = query.trim().toLowerCase();
    return rows.filter(r => test(r) && (!q || source.nameOf(r).toLowerCase().includes(q)));
  }, [rows, filter, query, source]);

  const shownSelected = shown.filter(r => r.selected).length;
  const allShown = shown.length > 0 && shownSelected === shown.length;

  const toggleShown = () => {
    const keys = new Set(shown.map(r => r.key));
    setRows(rs => rs.map(r => (keys.has(r.key) ? { ...r, selected: !allShown } : r)));
  };

  /* Acts on the ticked games in the current view, the same set the select-all
     box and its count describe. A status never reaches a game the filter is
     hiding. */
  const bulkStatus = (status) => {
    const keys = new Set(shown.filter(r => r.selected).map(r => r.key));
    setRows(rs => rs.map(r => (keys.has(r.key) ? { ...r, status: r.existing && status === r.existing.status ? null : status } : r)));
    source.onBulkStatus?.(keys.size, status);
  };

  return (
    <>
      {summary}

      {/* Controls stick under the page top while the list scrolls: with a
          library of a thousand games, the filter and the bulk status are what
          gets used, and scrolling back up for them is the cost. Pinned the way
          the library's shelf strip is: at the header's full height, then moved
          up by however much of the header has hidden itself on scroll. */}
      <div
        className="sticky z-20 bg-black border-y border-white/15 py-3 flex flex-col gap-3 transition-transform duration-300 ease-in-out motion-reduce:transition-none"
        style={{
          top: 'calc(var(--mobile-nav-h, 0px) + env(safe-area-inset-top, 0px) + var(--titlebar-h, 0px))',
          transform: 'translateY(calc(var(--mobile-nav-offset, 0px) - var(--mobile-nav-h, 0px) - env(safe-area-inset-top, 0px)))',
        }}
      >
        <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
          {source.filters.map(f => {
            const on = f.id === filter;
            return (
              <label
                key={f.id}
                /* The chosen view inverts, as every chosen option in this world
                   does (DESIGN.md, Flat-By-Default). */
                className={`tap inline-flex items-center gap-2 px-3 py-1.5 border whitespace-nowrap cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-black ${
                  on ? 'border-white bg-white text-black' : 'border-white/20 text-white/60 hover:border-white/70 hover:text-white'
                }`}
              >
                <input type="radio" name={`${source.service.toLowerCase()}-filter`} checked={on} onChange={() => setFilter(f.id)} className="sr-only" />
                <span className="lh-label">{f.label}</span>
                <span className={`text-[13px] tabular-nums ${on ? 'text-black/70' : 'text-white/60'}`}>{nf.format(counts[f.id])}</span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* Counts what it acts on: the games in this view. Mixed when some of
              them are ticked, so an empty box never sits beside twelve ticked
              rows. */}
          <label className="tap-block flex items-center gap-3 py-1 cursor-pointer select-none">
            <Checkbox
              checked={allShown}
              indeterminate={shownSelected > 0 && !allShown}
              onChange={toggleShown}
              aria-label={allShown ? 'Deselect every game shown' : 'Select every game shown'}
            />
            <span className="lh-label text-white/70 tabular-nums">{nf.format(shownSelected)} of {nf.format(shown.length)} Selected</span>
          </label>
          <DropdownMenu
            align="left"
            options={STATUSES.map(s => ({ label: s, color: statusColor(s), onClick: () => bulkStatus(s) }))}
          >
            <button
              disabled={shownSelected === 0}
              aria-label={`Set a status for ${plural(shownSelected, 'selected game', 'selected games')}`}
              className="tap lh-label inline-flex items-center gap-2 h-9 px-3 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer disabled:cursor-default disabled:hover:border-white/20 disabled:hover:text-white/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Set Status
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </DropdownMenu>
          <div className="relative flex-1 min-w-[12rem] max-w-sm ml-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/60" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter games by name"
              placeholder="Filter by name"
              className="tap-block w-full h-9 bg-black border border-white/20 pl-9 pr-3 text-[13px] text-white placeholder:text-white/50 focus:border-white/70 outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-[13px] text-white/60 py-10 border-b border-white/15 m-0">
          {query ? `No game matching "${query}" in this view.` : 'Nothing in this view.'}
        </p>
      ) : (
        <ul aria-label={`${source.service} games`} className="m-0 p-0 list-none">
          {shown.map(row => (
            <Row key={row.key} row={row} source={source} setRow={setRow} onLink={onLink} onUnlink={onUnlink} />
          ))}
        </ul>
      )}

      {/* The one control that writes, pinned where the eye ends a long list. It
          counts only what will actually be saved, and says how many ticked games
          are waiting on a status. */}
      <div className="fixed bottom-0 left-0 lg:left-[220px] right-0 z-30 bg-black border-t border-white/15 pb-[env(safe-area-inset-bottom)]">
        <div className="content-container flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <p aria-live="polite" className="text-[13px] text-white/70 m-0 tabular-nums">
            {ready === 0
              ? 'Tick games and give them a status to import them.'
              : `${plural(ready, 'game', 'games')} ready.`}
            {needsStatus > 0 && <span className="text-[var(--warning)]"> {plural(needsStatus, 'ticked game needs', 'ticked games need')} a status.</span>}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onStartOver} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
              Start Over
            </button>
            <button
              onClick={onImport}
              disabled={ready === 0}
              className="tap lh-label px-5 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:bg-transparent disabled:text-white/50 disabled:border-white/20 disabled:cursor-default disabled:active:scale-100"
            >
              {ready > 0 ? `Import ${plural(ready, 'Game', 'Games')}` : 'Nothing to Import'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
