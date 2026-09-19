/* Coming back from Microsoft.
 *
 * Unlike Steam, which returns to lorehaven.app and nowhere else, Microsoft
 * returns to whichever of our three addresses started the sign-in -- so on the
 * web this page finishes its own. The desktop and Android apps have no address
 * Entra could hold, so they start at lorehaven.app, and this page hands the
 * code on to lorehaven://auth/xbox and stops there.
 *
 * The state says what the sign-in was for. The nonce inside it is checked
 * against the one this device kept, so an /auth/xbox address somebody sends
 * cannot start anything, and the code is useless without the verifier that
 * never left the device either.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import PageHeader from '../../components/ui/PageHeader';
import { SignInWorking, AppHandoff, SignInProblem, AccountChoice, ImportQuestion } from '../../components/auth/StoreSignIn';
import { toast } from '../../components/ui/toastBus';
import { auth } from '../../services/firebase';
import { getPrefs, setPrefs, getUserName, updateUser } from '../../services/db';
import { XBOX_STORE } from '../../services/xboxImport';
import {
  xboxSignIn, xboxCreateAccount, xboxLinkAccount, xboxLibrary,
  readState, takeNonce, takeXboxVerifier, redirectUriFor, isAllowedNext,
} from '../../services/xboxAuth';

const askedKey = (xuid) => `xbox:${xuid}`;
const wasAsked = (xuid) => !!getPrefs().xboxImportAsked?.[askedKey(xuid)];
const rememberAsked = (xuid) =>
  setPrefs({ xboxImportAsked: { ...(getPrefs().xboxImportAsked || {}), [askedKey(xuid)]: true } });

/* What went wrong, in the words of the thing that can be done about it. The
   Worker has already turned every refusal it knows -- a child account, no Xbox
   profile, a country without Xbox Live -- into a sentence, so those are shown
   as they arrive rather than replaced with something vaguer. */
const failure = (err) => {
  if (err?.status === 503) return { title: 'Xbox Sign-In Is Not Switched On', body: 'This server cannot sign people in with Xbox yet. Sign in with your email instead.' };
  if (err?.status === 409) return { title: 'That Xbox Account Is Taken', body: err.message };
  if (err?.status === 403) return { title: 'Xbox Live Would Not Allow That Account', body: err.message };
  if (err?.status === 400) return { title: 'That Sign-In Cannot Be Used', body: err.message };
  if (err?.status === 502) return { title: 'Xbox Did Not Answer', body: err.message };
  return { title: 'Xbox Sign-In Did Not Finish', body: 'The request did not complete. Check your connection and try again.' };
};

export default function XboxAuth() {
  const navigate = useNavigate();
  const [query] = useState(() => new URLSearchParams(window.location.search));
  const [phase, setPhase] = useState('working');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const [xuid, setXuid] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState(null);
  const ran = useRef(false);

  const state = readState(query.get('state'));
  const from = state?.from || '/';

  /* Either the import question, or straight back to where they started. */
  const finish = useCallback((id) => {
    setXuid(id);
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
      const code = query.get('code');

      /* Microsoft says no by sending them back, not by failing a request. */
      if (query.get('error')) {
        const denied = query.get('error') === 'access_denied';
        setError(denied
          ? { title: 'Xbox Sign-In Was Cancelled', body: 'Nothing was read from your Microsoft account, and nothing changed here.' }
          : { title: 'Microsoft Refused That Sign-In', body: query.get('error_description') || 'Try again, or sign in with your email instead.' });
        setPhase('error');
        return;
      }
      if (!code || !state) {
        setError({ title: 'Nothing to Sign In With', body: 'This page finishes an Xbox sign-in. Start one from the sign-in screen.' });
        setPhase('error');
        return;
      }

      /* Handed on, when an app began the sign-in. The code travels; the
         verifier does not, because it never left the app that kept it. */
      if (state.next) {
        if (!isAllowedNext(state.next)) {
          setError({ title: 'That Return Address Is Not Ours', body: 'The sign-in asked to be sent somewhere LoreHaven does not use, so nothing was done with it.' });
          setPhase('error');
          return;
        }
        const target = new URL(state.next);
        target.searchParams.set('code', code);
        target.searchParams.set('state', query.get('state'));
        setHandoff(target.toString());
        setPhase('handoff');
        window.location.replace(target.toString());
        return;
      }

      const nonce = takeNonce();
      if (!nonce || nonce !== state.nonce) {
        setError({ title: 'That Sign-In Did Not Start Here', body: 'Start it from the sign-in screen on this device, so the app can prove the sign-in is the one it asked for.' });
        setPhase('error');
        return;
      }
      const verifier = takeXboxVerifier();
      if (!verifier) {
        setError({ title: 'That Sign-In Took Too Long', body: 'Start it again from the sign-in screen.' });
        setPhase('error');
        return;
      }
      const redirectUri = redirectUriFor();

      try {
        /* Reading a library is a sign-in spent on one read, not a sign-in: it
           links nothing and needs no LoreHaven account. The review page takes
           the titles in memory, because the code that bought them is gone. */
        if (state.purpose === 'import') {
          const library = await xboxLibrary(code, verifier, redirectUri);
          navigate('/import/xbox', { replace: true, state: { library } });
          return;
        }

        const result = await xboxSignIn(code, verifier, redirectUri);

        /* Linking from Profile: they are already signed in, so the Xbox account
           goes straight onto that account. */
        if (state.purpose === 'link' && auth.currentUser) {
          if (result.status === 'signed-in') {
            setError({ title: 'That Xbox Account Is Taken', body: 'It already signs in to a LoreHaven account. Sign in with Xbox instead, or unlink it there first.' });
            setPhase('error');
            return;
          }
          await xboxLinkAccount(result.ticket);
          toast('Xbox linked to your account');
          finish(result.xuid);
          return;
        }

        if (result.status === 'signed-in') {
          await signInWithCustomToken(auth, result.token);
          finish(result.xuid);
          return;
        }
        setPending(result);
        setPhase('choose');
      } catch (err) {
        setError(failure(err));
        setPhase('error');
      }
    })();
  }, [query, state, finish, navigate]);

  const createAccount = async () => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const made = await xboxCreateAccount(pending.ticket);
      await signInWithCustomToken(auth, made.token);
      /* The gamertag is a starting point, not a decision: Profile edits it. */
      if (!getUserName() && made.gamertag) updateUser({ name: made.gamertag });
      toast('Your LoreHaven account is ready');
      finish(made.xuid);
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
      await xboxLinkAccount(pending.ticket);
      toast('Xbox linked to your account');
      finish(pending.xuid);
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
    rememberAsked(xuid);
    navigate('/import/xbox', { replace: true });
  };

  const skipImport = () => {
    rememberAsked(xuid);
    navigate(from, { replace: true });
  };

  return (
    <div className="min-h-screen antialiased pt-8 pb-16 bg-black text-white">
      <div className="content-container">
        <PageHeader
          className="mb-3 mt-2"
          titleClassName="text-[32px] lg:text-[56px]"
          title="Sign In With Xbox"
        />

        {phase === 'working' && <SignInWorking>Confirming your Xbox sign-in</SignInWorking>}

        {phase === 'handoff' && handoff && (
          <AppHandoff href={handoff}>
            Microsoft has confirmed it is you. The app finishes signing you in; if it did not open by itself, open it from here. You can close this tab afterwards.
          </AppHandoff>
        )}

        {phase === 'error' && error && (
          <SignInProblem title={error.title} body={error.body} onBack={() => navigate(from, { replace: true })} />
        )}

        {phase === 'choose' && pending && (
          <AccountChoice
            service="Xbox"
            store={XBOX_STORE}
            name={pending.gamertag}
            idPrefix="xbox-auth"
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
            title="Bring Your Xbox Games Over?"
            body="The games this Xbox account has played can come into LoreHaven now, matched to the right edition by their Microsoft Store id. You choose a status for every game before anything is saved, and you can do it later from Your Data."
            action="Import From Xbox"
            onImport={openImport}
            onSkip={skipImport}
          />
        )}
      </div>
    </div>
  );
}
