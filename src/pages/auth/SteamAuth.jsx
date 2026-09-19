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
import PageHeader from '../../components/ui/PageHeader';
import { SignInWorking, AppHandoff, SignInProblem, AccountChoice, ImportQuestion } from '../../components/auth/StoreSignIn';
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

        {phase === 'working' && <SignInWorking>Confirming your Steam sign-in</SignInWorking>}

        {phase === 'handoff' && handoff && (
          <AppHandoff href={handoff}>
            Steam has confirmed it is you. The app finishes signing you in; if it did not open by itself, open it from here. You can close this tab afterwards.
          </AppHandoff>
        )}

        {phase === 'error' && error && (
          <SignInProblem title={error.title} body={error.body} onBack={() => navigate(from, { replace: true })} />
        )}

        {phase === 'choose' && pending && (
          <AccountChoice
            service="Steam"
            store={STEAM_STORE}
            name={pending.personaName}
            idPrefix="steam-auth"
            email={email}
            password={password}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            onLink={linkToExisting}
            onCreate={createAccount}
            busy={busy}
            formError={formError}
          />
        )}

        {phase === 'prompt' && (
          <ImportQuestion
            title="Bring Your Steam Library Over?"
            body="Your games and wishlist on Steam can come into LoreHaven now, matched to the right edition by Steam app id. You choose a status for every game before anything is saved, and you can do it later from Your Data."
            action="Import From Steam"
            onImport={openImport}
            onSkip={skipImport}
          />
        )}

      </div>
    </div>
  );
}
