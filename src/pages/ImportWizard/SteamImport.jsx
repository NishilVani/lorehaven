import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import ExternalLink from '../../components/ui/ExternalLink';
import { toast } from '../../components/ui/toastBus';
import { getLibrary, saveManyToLibrary, saveLibrary, addUserCustomPlatform } from '../../services/db';
import { matchSteamApps } from '../../services/igdb';
import {
  verifySteamSignIn, resolveSteamProfile, getSteamOwnedGames, getSteamWishlist,
  openIdParamsFrom,
} from '../../services/steam';
import { parseProfileInput } from '../../services/steamProfile';
import {
  STEAM_STORE, buildSteamRows, rowReady, planSteamImport, importUndo,
  linkRowToIgdb, unlinkRowFromIgdb,
} from '../../services/steamImport';
import { ImportReview, Progress } from './ImportReview';
import { nf, plural } from './importFormat';
import { startSteamSignIn, steamAccounts } from '../../services/steamAuth';
import { isTauri } from '../../services/openExternal';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';

const PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';
const shortDate = (unix) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const playLine = (row) => {
  if (row.source === 'wishlist') return 'On your Steam wishlist';
  const m = row.playtimeMinutes;
  const time = m === 0 ? 'Never played' : m < 60 ? `${m} min played` : `${nf.format(Math.round(m / 60))} h played`;
  return row.lastPlayed ? `${time}, last on ${shortDate(row.lastPlayed)}` : time;
};

/* What a Steam row is, in the review's terms: what to call it, what to search
   for, what its extra line says, and which views the filter offers. */
const STEAM_SOURCE = {
  service: 'Steam',
  filters: [
    { id: 'all', label: 'All', test: () => true },
    { id: 'new', label: 'New', test: r => !r.existing && !!r.igdb },
    { id: 'library', label: 'In Library', test: r => !!r.existing },
    { id: 'wishlist', label: 'Wishlist', test: r => r.source === 'wishlist' },
    { id: 'unmatched', label: 'Not on IGDB', test: r => !r.igdb },
  ],
  nameOf: (row) => row.igdb?.name || row.steamName || `Steam app ${row.appids[0]}`,
  searchSeed: (row) => row.steamName || '',
  lines: (row) => [playLine(row)],
  link: (row, game) => linkRowToIgdb(row, game, getLibrary()),
  unlink: (row) => unlinkRowFromIgdb(row, getLibrary()),
  onLinked: (game) => toast(`Matched to ${game.name}`),
  onDuplicate: (game) => toast(`${game.name} is already on this list`, 'error'),
  onBulkStatus: (n, status) => toast(`Set ${plural(n, 'selected game', 'selected games')} to ${status}`),
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
  const [result, setResult] = useState(null);
  const [steamid, setSteamid] = useState(null);
  const [linked, setLinked] = useState([]);
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

  /* The Steam accounts this LoreHaven account signs in with, for the import
     prompt that follows a Steam sign-in: nothing to type, nothing to confirm.
     One goes straight to the review; several are offered as a choice, because
     guessing which of somebody's Steam accounts they meant would be worse than
     asking. */
  useEffect(() => {
    if (openid || phase !== 'connect') return undefined;
    let live = true;
    (async () => {
      await Promise.resolve();
      const accounts = await steamAccounts().catch(() => []);
      if (!live || accounts.length === 0) return;
      if (accounts.length === 1) {
        setPhase('loading');
        load(accounts[0].steamid);
        return;
      }
      setLinked(accounts);
    })();
    return () => { live = false; };
    /* Only on arrival: Start Over must be able to get back to the form. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    /* Steam returns to lorehaven.app, and the page there sends the result
       back here: this site, or the app through a lorehaven:// link. */
    startSteamSignIn({ target: 'import' });
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

  const selected = rows.filter(r => r.selected);
  const ready = selected.filter(rowReady);
  const needsStatus = selected.length - ready.length;

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
            linked={linked}
            onPickLinked={(id) => { setPhase('loading'); load(id); }}
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
          <ImportReview
            source={STEAM_SOURCE}
            rows={rows}
            setRows={setRows}
            ready={ready.length}
            needsStatus={needsStatus}
            onImport={doImport}
            onStartOver={startOver}
            summary={(
              <p className="text-[13px] text-white/70 m-0 mb-5 tabular-nums">
                {[
                  plural(meta.owned, 'owned game', 'owned games'),
                  meta.wishlistAvailable ? plural(meta.wishlist, 'wishlisted', 'wishlisted') : 'no wishlist from Steam',
                  `${nf.format(rows.filter(r => r.existing).length)} already in your library`,
                  `${nf.format(rows.filter(r => !r.igdb).length)} not on IGDB`,
                ].join(', ')}.
                {meta.droppedWishlist > 0 && ` ${plural(meta.droppedWishlist, 'wishlisted item is', 'wishlisted items are')} not on IGDB and left out.`}
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

function Connect({ inApp, profile, setProfile, profileError, onSubmit, onSignIn, linked = [], onPickLinked }) {
  return (
    <div className="max-w-4xl">
      {/* Already linked, and more than one: reading either is a single tap, and
          the two ways in below still stand for any other account. */}
      {linked.length > 1 && (
        <section aria-labelledby="linked-steam-title" className="border border-white/15 p-6 mb-6">
          <h2 id="linked-steam-title" className="lh-display text-xl text-white m-0">Your Steam Accounts</h2>
          <p className="text-[13px] text-white/60 mt-2 mb-5">
            These sign in to your LoreHaven account. Read the library of whichever one you mean.
          </p>
          <ul className="list-none p-0 m-0 flex flex-wrap gap-3">
            {linked.map(account => (
              <li key={account.steamid}>
                <button
                  type="button"
                  onClick={() => onPickLinked(account.steamid)}
                  className="tap-block lh-label inline-flex items-center gap-2 px-4 py-3 border border-white/20 text-white hover:border-white hover:bg-white hover:text-black transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  {account.name || `Account ending ${String(account.steamid).slice(-4)}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
          <button
            onClick={onSignIn}
            className="mt-auto self-start tap lh-label px-5 py-2.5 border border-white bg-white text-black hover:bg-neutral-200 active:scale-[0.97] transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Sign In With Steam
          </button>
          {inApp && (
            <p className="text-[13px] text-white/60 m-0">
              Steam opens in your browser, then brings you back here.
            </p>
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
