import { useState, useEffect } from 'react';
import { getSyncState } from '../../services/db';

/**
 * ApiErrorBanner — tells the user when data failed to load.
 *
 * Without this a failed IGDB call degrades to an empty array and renders exactly
 * like a genuine "no results" state: the only signal is a console.error. For anyone
 * using assistive tech there is nothing to notice at all. WCAG 3.3.1 (Error
 * Identification) and Nielsen 1/9.
 *
 * Mounted once at the app root and driven by the `moctale_api_error` event that
 * `services/igdb.js` dispatches, so every screen is covered by one integration point
 * rather than per-page error plumbing.
 *
 * Retry reuses the existing `moctale_sync_update` event, which App remounts routes
 * on — so it genuinely re-runs the current page's fetches rather than reloading.
 */

/* what happened -> why -> how to fix (content/voice-tone.md) */
const COPY = {
  auth: {
    what: 'Could not load game data',
    why: 'IGDB rejected the request. Your API credentials may have expired.',
  },
  request: {
    what: 'Could not load game data',
    why: 'IGDB did not respond as expected.',
  },
  /* Not an API failure, but it belongs in the same place: it is the one thing
     a person must read before they trust what the app is showing them. */
  outdated: {
    what: 'Sync is off',
    why: 'This version of LoreHaven cannot safely share data with your other devices. Your library is safe on this device and will sync once you update.',
  },
};

export default function ApiErrorBanner() {
  const [error, setError] = useState(null);
  const [outdated, setOutdated] = useState(() => getSyncState().outdated);

  /* db.js owns the truth and announces changes; this only mirrors it. Read once
     at subscribe time, because config/app may resolve before this mounts. */
  useEffect(() => {
    const read = () => setOutdated(getSyncState().outdated);
    read();
    window.addEventListener('moctale_sync_state', read);
    return () => window.removeEventListener('moctale_sync_state', read);
  }, []);

  /* The gated state is not an error that can be cleared, so Dismiss needs
     something of its own to set. Per session, deliberately: the Profile page
     still says why, permanently, for anyone who goes looking.
     Scoped to outdated ONLY -- a single shared flag here previously meant
     dismissing one transient IGDB failure permanently suppressed every later
     api-error banner (and the outdated notice) for the rest of the session,
     including config/app resolving after the dismiss. The error case instead
     goes back to clearing via setError(null), so a later moctale_api_error
     re-shows it exactly like before this flag existed. */
  const [dismissedOutdated, setDismissedOutdated] = useState(false);

  useEffect(() => {
    // Collapse a burst of failed calls into one banner — a single auth failure
    // typically fails every request on the page.
    const onError = (e) => setError(prev => prev || (e.detail?.kind || 'request'));
    const onRecover = () => setError(null);

    window.addEventListener('moctale_api_error', onError);
    window.addEventListener('moctale_sync_update', onRecover);
    return () => {
      window.removeEventListener('moctale_api_error', onError);
      window.removeEventListener('moctale_sync_update', onRecover);
    };
  }, []);

  /* The dismissedOutdated latch exists to stop a STANDING condition from nagging
     once the user has read it. It must never be allowed to also swallow a FRESH
     error the user has not seen -- that is exactly the failure this banner exists
     to prevent. So `error` sits outside the latch entirely: it is checked first
     and unconditionally, and only the pure-outdated case is gated on dismissal. */
  if (!error && (!outdated || dismissedOutdated)) return null;
  /* Outranks a transient API error for the COPY shown: one is a request that
     failed and can be retried, the other is a state the app is in until it
     is updated -- a user who cannot sync at all needs to read that before
     anything else. But it must not outrank the error for what the user can
     DO: if a real IGDB failure landed while the gate is armed, hiding Retry
     would leave no way to recover that failed load just because the outdated
     copy took the headline. So Retry's visibility below is keyed on `error`,
     not `outdated` -- the two states are independent conditions that happen
     to share one banner and one Dismiss button. */
  const copy = outdated ? COPY.outdated : (COPY[error] || COPY.request);

  const retry = () => {
    setError(null);
    // Remounts routes, re-running their data fetches. The stale token was already
    // cleared by asRows(), so this attempt re-authenticates.
    window.dispatchEvent(new Event('moctale_sync_update'));
  };

  return (
    /* Sticky, not static. In normal flow this sat at the top of the document, so a
       user who had scrolled never saw the only thing telling them their data failed
       to load — measured off-viewport at y=-922 after a 950px scroll. role=alert
       announces a transient failure assertively; role=status is used for the
       standing outdated notice so it does not interrupt a screen reader for a
       condition that isn't going away. Either way this is for everyone else.
       Offset below the fixed mobile chrome rather than top-0, or it parks underneath
       the nav bar (WCAG 2.4.11), same as the Library status strip. */
    <div
      role={outdated ? 'status' : 'alert'}
      className="sticky z-[120] border-b border-white/25 bg-black px-4 lg:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 transition-[top] duration-300 ease-in-out motion-reduce:transition-none"
      /* --mobile-nav-offset, not --mobile-nav-h: the header translates away on
         scroll-down while the reserved height stays put, so pinning to the
         reserved height left this banner floating below a gap of moving page. */
      style={{ top: 'calc(var(--mobile-nav-offset, 0px) + var(--titlebar-h, 0px))' }}
    >
      <span className="lh-label text-[var(--destructive)] shrink-0">{copy.what}</span>
      <span className="text-[11px] text-white/60 flex-1 min-w-[12rem]">{copy.why}</span>

      <div className="flex items-center gap-2 shrink-0">
        {error && (
          <button
            onClick={retry}
            className="lh-label px-3 py-2 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus-visible:bg-white focus-visible:text-black focus-visible:outline-none transition-colors cursor-pointer"
          >
            Retry
          </button>
        )}
        <button
          onClick={() => { setError(null); if (outdated) setDismissedOutdated(true); }}
          aria-label={outdated ? 'Dismiss update notice' : 'Dismiss error'}
          className="lh-label px-3 py-2 text-white/60 hover:text-white focus-visible:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
