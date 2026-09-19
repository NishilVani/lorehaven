/* The screens a store sign-in passes through, once for every store.
 *
 * Steam and Xbox differ in how they prove who somebody is and in nothing after
 * that: both end at the same three questions -- is this account already ours,
 * whose account should it join, and shall we bring the library over. These were
 * written for Steam first and lifted here when Xbox arrived, so the second
 * store inherits the wording, the keyboard order and the error handling instead
 * of growing its own near-copies.
 *
 * Every screen takes what it shows. None of them fetch, navigate or know which
 * store they are drawing, which is what keeps the two pages honest about the
 * parts that really do differ.
 */
import { Loader2, Mail, Lock } from 'lucide-react';
import { PlatformLogo } from '../platforms/PlatformLogo';

const PRIMARY = 'tap-block lh-label px-4 py-3 bg-white text-black border border-white hover:bg-black hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white';
const SECONDARY = 'tap-block lh-label px-4 py-3 border border-white/20 text-white/70 hover:border-white hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white';
const PANEL = 'border border-white/15 px-6 py-8 max-w-2xl mt-8';
const FIELD = 'tap-block w-full pl-10 pr-4 py-2.5 bg-black border border-white/40 text-sm text-white placeholder-white/50 focus:outline-none focus:border-white/70 transition-colors';

/** While the store is being asked whether the sign-in is real. */
export const SignInWorking = ({ children }) => (
  <p className="flex items-center gap-3 text-[13px] text-white/70 mt-8 mb-0" aria-live="polite">
    <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    {children}
  </p>
);

/**
 * A sign-in that belongs to the desktop or Android app. The browser may refuse
 * to open another program without a tap -- Chrome on Android does -- so the page
 * says where the sign-in went and offers the link as a button.
 */
export const AppHandoff = ({ href, children }) => (
  <div className={PANEL}>
    <h2 className="lh-display text-2xl text-white m-0">Back to the LoreHaven App</h2>
    <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">{children}</p>
    <a href={href} className={`${PRIMARY} inline-flex`}>Open LoreHaven</a>
  </div>
);

/** What went wrong, and the one thing there is to do about it. */
export const SignInProblem = ({ title, body, onBack }) => (
  <div role="alert" className={PANEL}>
    <h2 className="lh-display text-2xl text-white m-0">{title}</h2>
    <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">{body}</p>
    <button type="button" onClick={onBack} className={PRIMARY}>Back to LoreHaven</button>
  </div>
);

/**
 * The fork every first sign-in reaches: this store account is real, and reaches
 * no LoreHaven account. Link it to the one they have, or start a new one.
 *
 * `store` is the platform row the logo is drawn from, `service` its name in a
 * sentence, and `idPrefix` keeps the two form fields' ids apart from any other
 * pair on the page.
 */
export function AccountChoice({
  service, store, name, idPrefix,
  email, password, onEmailChange, onPasswordChange,
  onLink, onCreate, busy, formError,
}) {
  return (
    <>
      <p className="text-[13px] text-white/60 mt-6 mb-8 max-w-[65ch]">
        {service} says you are <span className="text-white">{name || 'signed in'}</span>.
        That {service} account is not linked to a LoreHaven account yet, so pick
        one: link it to the account you already have, or start a new one.
      </p>

      <div className="grid gap-6 lg:grid-cols-2 max-w-4xl">
        <section className="border border-white/15 p-6 flex flex-col" aria-labelledby={`${idPrefix}-link-existing`}>
          <h2 id={`${idPrefix}-link-existing`} className="lh-display text-xl text-white m-0">Link It to My Account</h2>
          <p className="text-[13px] text-white/60 mt-2 mb-5">
            Sign in with the email and password you already use. {service} is added to that account, and your library stays as it is.
          </p>
          <form onSubmit={onLink} className="space-y-4 mt-auto" noValidate>
            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-email`} className="lh-label text-white/60 px-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" aria-hidden="true" />
                <input
                  id={`${idPrefix}-email`}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  className={FIELD}
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${idPrefix}-password`} className="lh-label text-white/60 px-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50" aria-hidden="true" />
                <input
                  id={`${idPrefix}-password`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  className={FIELD}
                  placeholder="Your password"
                  required
                />
              </div>
            </div>
            {formError && <p role="alert" className="lh-label text-[var(--destructive)] px-1">{formError}</p>}
            <button
              type="submit"
              aria-disabled={busy}
              aria-busy={busy}
              className={`${PRIMARY} w-full aria-disabled:opacity-50 flex items-center justify-center gap-2`}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Sign In and Link {service}
            </button>
          </form>
        </section>

        <section className="border border-white/15 p-6 flex flex-col" aria-labelledby={`${idPrefix}-new-account`}>
          <div className="flex items-center gap-3">
            <PlatformLogo platform={store} className="w-8 h-8 p-1.5" disableTooltip />
            <h2 id={`${idPrefix}-new-account`} className="lh-display text-xl text-white m-0">Start a New Account</h2>
          </div>
          <p className="text-[13px] text-white/60 mt-2 mb-5">
            A LoreHaven account of your own, signed in with {service} from now on.
            It starts with your {service} name{name ? `, ${name}` : ''}, and anything already in this browser comes with you.
          </p>
          <button
            type="button"
            onClick={onCreate}
            aria-disabled={busy}
            aria-busy={busy}
            className="tap-block w-full mt-auto lh-label px-4 py-3 border border-white/20 text-white hover:border-white hover:bg-white hover:text-black aria-disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Create Account With {service}
          </button>
        </section>
      </div>
    </>
  );
}

/** Asked once per store account: shall the games there come over now. */
export const ImportQuestion = ({ title, body, action, onImport, onSkip }) => (
  <div className="border border-white/15 px-6 py-12 max-w-2xl mt-8">
    <h2 className="lh-display text-2xl text-white m-0">{title}</h2>
    <p className="text-[13px] text-white/70 mt-3 mb-6 max-w-[60ch]">{body}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={onImport} className={PRIMARY}>{action}</button>
      <button type="button" onClick={onSkip} className={SECONDARY}>Not Now</button>
    </div>
  </div>
);
