/* Android's back gesture, done the way Android 13+ expects (predictive back).
 *
 * Back means, in order: close whatever is open on top (menu, dialog, drawer,
 * search), else go back a page, else leave the app. Closing goes through
 * Escape, because every overlay here already closes on Escape and knows its
 * own layering; back on a phone is Escape on a keyboard.
 *
 * Android shows its back-to-home preview only when the app is not claiming
 * the gesture, so the native callback (LoreHavenPlugin.kt) is switched on only
 * while there is something to go back from. This module keeps that switch in
 * step: a MutationObserver for overlays appearing and leaving, popstate and
 * route changes for history. While the gesture is held, the progress arrives
 * as `lh:back` events and is written to <html> as --lh-back (0..1) and
 * data-back, so CSS can let the top layer follow the finger (index.css).
 *
 * The Escape is checked: if nothing closed (an element that only looks like an
 * overlay), back falls through to history, so the gesture can never go dead. */
import { nativeCall } from './bridge.js';
import { haptic } from './haptics.js';

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"], [data-overlay-open]';

/** Overlays on screen now, outermost first. */
export function openOverlays(root = document) {
  return [...root.querySelectorAll(OVERLAY)].filter(el => !el.closest('[inert]') && el.getClientRects().length > 0);
}

const historyIndex = () => Number(window.history.state?.idx) || 0;

export function startBackController() {
  let claimed = null;
  let frame = 0;
  let target = null;
  const root = document.documentElement;

  const sync = () => {
    frame = 0;
    const want = openOverlays().length > 0 || historyIndex() > 0;
    if (want === claimed) return;
    claimed = want;
    nativeCall('setBackIntercept', { enabled: want }).catch(() => { claimed = null; });
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };

  const clearPeek = () => {
    root.style.removeProperty('--lh-back');
    root.style.removeProperty('--lh-back-dir');
    delete root.dataset.back;
    if (target) delete target.dataset.backTarget;
    target = null;
  };

  const leave = () => {
    if (historyIndex() > 0) window.history.back();
    else nativeCall('moveToBack').catch(() => {});
  };

  const onBack = (e) => {
    const { phase, progress = 0, edge = 0 } = e.detail || {};
    if (phase === 'start' || phase === 'progress') {
      if (phase === 'start') {
        const layers = openOverlays();
        target = layers[layers.length - 1] || null;
        if (target) target.dataset.backTarget = 'true';
        root.dataset.back = target ? 'overlay' : 'page';
        /* From the left edge the layer moves right, and the other way round. */
        root.style.setProperty('--lh-back-dir', edge === 1 ? '-1' : '1');
      }
      root.style.setProperty('--lh-back', String(Math.min(1, Math.max(0, Number(progress) || 0))));
      return;
    }
    clearPeek();
    if (phase !== 'commit') return;

    const before = openOverlays().length;
    if (before > 0) {
      const el = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      haptic('select');
      /* React closes on the next render; give it two frames before deciding
         the Escape did nothing. */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (openOverlays().length >= before) leave();
        schedule();
      }));
      return;
    }
    leave();
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['role', 'aria-modal', 'data-overlay-open', 'inert', 'hidden'],
  });
  window.addEventListener('popstate', schedule);
  window.addEventListener('lh:back', onBack);
  schedule();

  return {
    refresh: schedule,
    stop() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', schedule);
      window.removeEventListener('lh:back', onBack);
      clearPeek();
    },
  };
}
