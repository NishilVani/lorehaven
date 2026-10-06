/* The element motion that needs a script (spec section 4): press feedback and
 * images fading in when they arrive. One listener each, on document. */
import { reducedMotion } from './motion';

/* ── Press ───────────────────────────────────────────────────────────────────
   A pressed control sinks and eases back when let go. Sized to the control,
   so a full-width row moves about as many pixels as an icon button rather
   than a 3% shrink visibly jumping a wide one. Web Animations on `scale`,
   which composes with any transform the element has, and no Tailwind
   transition needs to know about it. */
const PRESSABLE = 'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="option"], [role="radio"], summary';
let pressed = null;

function onPointerDown(e) {
  if (reducedMotion() || e.button !== 0 || !(e.target instanceof Element)) return;
  let el = e.target.closest(PRESSABLE);
  if (!el || el.closest('[data-no-press]') || el.matches(':disabled, [aria-disabled="true"]')) return;
  /* A game card's whole-card link is an invisible overlay: press the card. */
  if (el.matches('[role="link"]')) el = el.closest('.hover-game-card') || el;
  const width = el.getBoundingClientRect().width || 1;
  const s = 1 - Math.min(0.03, 6 / width);
  const down = el.animate([{ scale: '1' }, { scale: String(s) }], {
    duration: 120, easing: 'cubic-bezier(0, 0, 0.2, 1)', fill: 'forwards',
  });
  pressed = { el, down, s };
}

function onPointerUp() {
  if (!pressed) return;
  const { el, down, s } = pressed;
  pressed = null;
  el.animate([{ scale: String(s) }, { scale: '1' }], { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  down.cancel();
}

/* ── Images ──────────────────────────────────────────────────────────────────
   An image still downloading when it is added fades in once it has decoded,
   so art never pops in half-drawn. One already in the cache shows at once. */
function watchImage(img) {
  if (img.complete || img.dataset.noFade !== undefined || reducedMotion()) return;
  img.style.opacity = '0';
  const reveal = () => {
    img.style.opacity = '';
    if (img.isConnected) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0, 0, 0.2, 1)' });
  };
  img.addEventListener('load', reveal, { once: true });
  img.addEventListener('error', () => { img.style.opacity = ''; }, { once: true });
}

let installed = false;
export function installElementMotion() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointerup', onPointerUp, { passive: true });
  document.addEventListener('pointercancel', onPointerUp, { passive: true });
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') watchImage(node);
        else if (node.firstElementChild) node.querySelectorAll('img').forEach(watchImage);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
