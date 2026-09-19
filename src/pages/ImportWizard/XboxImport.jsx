/* Bringing an Xbox played list into the library.
 *
 * The shape is the Steam import's, and most of it is literally the same code
 * (ImportReview). Three things differ, all of them forced by Xbox rather than
 * chosen:
 *
 *   - There is no public profile to read. Microsoft publishes no owned-games
 *     API at all, so the only way in is a sign-in, and the list comes from
 *     titlehub -- what xbox.com itself shows as recently played.
 *   - Nothing is kept. No Microsoft or Xbox token is ever stored, so the sign-in
 *     buys exactly one read: coming back for a fresh list means signing in
 *     again, even for an Xbox account already linked to this LoreHaven account.
 *   - It is a played list, not a library. A game played on somebody else's
 *     console, or through a trial, is on it; a game bought and never started is
 *     not. The page says so, because a list that quietly differs from what
 *     somebody owns is worse than one that explains itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, RotateCcw } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import DropdownMenu from '../../components/ui/DropdownMenu';
import { toast } from '../../components/ui/toastBus';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { getLibrary, saveManyToLibrary, saveLibrary, addUserCustomPlatform } from '../../services/db';
import { matchXboxProducts, searchGames } from '../../services/igdb';
import { startXboxSignIn } from '../../services/xboxAuth';
import {
  XBOX_STORE, CONSOLES, buildXboxRows, rowReady, planXboxImport,
  linkRowToIgdb, unlinkRowFromIgdb,
} from '../../services/xboxImport';
import { importUndo } from '../../services/steamImport';
import { ImportReview, Progress } from './ImportReview';
import { nf, plural } from './importFormat';

const shortDate = (iso) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const playLine = (row) => {
  const when = row.lastPlayed ? shortDate(row.lastPlayed) : null;
  return when ? `Last played ${when}` : 'Xbox did not say when it was last played';
};

/* The console a row will be marked with. titlehub says where a title CAN run,
   never where it was played, so this is the app's best guess and the one thing
   on the row that asks to be corrected. */
const consoleCell = (row, setRow) => (
  <DropdownMenu
    align="left"
    matchAnchorWidth
    options={[
      ...Object.keys(CONSOLES).map(name => ({
        label: name,
        isActive: row.platform === name,
        onClick: () => setRow(row.key, { platform: name }),
      })),
      { label: 'No Console', dividerAbove: true, isActive: !row.platform, onClick: () => setRow(row.key, { platform: null }) },
    ]}
  >
    <button
      type="button"
      aria-label={`Console for ${row.igdb?.name || row.xboxName}`}
      className="tap-block w-full h-9 flex items-center justify-between gap-2 border border-white/20 bg-black pl-3 pr-2.5 lh-label text-white/80 hover:border-white/70 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      <span className="truncate">{row.platform || 'No Console'}</span>
      <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    </button>
  </DropdownMenu>
);

const XBOX_SOURCE = {
  service: 'Xbox',
  filters: [
    { id: 'all', label: 'All', test: () => true },
    { id: 'new', label: 'New', test: r => !r.existing && !!r.igdb },
    { id: 'library', label: 'In Library', test: r => !!r.existing },
    { id: 'byname', label: 'Check These', test: r => !!r.byName },
    { id: 'unmatched', label: 'Not on IGDB', test: r => !r.igdb },
  ],
  nameOf: (row) => row.igdb?.name || row.xboxName || `Xbox title ${row.titleId}`,
  searchSeed: (row) => row.xboxName || '',
  lines: (row) => [playLine(row)],
  extras: consoleCell,
  link: (row, game) => linkRowToIgdb(row, game, getLibrary()),
  unlink: (row) => unlinkRowFromIgdb(row, getLibrary()),
  onLinked: (game) => toast(`Matched to ${game.name}`),
  onDuplicate: (game) => toast(`${game.name} is already on this list`, 'error'),
  onBulkStatus: (n, status) => toast(`Set ${plural(n, 'selected game', 'selected games')} to ${status}`),
};

const failure = (stage, err) => {
  if (err?.status === 503) return { title: 'Xbox Import Is Not Switched On', body: 'This server cannot read Xbox libraries yet. The CSV import still works in the meantime.' };
  if (err?.status === 403) return { title: 'Xbox Live Would Not Allow That Account', body: err.message };
  if (stage === 'match') return { title: 'IGDB Did Not Answer', body: 'Your Xbox games came through, but they could not be matched to IGDB. Try again in a moment.' };
  if (err?.status === 502) return { title: 'Xbox Did Not Answer', body: err.message || 'Xbox would not hand over what this account has played. Try again in a moment.' };
  return { title: 'Xbox Did Not Answer', body: 'The request did not complete. Check your connection and try again.' };
};

export default function XboxImport() {
  const navigate = useNavigate();
  const location = useLocation();
  /* Handed over by /auth/xbox, which spent the sign-in on this read. Taken once:
     a refresh has no library to show and asks for a new sign-in, because the
     code that bought this one is gone. */
  const handed = location.state?.library || null;
  const [phase, setPhase] = useState(handed ? 'loading' : 'connect');
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [result, setResult] = useState(null);
  const undone = useRef(false);
  const ran = useRef(false);

  const step = (label, detail = null) => setSteps(s => [...s.map(x => ({ ...x, done: true })), { label, detail, done: false }]);
  const detail = (text) => setSteps(s => s.map((x, i) => (i === s.length - 1 ? { ...x, detail: text } : x)));

  /* From a played list to review rows. The library snapshot is taken at the
     end, so a game added in another tab while IGDB answered still shows as
     already in the library. */
  const build = useCallback(async (library) => {
    let stage = 'match';
    try {
      const titles = Array.isArray(library.titles) ? library.titles : [];
      step('Reading what this Xbox account has played');
      detail(plural(titles.length, 'game', 'games'));

      step('Matching games to IGDB by Microsoft Store id');
      const ids = titles.flatMap(t => t.productIds || []);
      const matches = await matchXboxProducts(ids);
      detail(plural(matches.size, 'Store id matched', 'Store ids matched'));

      /* Anything the Store ids missed gets one search by name, and arrives
         unticked: a search result is a suggestion, not a record. */
      step('Looking up the rest by name');
      const unmatched = titles.filter(t => !(t.productIds || []).some(id => matches.has(String(id))));
      const suggestions = new Map();
      for (const title of unmatched.slice(0, 40)) {
        const found = await searchGames(title.name).catch(() => []);
        const best = found?.[0];
        if (best && best.name.toLowerCase() === title.name.toLowerCase()) suggestions.set(String(title.titleId), best);
      }
      detail(plural(suggestions.size, 'name matched', 'names matched'));

      const built = buildXboxRows({ titles, matches, suggestions, library: getLibrary() });
      setRows(built.rows);
      setMeta({
        gamertag: library.gamertag || null,
        xuid: library.xuid || null,
        played: titles.length,
        matched: built.rows.filter(r => r.igdb && !r.byName).length,
        byName: built.rows.filter(r => r.byName).length,
        searched: unmatched.length,
        capped: Math.max(0, unmatched.length - 40),
      });
      setPhase('review');
    } catch (err) {
      setError(failure(stage, err));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (!handed || ran.current) return;
    ran.current = true;
    /* The list is held in memory from here; the address goes back to being a
       plain one, so a refresh asks for a sign-in instead of replaying nothing. */
    navigate('/import/xbox', { replace: true, state: null });
    build(handed);
  }, [handed, build, navigate]);

  const signIn = () => {
    startXboxSignIn({ purpose: 'import', from: '/import/xbox' })
      .catch(err => toast(err?.message || 'Xbox sign-in could not be started', 'error'));
  };

  const startOver = () => {
    setSteps([]);
    setError(null);
    setRows([]);
    setMeta(null);
    setResult(null);
    setPhase('connect');
  };

  const selected = rows.filter(r => r.selected);
  const ready = selected.filter(rowReady);
  const needsStatus = selected.length - ready.length;

  const doImport = () => {
    const library = getLibrary();
    const { entries, skipped } = planXboxImport(rows);
    if (entries.length === 0) return;
    const undo = importUndo(entries, library);
    addUserCustomPlatform(XBOX_STORE);
    saveManyToLibrary(entries);
    window.dispatchEvent(new Event('moctale_lib_update'));
    const added = undo.removeIds.length;
    const updated = entries.length - added;
    undone.current = false;
    setResult({ added, updated, skipped, undo, undone: false });
    setPhase('done');
    toast(`Imported ${plural(entries.length, 'game', 'games')} from Xbox`, 'info', {
      label: 'Undo',
      onClick: () => revert(undo),
    });
  };

  /* Offered twice, in the toast and on the done card, because the toast goes
     away and a large import is exactly the kind of thing someone reads over
     before deciding. Whichever is pressed first does it; the other does
     nothing. */
  const revert = (undo) => {
    if (undone.current) return;
    undone.current = true;
    if (undo.restore.length) saveManyToLibrary(undo.restore);
    if (undo.removeIds.length) {
      const gone = new Set(undo.removeIds.map(String));
      saveLibrary(getLibrary().filter(g => !gone.has(String(g.id))));
    }
    window.dispatchEvent(new Event('moctale_lib_update'));
    setResult(r => (r ? { ...r, undone: true } : r));
  };

  /* The Import button, or the card's Undo Import, is gone once pressed, so the
     result heading takes focus and the page returns to the top. */
  const doneHeading = useRef(null);
  useEffect(() => {
    if (phase !== 'done') return;
    window.scrollTo(0, 0);
    doneHeading.current?.focus({ preventScroll: true });
  }, [phase, result?.undone]);

  return (
    <div className={`min-h-screen antialiased pt-8 bg-black text-white ${phase === 'review' ? 'pb-40' : 'pb-16'}`}>
      <div className="content-container">
        <PageHeader
          back={{ label: 'Import', to: '/import' }}
          className="mb-3 mt-2"
          titleClassName="text-[32px] lg:text-[56px]"
          title="Xbox Games"
          count={phase === 'review' ? plural(rows.length, 'Game', 'Games') : undefined}
        />
        {phase !== 'done' && (
          <p className="text-[13px] text-white/60 mb-8 max-w-[65ch]">
            The games your Xbox account has played, matched to IGDB by their Microsoft Store ids, so each one lands as the right edition. You choose a status for every game before anything is saved.
          </p>
        )}

        {phase === 'connect' && (
          <div className="border border-white/15 px-6 py-8 max-w-2xl">
            <div className="flex items-center gap-3">
              <PlatformLogo platform={XBOX_STORE} className="w-8 h-8 p-1.5" disableTooltip />
              <h2 className="lh-display text-xl text-white m-0">Sign In With Xbox</h2>
            </div>
            <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">
              Xbox shares nothing about an account without its owner signing in, so this needs a Microsoft sign-in even if your Xbox account is already linked to LoreHaven: the sign-in buys one read and nothing is kept afterwards.
            </p>
            <p className="text-[13px] text-white/60 mt-0 mb-6 max-w-[60ch]">
              What comes back is what you have played, which is not quite what you own: a game played at a friend&apos;s house is on the list, and a game bought and never started is not.
            </p>
            <button
              type="button"
              onClick={signIn}
              className="tap-block lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Sign In With Xbox
            </button>
          </div>
        )}

        {phase === 'loading' && <Progress steps={steps} />}

        {phase === 'error' && error && (
          <div role="alert" className="border border-white/15 px-6 py-10 max-w-2xl">
            <h2 className="lh-display text-xl text-white m-0">{error.title}</h2>
            <p className="text-[13px] text-white/70 mt-3 mb-0 max-w-[60ch]">{error.body}</p>
            <div className="flex flex-wrap items-center gap-2 mt-6">
              <button onClick={signIn} className="tap lh-label inline-flex items-center gap-2 px-4 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Sign In and Try Again
              </button>
              <button onClick={startOver} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                Start Over
              </button>
            </div>
          </div>
        )}

        {phase === 'review' && meta && (
          <ImportReview
            source={XBOX_SOURCE}
            rows={rows}
            setRows={setRows}
            ready={ready.length}
            needsStatus={needsStatus}
            onImport={doImport}
            onStartOver={startOver}
            summary={(
              <p className="text-[13px] text-white/70 m-0 mb-5 tabular-nums">
                {[
                  `${plural(meta.played, 'game played', 'games played')}${meta.gamertag ? ` by ${meta.gamertag}` : ''}`,
                  `${nf.format(meta.matched)} matched by Store id`,
                  meta.byName > 0 ? `${nf.format(meta.byName)} matched by name to check` : null,
                  `${nf.format(rows.filter(r => r.existing).length)} already in your library`,
                ].filter(Boolean).join(', ')}.
                {meta.capped > 0 && ` ${plural(meta.capped, 'game was', 'games were')} left unsearched to keep this quick; find them by name in the list.`}
              </p>
            )}
          />
        )}

        {phase === 'done' && result && (
          <div className="border border-white/15 px-6 py-12 max-w-2xl mt-8">
            <h2 ref={doneHeading} tabIndex={-1} className="lh-display text-2xl text-white m-0 outline-none">
              {result.undone ? 'Import Undone' : `${plural(result.added + result.updated, 'Game', 'Games')} Imported`}
            </h2>
            <p className="text-[13px] text-white/70 mt-3 mb-0 max-w-[60ch]">
              {result.undone
                ? 'Your library is back as it was before the import.'
                : [
                  result.added > 0 && `${plural(result.added, 'game was', 'games were')} added`,
                  result.updated > 0 && `${plural(result.updated, 'game already in your library now has', 'games already in your library now have')} Xbox marked`,
                  result.skipped > 0 && `${plural(result.skipped, 'ticked game was', 'ticked games were')} skipped for having no status`,
                ].filter(Boolean).join('. ') + '.'}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-6">
              <Link
                to="/library/backlog"
                className="tap lh-label inline-flex items-center px-4 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                Open Library
              </Link>
              {!result.undone && (
                <button onClick={() => revert(result.undo)} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                  Undo Import
                </button>
              )}
              <button onClick={startOver} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                Import Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
