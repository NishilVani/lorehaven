import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ImageOff, RotateCcw, Search } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import Checkbox from '../../components/ui/Checkbox';
import DropdownMenu from '../../components/ui/DropdownMenu';
import ExternalLink from '../../components/ui/ExternalLink';
import { toast } from '../../components/ui/toastBus';
import { getLibrary, saveManyToLibrary, saveLibrary, addUserCustomPlatform } from '../../services/db';
import { matchSteamApps } from '../../services/igdb';
import {
  verifySteamSignIn, resolveSteamProfile, getSteamOwnedGames, getSteamWishlist,
  steamSignInUrl, openIdParamsFrom,
} from '../../services/steam';
import { parseProfileInput } from '../../services/steamProfile';
import { STEAM_STORE, buildSteamRows, rowReady, planSteamImport, importUndo } from '../../services/steamImport';
import { statusColor } from '../../constants/stateColors';
import { isTauri } from '../../services/openExternal';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';

/* Unreleased is left out: the library moves games onto and off that shelf from
   IGDB's release dates, so choosing it by hand would not hold. */
const STATUSES = ['Playing', 'Backlog', 'Wishlist', 'Beaten', 'Dropped'];

const TYPE_LABEL = { 1: 'DLC', 2: 'Expansion', 3: 'Bundle', 4: 'Standalone Expansion', 8: 'Remake', 9: 'Remaster', 10: 'Expanded', 11: 'Port' };

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'new', label: 'New', test: r => !r.existing && !!r.igdb },
  { id: 'library', label: 'In Library', test: r => !!r.existing },
  { id: 'wishlist', label: 'Wishlist', test: r => r.source === 'wishlist' },
  { id: 'unmatched', label: 'Not on IGDB', test: r => !r.igdb },
];

const PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';
const nf = new Intl.NumberFormat('en-GB');
const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;
const shortDate = (unix) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const playLine = (row) => {
  if (row.source === 'wishlist') return 'On your Steam wishlist';
  const m = row.playtimeMinutes;
  const time = m === 0 ? 'Never played' : m < 60 ? `${m} min played` : `${nf.format(Math.round(m / 60))} h played`;
  return row.lastPlayed ? `${time}, last on ${shortDate(row.lastPlayed)}` : time;
};

/* What a failure says, keyed by where it happened and what the Worker answered.
   Each one names the recovery, not only the problem. */
const failure = (stage, err) => {
  if (err?.status === 503) return { title: 'Steam Import Is Not Switched On', body: 'This server has no Steam API key yet, so it cannot read Steam libraries. The CSV import still works in the meantime.' };
  if (stage === 'verify') return { title: 'Steam Did Not Confirm That Sign-In', body: 'The sign-in may have expired or been used already. Sign in with Steam again, or paste your profile link.' };
  if (stage === 'resolve' && err?.status === 404) return { title: 'No Steam Profile by That Name', body: 'Check the spelling, or copy the full address from your profile page on Steam.' };
  if (stage === 'private') return { title: 'Steam Kept This Library Private', body: 'Steam only shares a library whose Game details are public. Set Game details to Public in your Steam privacy settings, then try again.', privacy: true };
  if (stage === 'match') return { title: 'IGDB Did Not Answer', body: 'Your Steam library came through, but the games could not be matched to IGDB. Try again in a moment.' };
  return { title: 'Steam Did Not Answer', body: 'The request did not complete. Check your connection and try again.' };
};

export default function SteamImport() {
  const navigate = useNavigate();
  const [openid] = useState(() => openIdParamsFrom(window.location.search));
  const [phase, setPhase] = useState(openid ? 'loading' : 'connect');
  const [profile, setProfile] = useState('');
  const [profileError, setProfileError] = useState('');
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [steamid, setSteamid] = useState(null);
  const undone = useRef(false);
  const inApp = isTauri();

  const step = (label, detail = null) => setSteps(s => [...s.map(x => ({ ...x, done: true })), { label, detail, done: false }]);
  const detail = (text) => setSteps(s => s.map((x, i) => (i === s.length - 1 ? { ...x, detail: text } : x)));

  /* The whole read, from a Steam id to review rows. The library snapshot is
     taken at the end, so a game added in another tab while Steam answered still
     shows as already in the library. */
  const load = useCallback(async (id) => {
    const steamid = id;
    setSteamid(id);
    let stage = 'owned';
    try {
      step('Reading your Steam library');
      const owned = await getSteamOwnedGames(steamid);
      if (!owned.visible) { stage = 'private'; throw new Error('private'); }
      detail(plural(owned.games.length, 'game', 'games'));

      step('Reading your Steam wishlist');
      const wish = await getSteamWishlist(steamid);
      detail(wish.available ? plural(wish.items.length, 'game', 'games') : 'Steam did not share it');

      step('Matching games to IGDB by Steam app id');
      stage = 'match';
      const matches = await matchSteamApps([...owned.games.map(g => g.appid), ...wish.items.map(i => i.appid)]);
      detail(plural(matches.size, 'Steam app matched', 'Steam apps matched'));

      const built = buildSteamRows({ owned: owned.games, wishlist: wish.items, matches, library: getLibrary() });
      setRows(built.rows);
      setMeta({
        steamid,
        owned: owned.games.length,
        wishlistAvailable: wish.available,
        wishlist: wish.items.length,
        droppedWishlist: built.droppedWishlist,
      });
      setFilter('all');
      setQuery('');
      setPhase('review');
    } catch (err) {
      setError(failure(stage, err));
      setPhase('error');
    }
  }, []);

  /* Back from Steam's sign-in page. The openid.* fields are taken off the
     address straight away, so a refresh or a shared link never replays them;
     Steam would refuse a second check of the same sign-in anyway. */
  useEffect(() => {
    if (!openid) return undefined;
    let live = true;
    navigate('/import/steam', { replace: true });
    (async () => {
      if (openid['openid.mode'] !== 'id_res') {
        await Promise.resolve();
        if (!live) return;
        setError({ title: 'Steam Sign-In Was Cancelled', body: 'Nothing was read from Steam. Sign in again, or paste your profile link instead.' });
        setPhase('error');
        return;
      }
      try {
        await Promise.resolve();
        if (!live) return;
        step('Confirming your Steam sign-in');
        const verified = await verifySteamSignIn(openid);
        if (live) await load(verified.steamid);
      } catch (err) {
        if (!live) return;
        setError(failure('verify', err));
        setPhase('error');
      }
    })();
    return () => { live = false; };
  }, [openid, navigate, load]);

  const submitProfile = async (e) => {
    e.preventDefault();
    const parsed = parseProfileInput(profile);
    if (!parsed) {
      setProfileError('That is not a Steam profile. Paste an address like steamcommunity.com/id/yourname, or just the custom name.');
      return;
    }
    setProfileError('');
    setSteps([]);
    setPhase('loading');
    try {
      step('Finding your Steam account');
      const resolved = await resolveSteamProfile(profile);
      await load(resolved.steamid);
    } catch (err) {
      setError(failure('resolve', err));
      setPhase('error');
    }
  };

  const signIn = () => {
    window.location.assign(steamSignInUrl(`${window.location.origin}/import/steam`));
  };

  const startOver = () => {
    setSteps([]);
    setError(null);
    setRows([]);
    setMeta(null);
    setResult(null);
    setSteamid(null);
    setPhase('connect');
  };

  /* Only offered once the account is known: a failure before that is fixed by
     changing the profile or signing in again, which Start Over is for. */
  const retry = () => {
    setSteps([]);
    setError(null);
    setPhase('loading');
    load(steamid);
  };

  /* ── Review state ── */
  const setRow = useCallback((key, patch) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, rows.filter(f.test).length])), [rows]);
  const shown = useMemo(() => {
    const test = FILTERS.find(f => f.id === filter)?.test || (() => true);
    const q = query.trim().toLowerCase();
    return rows.filter(r => test(r) && (!q || (r.igdb?.name || r.steamName || '').toLowerCase().includes(q)));
  }, [rows, filter, query]);

  const selected = rows.filter(r => r.selected);
  const ready = selected.filter(rowReady);
  const needsStatus = selected.length - ready.length;
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
    toast(`Set ${plural(keys.size, 'selected game', 'selected games')} to ${status}`);
  };

  const doImport = () => {
    const library = getLibrary();
    const { entries, skipped } = planSteamImport(rows);
    if (entries.length === 0) return;
    const undo = importUndo(entries, library);
    addUserCustomPlatform(STEAM_STORE);
    saveManyToLibrary(entries);
    window.dispatchEvent(new Event('moctale_lib_update'));
    const added = undo.removeIds.length;
    const updated = entries.length - added;
    undone.current = false;
    setResult({ added, updated, skipped, undo, undone: false });
    setPhase('done');
    toast(`Imported ${plural(entries.length, 'game', 'games')} from Steam`, 'info', {
      label: 'Undo',
      onClick: () => revert(undo),
    });
  };

  /* Offered twice, in the toast and on the done card, because the toast goes
     away and a large import is exactly the kind of thing someone reads over
     before deciding. Whichever is pressed first does it; the other does nothing. */
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

  const reviewAgain = async () => {
    if (!meta?.steamid) { startOver(); return; }
    setSteps([]);
    setResult(null);
    setPhase('loading');
    await load(meta.steamid);
  };

  /* The Import button, or the card's Undo Import, is gone once pressed, so the
     result heading takes focus and the page returns to the top: a long list
     scrolled far down would otherwise open the card under the nav. */
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
          title="Steam Library"
          count={phase === 'review' ? plural(rows.length, 'Game', 'Games') : undefined}
        />
        {phase !== 'done' && (
          <p className="text-[13px] text-white/60 mb-8 max-w-[65ch]">
            The games you own on Steam, and your wishlist, matched to IGDB by Steam&apos;s own app ids, so each one lands as the right edition. You choose a status for every game before anything is saved.
          </p>
        )}

        {phase === 'connect' && (
          <Connect
            inApp={inApp}
            profile={profile}
            setProfile={(v) => { setProfile(v); if (profileError) setProfileError(''); }}
            profileError={profileError}
            onSubmit={submitProfile}
            onSignIn={signIn}
          />
        )}

        {phase === 'loading' && <Progress steps={steps} />}

        {phase === 'error' && error && (
          <div role="alert" className="border border-white/15 px-6 py-10 max-w-2xl">
            <h2 className="lh-display text-xl text-white m-0">{error.title}</h2>
            <p className="text-[13px] text-white/70 mt-3 mb-0 max-w-[60ch]">{error.body}</p>
            <div className="flex flex-wrap items-center gap-2 mt-6">
              {error.privacy && (
                <ExternalLink
                  href={PRIVACY_URL}
                  className="tap lh-label inline-flex items-center px-4 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  Open Steam Privacy Settings
                </ExternalLink>
              )}
              {steamid && !error.privacy && (
                <button onClick={retry} className="tap lh-label inline-flex items-center gap-2 px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Try Again
                </button>
              )}
              <button onClick={startOver} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                Start Over
              </button>
            </div>
          </div>
        )}

        {phase === 'review' && meta && (
          <>
            <p className="text-[13px] text-white/70 m-0 mb-5 tabular-nums">
              {[
                plural(meta.owned, 'owned game', 'owned games'),
                meta.wishlistAvailable ? plural(meta.wishlist, 'wishlisted', 'wishlisted') : 'no wishlist from Steam',
                `${nf.format(counts.library)} already in your library`,
                `${nf.format(counts.unmatched)} not on IGDB`,
              ].join(', ')}.
              {meta.droppedWishlist > 0 && ` ${plural(meta.droppedWishlist, 'wishlisted item is', 'wishlisted items are')} not on IGDB and left out.`}
            </p>

            {/* Controls stick under the page top while the list scrolls: with a
                library of a thousand games, the filter and the bulk status are
                what gets used, and scrolling back up for them is the cost. */}
            {/* Pinned the way the library's shelf strip is: at the header's full
                height, then moved up by however much of the header has hidden
                itself on scroll. Pinned under --mobile-nav-h alone, rows
                scrolled through a 56px band above it once the header hid. */}
            <div
              className="sticky z-20 bg-black border-y border-white/15 py-3 flex flex-col gap-3 transition-transform duration-300 ease-in-out motion-reduce:transition-none"
              style={{
                top: 'calc(var(--mobile-nav-h, 0px) + env(safe-area-inset-top, 0px) + var(--titlebar-h, 0px))',
                transform: 'translateY(calc(var(--mobile-nav-offset, 0px) - var(--mobile-nav-h, 0px) - env(safe-area-inset-top, 0px)))',
              }}
            >
              <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
                {FILTERS.map(f => {
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
                      <input type="radio" name="steam-filter" checked={on} onChange={() => setFilter(f.id)} className="sr-only" />
                      <span className="lh-label">{f.label}</span>
                      <span className={`text-[13px] tabular-nums ${on ? 'text-black/70' : 'text-white/60'}`}>{nf.format(counts[f.id])}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                {/* Counts what it acts on: the games in this view. Mixed when
                    some of them are ticked, so an empty box never sits beside
                    twelve ticked rows. */}
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
              <ul aria-label="Steam games" className="m-0 p-0 list-none">
                {shown.map(row => <Row key={row.key} row={row} setRow={setRow} />)}
              </ul>
            )}

            {/* The one control that writes, pinned where the eye ends a long
                list. It counts only what will actually be saved, and says how
                many ticked games are waiting on a status. */}
            <div className="fixed bottom-0 left-0 lg:left-[220px] right-0 z-30 bg-black border-t border-white/15 pb-[env(safe-area-inset-bottom)]">
              <div className="content-container flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
                <p aria-live="polite" className="text-[13px] text-white/70 m-0 tabular-nums">
                  {ready.length === 0
                    ? 'Tick games and give them a status to import them.'
                    : `${plural(ready.length, 'game', 'games')} ready.`}
                  {needsStatus > 0 && <span className="text-[var(--warning)]"> {plural(needsStatus, 'ticked game needs', 'ticked games need')} a status.</span>}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={startOver} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                    Start Over
                  </button>
                  <button
                    onClick={doImport}
                    disabled={ready.length === 0}
                    className="tap lh-label px-5 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:bg-transparent disabled:text-white/50 disabled:border-white/20 disabled:cursor-default disabled:active:scale-100"
                  >
                    {ready.length > 0 ? `Import ${plural(ready.length, 'Game', 'Games')}` : 'Nothing to Import'}
                  </button>
                </div>
              </div>
            </div>
          </>
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
                  result.updated > 0 && `${plural(result.updated, 'game already in your library now has', 'games already in your library now have')} Steam marked`,
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
              <button onClick={reviewAgain} className="tap lh-label px-4 py-2.5 border border-white/20 text-white/70 hover:border-white/70 hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">
                Review Steam Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Connect({ inApp, profile, setProfile, profileError, onSubmit, onSignIn }) {
  return (
    <div className="max-w-4xl">
      {/* Two equal ways in, side by side, ruled rather than carded. */}
      <div className="grid md:grid-cols-2 border border-white/15">
        <section aria-labelledby="steam-signin-title" className="p-6 flex flex-col gap-4 border-b md:border-b-0 md:border-r border-white/15">
          {/* Steam's own mark, the one sanctioned place colour comes from on a
              page that is entirely about Steam (DESIGN.md, platform marks). */}
          <div className="flex items-center gap-3">
            <PlatformLogo platform={STEAM_STORE} className="w-8 h-8 p-1.5" disableTooltip />
            <h2 id="steam-signin-title" className="lh-display text-xl text-white m-0">Sign In With Steam</h2>
          </div>
          <p className="text-[13px] text-white/60 m-0 max-w-[45ch]">
            Opens Steam&apos;s own sign-in page. LoreHaven never sees your password, only the public id of the account you sign in with.
          </p>
          {inApp ? (
            <p className="text-[13px] text-white/70 m-0 mt-auto border-t border-white/15 pt-4">
              Signing in with Steam comes to the desktop and Android apps in the next update. Use your profile link for now.
            </p>
          ) : (
            <button
              onClick={onSignIn}
              className="mt-auto self-start tap lh-label px-5 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Sign In With Steam
            </button>
          )}
        </section>

        <section aria-labelledby="steam-link-title" className="p-6">
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 h-full">
            <h2 id="steam-link-title" className="lh-display text-xl text-white m-0">Use Your Profile Link</h2>
            <div className="flex flex-col gap-2">
              <label htmlFor="steam-profile" className="block py-0.5 text-[13px] text-white/60">
                Your Steam profile address, or just its custom name
              </label>
              <input
                id="steam-profile"
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder="steamcommunity.com/id/yourname"
                aria-invalid={profileError ? true : undefined}
                aria-describedby={profileError ? 'steam-profile-error' : undefined}
                className={`w-full h-11 bg-black border px-3 text-[15px] text-white placeholder:text-white/50 outline-none transition-colors ${
                  profileError ? 'border-[var(--destructive-border)] focus:border-[var(--destructive)]' : 'border-white/20 focus:border-white/70'
                }`}
              />
              {profileError && (
                <p id="steam-profile-error" className="text-[13px] text-[var(--destructive)] m-0">{profileError}</p>
              )}
            </div>
            <button
              type="submit"
              className="tap mt-auto self-start lh-label px-5 py-2.5 border border-white/40 text-white hover:bg-white hover:text-black active:scale-[0.97] transition-[transform,background-color,color] duration-150 ease-out motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Read Library
            </button>
          </form>
        </section>
      </div>

      <p className="text-[13px] text-white/60 mt-5 mb-0 max-w-[70ch]">
        Steam only shares a library whose Game details are public. If yours are private, set them to Public in{' '}
        <ExternalLink href={PRIVACY_URL} className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
          your Steam privacy settings
        </ExternalLink>
        {' '}first.
      </p>
    </div>
  );
}

function Progress({ steps }) {
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

/* Memoised on the row object: setRow replaces only the row that changed, so a
   status picked on one game re-renders one row, not a thousand. */
const Row = memo(function Row({ row, setRow }) {
  const name = row.igdb?.name || row.steamName || `Steam app ${row.appids[0]}`;
  const cover = row.igdb?.cover?.image_id;
  const year = row.igdb?.first_release_date ? new Date(row.igdb.first_release_date * 1000).getUTCFullYear() : null;
  const meta = row.igdb
    ? [year, TYPE_LABEL[row.igdb.game_type]].filter(Boolean).join(' · ')
    : row.selected ? 'Not on IGDB, imported as a custom entry' : 'Not on IGDB. Tick to add it as a custom entry';
  const value = row.status || '';
  const shownStatus = row.status || row.existing?.status || null;

  return (
    /* content-visibility lets the browser skip laying out rows far off screen,
       which is what keeps a thousand-row Steam library scrolling smoothly. */
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
        <p className="text-[13px] text-white/60 mt-0.5 mb-0 truncate">{playLine(row)}</p>
      </div>

      {/* A native select: a thousand of them cost nothing, and every platform
          gives it a keyboard and screen reader behaviour people already know.
          The swatch beside it carries the status colour, as a state row does. */}
      <div className="col-span-3 sm:col-span-1 flex items-center gap-2 pl-[calc(1.5rem+2.25rem+2rem)] sm:pl-0">
        {/* The state cell: once a game has a status the control fills with that
            status's colour and its label turns black (DESIGN.md, the three
            shapes). No amber on arrival: most rows start ticked with no status
            because the page ticked them, which is not a problem to flag; the
            import bar's count says how many are waiting. The options get their
            own black ground so the open list does not inherit the fill. */}
        <div className="relative flex-1 min-w-0">
          <select
            value={value}
            onChange={(e) => setRow(row.key, { status: e.target.value || null, selected: e.target.value ? true : row.selected })}
            aria-label={`Status for ${name}`}
            style={shownStatus ? { backgroundColor: statusColor(shownStatus), borderColor: statusColor(shownStatus) } : undefined}
            className={`tap-block w-full h-9 appearance-none border pl-3 pr-8 lh-label cursor-pointer outline-none transition-colors focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black [&>option]:bg-black [&>option]:text-white ${
              shownStatus ? 'text-black' : 'bg-black border-white/20 text-white/80 hover:border-white/70'
            }`}
          >
            <option value="">{row.existing ? `Keep ${row.existing.status || 'as is'}` : 'Choose Status'}</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${shownStatus ? 'text-black' : 'text-white/60'}`} aria-hidden="true" />
        </div>
      </div>
    </li>
  );
});
