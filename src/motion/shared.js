/* Shared elements: the art that travels between pages.
 *
 * An element opts in with data-shared="<kind>:<id>" (motion/classify.js lists
 * the kinds). A click inside an element, or inside a container marked
 * data-shared-scope that holds one, records that element as the pair's
 * source. The director names exactly two elements "shared" for one
 * transition: the source in the old page and the matching element in the new
 * page. Nothing else ever carries the name, so a duplicate can never abort a
 * transition.
 *
 * Back: when a page is left through a pair, the pair is remembered against
 * that page's history entry, and returning to it flies the art home, if the
 * matching element is on screen there. */
import { parseShared, sharedKey } from './classify.js';

const PENDING_MS = 1000;
let pending = null;
const homeward = new Map();

const inViewport = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
    && r.top < window.innerHeight && r.left < window.innerWidth;
};

/** The on-screen element carrying this key, or null. */
export function findShared(key) {
  if (!key) return null;
  for (const el of document.querySelectorAll('[data-shared]')) {
    if (el.getAttribute('data-shared') === key && inViewport(el)) return el;
  }
  return null;
}

function onClick(e) {
  if (!(e.target instanceof Element)) return;
  const scope = e.target.closest('[data-shared], [data-shared-scope]');
  if (!scope) return;
  const el = scope.matches('[data-shared]') ? scope : scope.querySelector('[data-shared]');
  const parsed = el && parseShared(el.getAttribute('data-shared'));
  /* The element itself, not just its key: one game can sit in several rows,
     and the art must leave from the copy that was pressed. */
  pending = parsed ? { key: sharedKey(parsed), el, at: performance.now() } : null;
}

/** The pair a press just started, if it is fresh: { key, el }. Consumed. */
export function takePending() {
  const p = pending;
  pending = null;
  return p && performance.now() - p.at < PENDING_MS ? p : null;
}

/** Remember that leaving `historyKey` went through `pairKey`. */
export const rememberHomeward = (historyKey, pairKey) => { if (historyKey) homeward.set(historyKey, pairKey); };
/** The pair to fly home through when returning to `historyKey`. */
export const homewardFor = (historyKey) => homeward.get(historyKey) || null;

let installed = false;
export function installSharedCapture() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  /* pointerdown as well as click: search suggestions navigate on mousedown,
     before any click. */
  document.addEventListener('pointerdown', onClick, true);
  document.addEventListener('click', onClick, true);
}

/* Named elements for the running transition, so they can be unnamed. */
let named = [];
export function nameShared(el) {
  if (!el) return;
  /* Words and art move differently (motion.css): a title scales and
     cross-fades into its heading, art keeps its crop and hands over. */
  const kind = el.getAttribute('data-shared')?.split(':')[0];
  el.style.viewTransitionName = kind === 'title' || kind === 'franchise-title' ? 'shared-title' : 'shared';
  named.push(el);
}
export function clearShared() {
  for (const el of named) el.style.viewTransitionName = '';
  named = [];
}

/* The running page transition, so a page that gets its data mid-flight can
   hold the swap until the art has landed: replacing the element the art is
   flying to would make it vanish in the air. */
let running = null;
export function setRunningTransition(finished) {
  const p = finished.catch(() => {}).finally(() => { if (running === p) running = null; });
  running = p;
}
/** Resolves when no page transition is running. */
export const transitionSettled = () => running || Promise.resolve();
