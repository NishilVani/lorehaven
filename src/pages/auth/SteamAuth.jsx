/* Coming back from Steam.
 *
 * Steam returns every sign-in to https://lorehaven.app/auth/steam. When the
 * sign-in began somewhere else -- a dev server today, an app tomorrow -- this
 * page hands the result on and stops there. Otherwise it finishes the job:
 * signs the person in when their Steam account is already linked, and when it
 * is not, asks whether to link it to the account they have or start a new one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2, Mail, Lock } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { toast } from '../../components/ui/toastBus';
import { auth } from '../../services/firebase';
import { getPrefs, setPrefs, getUserName, updateUser } from '../../services/db';
import { openIdParamsFrom } from '../../services/steam';
import { STEAM_STORE } from '../../services/steamImport';
import {
  steamSignIn, steamCreateAccount, steamLinkAccount, isAllowedNext,
} from '../../services/steamAuth';
import { stateFromReturnTo, takeVerifier } from '../../services/appSignIn';

const askedKey = (steamid) => `steam:${steamid}`;
const wasAsked = (steamid) => !!getPrefs().steamImportAsked?.[askedKey(steamid)];
const rememberAsked = (steamid) =>
  setPrefs({ steamImportAsked: { ...(getPrefs().steamImportAsked || {}), [askedKey(steamid)]: true } });

/* What went wrong, in the words of the thing that can be done about it. */
const failure = (err) => {
  if (err?.status === 503) return { title: 'Steam Sign-In Is Not Switched On', body: 'This server cannot sign people in with Steam yet. Sign in with your email instead.' };
  if (err?.status === 409) return { title: 'That Steam Account Is Taken', body: err.message };
  if (err?.status === 401) return { title: 'Steam Did Not Confirm That Sign-In', body: 'It may have expired, or been used already. Start again from the sign-in screen.' };
  if (err?.status === 400) return { title: 'That Sign-In Cannot Be Used', body: err.message };
  return { title: 'Steam Sign-In Did Not Finish', body: 'The request did not complete. Check your connection and try again.' };
};

export default function SteamAuth() {
  const navigate = useNavigate();
  const [openid] = useState(() => openIdParamsFrom(window.location.search));
  const [query] = useState(() => new URLSearchParams(window.location.search));
  const [phase, setPhase] = useState('working');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [steamid, setSteamid] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState(null);
  const ran = useRef(false);

  const from = query.get('from') || '/';
  const intent = query.get('intent');

  /* Either the import question, or straight back to where they started. */
  const finish = useCallback((id) => {
    setSteamid(id);
    if (wasAsked(id)) {
      navigate(from, { replace: true });
      return;
    }
    setPhase('prompt');
  }, [from, navigate]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      await Promise.resolve();
      if (!openid) {
        setError({ title: 'Nothing to Sign In With', body: 'This page finishes a Steam sign-in. Start one from the sign-in screen.' });
        setPhase('error');
        return;
      }

      /* Handed on, when the sign-in began somewhere else. */
      const next = query.get('next');
      if (next) {
        if (!isAllowedNext(next)) {
          setError({ title: 'That Return Address Is Not Ours', body: 'The sign-in asked to be sent somewhere LoreHaven does not use, so nothing was done with it.' });
          setPhase('error');
          return;
        }
        const target = new URL(next);
        for (const [k, v] of Object.entries(openid)) target.searchParams.set(k, v);
        if (intent) target.searchParams.set('intent', intent);
        /* To the app. A browser may refuse to open another program without a
           tap -- Chrome on Android does -- so the page also offers the link as
           a button, and says where the sign-in went. */
        if (target.protocol === 'lorehaven:') {
          setHandoff(target.toString());
          setPhase('handoff');
        }
        window.location.replace(target.toString());
        return;
      }

      if (openid['openid.mode'] !== 'id_res') {
        setError({ title: 'Steam Sign-In Was Cancelled', body: 'Nothing was read from Steam, and nothing changed here.' });
        setPhase('error');
        return;
      }

      try {
        /* An app's sign-in: the verifier it kept when it sent the person to
           Steam, and nobody else's, finishes it. */
        const verifier = stateFromReturnTo(openid['openid.return_to']) ? takeVerifier() : null;
        const result = await steamSignIn(openid, verifier);
        /* Linking from Profile: they are already signed in, so the Steam
           account goes straight onto that account. */
        if (intent === 'link' && auth.currentUser) {
          if (result.status === 'signed-in') {
            setError({ title: 'That Steam Account Is Taken', body: 'It already signs in to a LoreHaven account. Sign in with Steam instead, or unlink it there first.' });
            setPhase('error');
            return;
          }
          await steamLinkAccount(result.ticket);
          toast('Steam linked to your account');
          finish(result.steamid);
          return;
        }

        if (result.status === 'signed-in') {
          await signInWithCustomToken(auth, result.token);
          finish(result.steamid);
          return;
        }
        setPending(result);
        setPhase('choose');
      } catch (err) {
        setError(failure(err));
        setPhase('error');
      }
    })();
  }, [openid, query, intent, finish]);

  const createAccount = async () => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const made = await steamCreateAccount(pending.ticket);
      await signInWithCustomToken(auth, made.token);
      /* The Steam name is a starting point, not a decision: Profile edits it. */
      if (!getUserName() && made.personaName) updateUser({ name: made.personaName });
      toast('Your LoreHaven account is ready');
      finish(made.steamid);
    } catch (err) {
      setFormError(err?.message || 'That did not work. Try again.');
      setBusy(false);
    }
  };

  const linkToExisting = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      await steamLinkAccount(pending.ticket);
      toast('Steam linked to your account');
      finish(pending.steamid);
    } catch (err) {
      const code = err?.code || '';
      setFormError(
        code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')
          ? 'That email and password do not match an account.'
          : err?.message || 'That did not work. Try again.',
      );
      setBusy(false);
    }
  };

  const openImport = () => {
    rememberAsked(steamid);
    navigate('/import/steam', { replace: true });
  };

  const skipImport = () => {
    rememberAsked(steamid);
    navigate(from, { replace: true });
  };

  return (
    <div className="min-h-screen antialiased pt-8 pb-16 bg-black text-white">
      <div className="content-container">
        <PageHeader
          className="mb-3 mt-2"
          titleClassName="text-[32px] lg:text-[56px]"
          title="Sign In With Steam"
        />

        {phase === 'working' && (
          <p className="flex items-center gap-3 text-[13px] text-white/70 mt-8 mb-0" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Confirming your Steam sign-in
          </p>
        )}

        {phase === 'handoff' && handoff && (
          <div className="border border-white/15 px-6 py-8 max-w-2xl mt-8">
            <h2 className="lh-display text-2xl text-white m-0">Back to the LoreHaven App</h2>
            <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">
              Steam has confirmed it is you. The app finishes signing you in; if it did not open by itself, open it from here. You can close this tab afterwards.
            </p>
            <a
              href={handoff}
              className="tap-block inline-flex lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Open LoreHaven
            </a>
          </div>
        )}

        {phase === 'error' && error && (
          <div role="alert" className="border border-white/15 px-6 py-8 max-w-2xl mt-8">
            <h2 className="lh-display text-2xl text-white m-0">{error.title}</h2>
            <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">{error.body}</p>
            <button
              type="button"
              onClick={() => navigate(from, { replace: true })}
              className="tap-block lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Back to LoreHaven
            </button>
          </div>
        )}

        {phase === 'choose' && pending && (
          <>
            <p className="text-[13px] text-white/60 mt-6 mb-8 max-w-[65ch]">
              Steam says you are <span className="text-white">{pending.personaName || 'signed in'}</span>.
              That Steam account is not linked to a LoreHaven account yet, so pick
              one: link it to the account you already have, or start a new one.
            </p>

            <div className="grid gap-6 lg:grid-cols-2 max-w-4xl">
              <section className="border border-white/15 p-6 flex flex-col" aria-labelledby="link-existing">
                <h2 id="link-existing" className="lh-display text-xl text-white m-0">Link It to My Account</h2>
                <p className="text-[13px] text-white/60 mt-2 mb-5">
                  Sign in with the email and password you already use. Steam is added to that account, and your library stays as it is.
                </p>
                <form onSubmit={linkToExisting} className="space-y-4 mt-auto" noValidate>
                  <div className="space-y-1.5">
                    <label htmlFor="steam-auth-email" className="lh-label text-white/60 px-1">Email Address</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" aria-hidden="true" />
                      <input
                        id="steam-auth-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="tap-block w-full pl-10 pr-4 py-2.5 bg-black border border-white/40 text-sm text-white placeholder-white/50 focus:outline-none focus:border-white/70 transition-colors"
                        placeholder="you@example.com"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="steam-auth-password" className="lh-label text-white/60 px-1">Password</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" aria-hidden="true" />
                      <input
                        id="steam-auth-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="tap-block w-full pl-10 pr-4 py-2.5 bg-black border border-white/40 text-sm text-white placeholder-white/50 focus:outline-none focus:border-white/70 transition-colors"
                        placeholder="Your password"
                        required
                      />
                    </div>
                  </div>
                  {formError && (
                    <p role="alert" className="lh-label text-[var(--destructive)] px-1">{formError}</p>
                  )}
                  <button
                    type="submit"
                    aria-disabled={busy}
                    aria-busy={busy}
                    className="tap-block w-full lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white aria-disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    Sign In and Link Steam
                  </button>
                </form>
              </section>

              <section className="border border-white/15 p-6 flex flex-col" aria-labelledby="new-account">
                <div className="flex items-center gap-3">
                  <PlatformLogo platform={STEAM_STORE} className="w-8 h-8 p-1.5" disableTooltip />
                  <h2 id="new-account" className="lh-display text-xl text-white m-0">Start a New Account</h2>
                </div>
                <p className="text-[13px] text-white/60 mt-2 mb-5">
                  A LoreHaven account of your own, signed in with Steam from now on.
                  It starts with your Steam name{pending.personaName ? `, ${pending.personaName}` : ''}, and anything already in this browser comes with you.
                </p>
                <button
                  type="button"
                  onClick={createAccount}
                  aria-disabled={busy}
                  aria-busy={busy}
                  className="tap-block w-full mt-auto lh-label px-4 py-3 border border-white/20 text-white hover:border-white hover:bg-white hover:text-black aria-disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  Create Account With Steam
                </button>
              </section>
            </div>
          </>
        )}

        {phase === 'prompt' && (
          <div className="border border-white/15 px-6 py-12 max-w-2xl mt-8">
            <h2 className="lh-display text-2xl text-white m-0">Bring Your Steam Library Over?</h2>
            <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">
              Your games and wishlist on Steam can come into LoreHaven now, matched
              to the right edition by Steam app id. You choose a status for every
              game before anything is saved, and you can do it later from Your Data.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openImport}
                className="tap-block lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                Import From Steam
              </button>
              <button
                type="button"
                onClick={skipImport}
                className="tap-block lh-label px-4 py-3 border border-white/20 text-white/70 hover:border-white hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                Not Now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
