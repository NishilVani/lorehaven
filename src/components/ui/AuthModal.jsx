import { useRef, useState } from 'react';
import { X, Mail, Lock, Loader2 } from 'lucide-react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { toast } from './Toast';
import Dialog from './Dialog';

export default function AuthModal({ isOpen, onClose }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  /* Inline errors instead of the browser's native bubble. The native one is
     rounded and carries an orange icon inside a system that forbids both
     (`* { border-radius: 0 !important }`), it vanishes on blur, and it sets no
     aria-invalid — the same objections this codebase already makes against
     window.confirm. `noValidate` on the form turns it off. */
  const [errors, setErrors] = useState({});
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validate = () => {
    const next = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'That address is missing an @ or a domain.';

    if (!isForgotPassword) {
      if (!password) next.password = 'Enter your password.';
      else if (isSignUp && password.length < 6) next.password = 'Use at least 6 characters.';
    }
    return next;
  };

  /** Report, then put the cursor on the first thing that needs fixing. */
  const reportErrors = (next) => {
    setErrors(next);
    if (next.email) emailRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
    return Object.keys(next).length > 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (reportErrors(validate())) return;

    setLoading(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
        toast('Account created successfully!');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast('Logged in successfully!');
      }
      onClose();
      // Reset form
      setEmail('');
      setPassword('');
      setIsSignUp(false);
    } catch (error) {
      console.error('Auth error:', error);
      
      // Provide more user-friendly error messages
      let message = error.message;
      /* Against the field where it belongs, form-level otherwise. A toast would
         drift away while the user is still looking at the form that failed. */
      if (error.code === 'auth/email-already-in-use') {
        setErrors({ email: 'That email already has an account. Try signing in instead.' });
        emailRef.current?.focus();
      } else if (error.code === 'auth/weak-password') {
        setErrors({ password: 'Use at least 6 characters.' });
        passwordRef.current?.focus();
      } else if (error.code === 'auth/invalid-credential') {
        setErrors({ form: 'That email and password do not match an account. Check both, or reset your password.' });
      } else {
        setErrors({ form: message });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (reportErrors(validate())) return;

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      toast('Password reset link sent to email!');
      setIsForgotPassword(false);
    } catch (error) {
      console.error('Reset password error:', error);
      let message = error.message;
      if (error.code === 'auth/user-not-found') {
        setErrors({ email: 'No account uses that address. Check the spelling, or sign up.' });
        emailRef.current?.focus();
      } else {
        setErrors({ form: message });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      labelledBy="auth-modal-title"
      z={200}
      backdropClassName="bg-black/80 animate-in fade-in duration-200"
      panelClassName="w-full max-w-md p-6 sm:p-8"
    >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 p-2 text-white/60 hover:bg-white hover:text-black transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-8">
          <span className="lh-brand block text-2xl text-white mb-6">LoreHaven</span>
          <h2 id="auth-modal-title" className="lh-display text-xl text-white mb-1.5">
            {isForgotPassword ? 'Reset Password' : isSignUp ? 'Create an Account' : 'Welcome Back'}
          </h2>
          <p className="text-xs text-white/60 font-medium">
            {isForgotPassword ? 'Enter your email to receive a reset link.' : isSignUp ? 'Sign up to sync your game library.' : 'Sign in to access your game library.'}
          </p>
        </div>

        {/* The double-submit guard lives here rather than on the button: with
            aria-disabled the button still submits the form. */}
        <form
          noValidate
          onSubmit={(e) => { e.preventDefault(); if (loading) return; (isForgotPassword ? handleResetPassword : handleSubmit)(e); }}
          className="space-y-4"
        >
          {errors.form && (
            <div role="alert" className="border border-[var(--destructive-border)] px-3 py-2.5">
              <span className="lh-label text-[var(--destructive)]">{errors.form}</span>
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="auth-email" className="lh-label text-white/60 px-1">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Mail className="w-4 h-4 text-gray-400" />
              </div>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                ref={emailRef}
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors(p => ({ ...p, email: null })); }}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'auth-email-error' : undefined}
                placeholder="you@example.com"
                className={`w-full pl-10 pr-4 py-2.5 bg-black border text-sm text-white placeholder-white/50 focus:outline-none focus:border-white/70 focus:ring-0 transition-colors ${errors.email ? 'border-[var(--destructive)]' : 'border-white/40'}`}
                required
              />
            </div>
            {errors.email && (
              <p id="auth-email-error" className="lh-label text-[var(--destructive)] px-1 pt-1">{errors.email}</p>
            )}
          </div>

          {!isForgotPassword && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-end px-1">
                <label htmlFor="auth-password" className="lh-label text-white/60">
                  Password
                </label>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={() => setIsForgotPassword(true)}
                    className="text-[10px] font-bold text-gray-400 hover:text-white transition-colors focus:outline-none focus-visible:text-white focus-visible:underline focus-visible:ring-1 focus-visible:ring-white px-1 py-2 -my-1"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Lock className="w-4 h-4 text-gray-400" />
              </div>
              <input
                id="auth-password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                ref={passwordRef}
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors(p => ({ ...p, password: null })); }}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'auth-password-error' : undefined}
                placeholder="••••••••"
                className={`w-full pl-10 pr-4 py-2.5 bg-black border text-sm text-white placeholder-white/50 focus:outline-none focus:border-white/70 focus:ring-0 transition-colors ${errors.password ? 'border-[var(--destructive)]' : 'border-white/40'}`}
                required
                minLength={6}
              />
            </div>
            {errors.password && (
              <p id="auth-password-error" className="lh-label text-[var(--destructive)] px-1 pt-1">{errors.password}</p>
            )}
          </div>
          )}

          <button
            type="submit"
            /* Submitting sets `loading`; `disabled` would then blow away focus mid-flow.
               The form's onSubmit swallows the repeat instead. WCAG 2.4.3. */
            aria-disabled={loading}
            aria-busy={loading}
            className="w-full mt-6 py-3 bg-white text-black lh-label hover:bg-neutral-200 aria-disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {/* Keep the label when busy — rendering only the spinner left the button
                with an empty accessible name ("button, dimmed"). */}
            {loading && <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />}
            <span>{isForgotPassword ? 'Send Reset Link' : isSignUp ? 'Create Account' : 'Sign In'}</span>
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-400 font-medium">
            {isForgotPassword ? 'Remember your password?' : isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => {
                if (isForgotPassword) setIsForgotPassword(false);
                else setIsSignUp(!isSignUp);
                setEmail('');
                setPassword('');
              }}
              className="text-white hover:underline focus:outline-none focus-visible:underline focus-visible:ring-1 focus-visible:ring-white font-bold"
            >
              {isForgotPassword ? 'Sign In' : isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
    </Dialog>
  );
}
