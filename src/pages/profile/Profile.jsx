import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, Pencil } from 'lucide-react';
import { auth } from '../../services/firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import AuthModal from '../../components/ui/AuthModal';
import LibraryNumbers from './LibraryNumbers';
import YourTaste from './YourTaste';
import YourData from './YourData';
import { libraryStats } from '../../services/libraryStats';
import { toast } from '../../components/ui/toastBus';
import { getUserName, setUserName, getSyncState } from '../../services/db';

/* Band A — who you are and whether your library is safe.
 *
 * The name is the page title now rather than a row in an Account table. It was
 * the only editable thing on the page and it sat third in a list of three rows,
 * two of which were read-only restatements of the header — the header said
 * "My Profile" and your email, then the table said your email again. One
 * identity band says it once: who, where it is backed up, and how much of it
 * there is.
 *
 * The three counts belong here rather than in the numbers band because they are
 * the size of the thing this page is about, not a statistic derived from it.
 *
 * The page works signed out on purpose. The library fills up fine without an
 * account, so sign-in is offered here as the thing that makes it survive this
 * device, not as a gate in front of the page.
 */

const nf = new Intl.NumberFormat();

/** Reads as a sentence, not a timestamp — the exact second is never the question. */
const sinceText = (at) => {
  if (!at) return null;
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

function Count({ n, label }) {
  return (
    <div className="min-w-0">
      <div className="lh-display text-[28px] lg:text-[36px] text-white leading-none tabular-nums">{nf.format(n)}</div>
      <div className="lh-label text-white/60 mt-2">{label}</div>
    </div>
  );
}

export default function Profile() {
  const [user, setUser] = useState(() => auth.currentUser);
  const [authOpen, setAuthOpen] = useState(false);
  const [sync, setSync] = useState(getSyncState);

  /* Counted once here and handed down, so the three bands that read the library
     cannot disagree about how big it is mid-update. The library changes from
     anywhere — a shelf move on another page, a cloud snapshot from another
     device — and both routes already announce themselves; this just recounts.
     libraryStats is pure and synchronous, so a recount is cheaper than any cache
     these same two events would have to invalidate. */
  const [stats, setStats] = useState(libraryStats);
  useEffect(() => {
    const recount = () => setStats(libraryStats());
    window.addEventListener('moctale_lib_update', recount);
    window.addEventListener('moctale_sync_update', recount);
    return () => {
      window.removeEventListener('moctale_lib_update', recount);
      window.removeEventListener('moctale_sync_update', recount);
    };
  }, []);

  const [name, setName] = useState(() => getUserName() || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const editBtnRef = useRef(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  /* db.js owns the truth and announces changes; this only mirrors it. Reading
     once on mount would show "never synced" for the whole session, because the
     first pull lands after this component has already rendered. */
  useEffect(() => {
    const read = () => setSync(getSyncState());
    /* Read once at subscribe time: an event that fired between the useState
       initialiser and this effect's commit is otherwise lost for the session. */
    read();
    window.addEventListener('moctale_sync_state', read);
    return () => window.removeEventListener('moctale_sync_state', read);
  }, []);

  /* "3 min ago" is wrong a minute later and nothing else re-renders this. */
  useEffect(() => {
    const t = setInterval(() => setSync(getSyncState()), 30000);
    return () => clearInterval(t);
  }, [sync.at]);

  const startEdit = useCallback(() => {
    setDraft(getUserName() || '');
    setEditing(true);
  }, []);

  /* Focus goes back to the control that opened the field. Closing the editor
     removes the input from the document, and without this the focus ring lands
     on <body> and a keyboard user is dumped to the top of the page. WCAG 2.4.3.
     Measured: it did land on <body>.

     The restore has to happen in an effect, not in the close handler. The button
     and the input are the two arms of the same ternary, so at the moment
     `setEditing(false)` is called the button is still unmounted and `editBtnRef`
     is still null — the `?.` swallowed it and the focus went nowhere. By the
     time this effect runs React has swapped the arms and the ref is live.

     `wasEditing` is what stops it stealing focus on mount, when `editing` is
     already false and nothing was closed. */
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) { wasEditing.current = true; inputRef.current?.select(); return; }
    if (wasEditing.current) { wasEditing.current = false; editBtnRef.current?.focus(); }
  }, [editing]);

  const closeEdit = useCallback(() => setEditing(false), []);

  const saveName = useCallback(() => {
    const next = draft.trim();
    setUserName(next);
    setName(next);
    closeEdit();
    toast(next ? 'Name saved' : 'Name cleared');
  }, [draft, closeEdit]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast('Signed out. Your library stays on this device.');
    } catch {
      toast('Could not sign out. Check your connection and try again.');
    }
  };

  /* Signed out is a state, not a failure — say what is true rather than warning
     about it. An error outranks a success time: a stale "synced 2 min ago" beside
     a failing write is the reassuring half of a contradiction. */
  const syncing = sync.outdated
    ? { line: 'Sync is off — this version is too old to share data safely', tone: 'text-[var(--destructive)]', dot: 'var(--destructive)' }
    : !user
      ? { line: 'Not syncing — your library lives on this device', tone: 'text-white/60', dot: 'var(--status-solid-fallback)' }
      : sync.error
        ? { line: sync.error, tone: 'text-[var(--destructive)]', dot: 'var(--destructive)' }
        : sync.at
          ? { line: `Synced ${sinceText(sync.at)}`, tone: 'text-white/60', dot: 'var(--status-solid-playing)' }
          : { line: 'Connecting…', tone: 'text-white/60', dot: 'var(--status-solid-fallback)' };

  /* The avatar is the first letter of whatever the page is already showing as
     your name, so it can never disagree with the title beside it. */
  const heading = name || (user ? 'Add a name' : 'My Profile');
  const initial = (name || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">

        <header className="flex flex-wrap items-start justify-between gap-6 pb-8 border-b border-white/15">
          <div className="flex items-center gap-5 min-w-0">
            <div
              aria-hidden="true"
              className="w-16 h-16 lg:w-[88px] lg:h-[88px] shrink-0 border border-white/25 flex items-center justify-center lh-display text-[28px] lg:text-4xl text-white"
            >
              {initial}
            </div>

            {/* min-h: the editing row is ~94px against a 48px heading, so opening the
               editor shoved the stat tiles down 41px (52px at 375). */}
            <div className="min-w-0 min-h-[52px] lg:min-h-[60px]">
              {editing ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <label htmlFor="profile-name" className="sr-only">Display name</label>
                  <input
                    id="profile-name"
                    ref={inputRef}
                    type="text"
                    value={draft}
                    maxLength={60}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // preventDefault: the keyup otherwise reaches the h1 that opens the
                      // editor, so Enter saved the name and immediately re-opened it.
                      if (e.key === 'Enter') { e.preventDefault(); saveName(); }
                      if (e.key === 'Escape') { e.preventDefault(); closeEdit(); }
                    }}
                    placeholder="Display name"
                    className="flex-1 min-w-0 max-w-[260px] h-11 px-3 bg-black border border-white/40 focus:border-white text-base text-white outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    aria-label="Save name"
                    className="tap-block pointer-coarse:min-w-11 p-3 border border-white/20 text-white/60 hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={closeEdit}
                    aria-label="Cancel"
                    className="tap-block pointer-coarse:min-w-11 p-3 border border-white/20 text-white/60 hover:text-white hover:border-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* The h1 IS the control. A separate pencil button beside a plain
                   heading gives a screen reader two things to land on for one
                   fact, and gives a pointer user a 12px target next to a 40px
                   word that already looks clickable. */
                <h1 className="lh-display text-4xl lg:text-5xl text-white m-0 break-words">
                  {/* `inline` and not `inline-flex`. A flex button lays its two
                      children out as flex items, so a name long enough to wrap
                      left the pencil stranded at the far right of the band
                      rather than beside the last word — measured on a
                      46-character display name. Inline puts the icon in the text
                      flow, where it follows the final word onto whatever line
                      that word lands on.

                      `overflow-wrap: anywhere`, not the `break-words` the h1
                      carries. A button computes to `inline-block` whatever you
                      ask for, and an inline-block is sized shrink-to-fit against
                      its own min-content width — which `break-word` does not
                      reduce, by definition. So the button sized itself to the
                      longest unbreakable run in the name and pushed the page
                      69px sideways at 375px. `anywhere` is the one value that
                      counts toward min-content, so the button can finally be
                      narrower than the name inside it. */}
                  <button
                    type="button"
                    ref={editBtnRef}
                    onClick={startEdit}
                    className="tap-block inline text-left cursor-pointer [overflow-wrap:anywhere] hover:text-white/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors"
                  >
                    {heading}
                    {' '}
                    <Pencil className="w-4 h-4 inline-block align-baseline text-white/60" aria-hidden="true" />
                    <span className="sr-only">Edit display name</span>
                  </button>
                </h1>
              )}

              <p className="text-sm text-white/60 mt-3 m-0 break-words">
                {user?.email || 'Not signed in'}
              </p>

              <p className={`flex items-center gap-2 text-[13px] mt-2 m-0 ${syncing.tone}`}>
                <span aria-hidden="true" className="w-[7px] h-[7px] shrink-0 block" style={{ background: syncing.dot }} />
                {syncing.line}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-6">
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                className="tap-block lh-label px-4 py-3 border border-white/20 text-white/60 hover:border-white hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="tap-block lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
              >
                Sign In to Sync
              </button>
            )}

            {stats.total > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-3 sm:gap-x-8">
                <Count n={stats.total} label="In Library" />
                <Count n={stats.completed} label="Finished" />
                <Count n={stats.shelves.Playing} label="Playing Now" />
              </div>
            )}
          </div>
        </header>

        <LibraryNumbers stats={stats} />
        {/* Nothing in the taste band has anything to say about an empty library,
            and it said the wrong thing loudly: tasteStats skips the fetch when
            there are no ids, so `reachedIgdb` comes back false and the band
            reported "Could not reach IGDB" on a page that had already explained
            there is nothing shelved yet. Not rendering it also drops a pointless
            round trip. The two dials it carries stay reachable from the
            preferences dialog in the nav. */}
        {stats.total > 0 && <YourTaste />}
        <YourData stats={stats} />
      </div>

      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
