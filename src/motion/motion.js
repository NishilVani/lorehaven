/* The motion level, and the bits of motion that need a script: press
 * feedback, card tilt, and the completion burst. The rest is CSS (motion.css).
 *
 * The level is chosen per device (Appearance > Motion) and never synced: a
 * phone and a desktop handle the expressive tier differently, and the system's
 * reduced-motion setting is per device too.
 *
 *   system      reduced when the OS asks for reduced motion, else standard
 *   reduced     fades only
 *   standard    the default
 *   expressive  experimental; see motion.css
 *
 * Everything here costs one listener on document, and the per-frame work is
 * limited to the one element under the finger or pointer. */
import { haptic } from '../services/native/haptics.js';

const KEY = 'lorehaven_motion';
export const MOTION_CHOICES = ['system', 'reduced', 'standard', 'expressive'];
export const MOTION_EVENT = 'lorehaven_motion';

const systemReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function getMotionChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return MOTION_CHOICES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** The level a choice comes to on this device now. */
export function resolveMotion(choice, reduced = systemReduced()) {
  if (choice === 'system' || !MOTION_CHOICES.includes(choice)) return reduced ? 'reduced' : 'standard';
  return choice;
}

/** The level in force, as written on <html>. */
export const motionLevel = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.motion) || 'standard';

function apply() {
  document.documentElement.dataset.motion = resolveMotion(getMotionChoice());
}

export function setMotionChoice(choice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* not kept; applies for this session */ }
  apply();
  window.dispatchEvent(new Event(MOTION_EVENT));
}

/* ── Press feedback ──────────────────────────────────────────────────────────
   A pressed control sinks a little and springs back on release. Scaled by
   size so a full-width row moves about as many pixels as an icon button,
   rather than a 4% shrink that would visibly jump a wide one. Web Animations
   on the `scale` property: it composes with any transform the element has, and
   no class list or Tailwind transition has to know about it. */
const PRESSABLE = 'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="option"], summary';
let pressed = null;

function pressTarget(el) {
  /* The game card's whole-card link is an invisible overlay: press the card. */
  if (el.matches('[role="link"]')) return el.closest('.hover-game-card') || el;
  return el;
}

function onPointerDown(e) {
  if (motionLevel() === 'reduced' || e.button !== 0 || !(e.target instanceof Element)) return;
  const el = e.target.closest(PRESSABLE);
  if (!el || el.closest('[data-no-press]') || el.matches(':disabled, [aria-disabled="true"]')) return;
  const target = pressTarget(el);
  const width = target.getBoundingClientRect().width || 1;
  const s = 1 - Math.min(0.04, 6 / width);
  const down = target.animate([{ scale: '1' }, { scale: String(s) }], {
    duration: 90, easing: 'cubic-bezier(0, 0, 0.2, 1)', fill: 'forwards',
  });
  pressed = { target, down, s };
  if (motionLevel() === 'expressive' && e.pointerType !== 'mouse') tiltTo(target, e);
}

function onPointerUp() {
  if (!pressed) return;
  const { target, down, s } = pressed;
  pressed = null;
  const expressive = motionLevel() === 'expressive';
  target.animate([{ scale: String(s) }, { scale: '1' }], {
    duration: expressive ? 420 : 240,
    easing: expressive ? 'cubic-bezier(0.34, 1.56, 0.64, 1)' : 'cubic-bezier(0, 0, 0.2, 1)',
  });
  down.cancel();
  if (expressive) untilt(target);
}

/* ── Card tilt (expressive) ──────────────────────────────────────────────────
   The card under the pointer leans toward it, with a glare that follows. On a
   touch screen the card leans toward the finger while it is down. At most one
   style write per frame, on one element. */
const MAX_TILT = 7;
let tilted = null;
let frame = 0;
let pendingTilt = null;

function tiltTo(card, e) {
  if (!card.classList.contains('hover-game-card')) return;
  pendingTilt = { card, x: e.clientX, y: e.clientY };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const p = pendingTilt;
    if (!p) return;
    const r = p.card.getBoundingClientRect();
    const nx = Math.min(1, Math.max(0, (p.x - r.left) / r.width));
    const ny = Math.min(1, Math.max(0, (p.y - r.top) / r.height));
    if (tilted && tilted !== p.card) untilt(tilted);
    tilted = p.card;
    p.card.classList.add('lh-tilting');
    p.card.style.setProperty('--lh-tilt-x', `${((0.5 - ny) * 2 * MAX_TILT).toFixed(2)}deg`);
    p.card.style.setProperty('--lh-tilt-y', `${((nx - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
    p.card.style.setProperty('--lh-glare-x', `${(nx * 100).toFixed(1)}%`);
    p.card.style.setProperty('--lh-glare-y', `${(ny * 100).toFixed(1)}%`);
  });
}

function untilt(card) {
  if (!card) return;
  card.classList.remove('lh-tilting');
  for (const v of ['--lh-tilt-x', '--lh-tilt-y', '--lh-glare-x', '--lh-glare-y']) card.style.removeProperty(v);
  if (tilted === card) tilted = null;
}

function onPointerMove(e) {
  if (e.pointerType !== 'mouse' || motionLevel() !== 'expressive' || !(e.target instanceof Element)) return;
  const card = e.target.closest('.hover-game-card');
  if (!card) { if (tilted) untilt(tilted); return; }
  /* Not while a library card is being dragged: the lift owns its transform. */
  if (card.classList.contains('lib-card-dragging')) return;
  tiltTo(card, e);
}

/* ── Completion burst (expressive) ───────────────────────────────────────────
   Marking a game Completed throws a short burst of squares from the control
   that did it, with the success haptic on Android. One canvas, about 60
   particles, 700ms, then removed. Standard motion gets the haptic only. */
export function celebrate(from) {
  haptic('success');
  if (motionLevel() !== 'expressive' || typeof document === 'undefined') return;
  const rect = from?.getBoundingClientRect?.();
  const ox = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const oy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.className = 'lh-burst';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--lh-ink').trim() || 'currentColor';
  const parts = Array.from({ length: 60 }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 7;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, s: 3 + Math.random() * 5, r: Math.random() * Math.PI };
  });
  const start = performance.now();
  const step = (t) => {
    const k = (t - start) / 700;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (k >= 1) { canvas.remove(); return; }
    ctx.fillStyle = ink;
    ctx.globalAlpha = 1 - k;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.r += 0.2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
      ctx.restore();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── Cover flight (expressive) ───────────────────────────────────────────────
   Tap a card and its cover flies to where the game page puts it. FLIP: the
   card's cover rect is kept at the click, and when the page's cover
   ([data-vt-cover], GameDetail) mounts -- whenever its data arrives -- it is
   drawn at the old rect and animated to its own. Same image URL on both ends,
   so it is already decoded. Nothing waits: a page that takes longer than
   FLIGHT_WINDOW_MS to show its cover simply does not fly. */
const FLIGHT_WINDOW_MS = 1500;
let flight = null;
let flightWatch = null;

function land(img) {
  const from = flight;
  flight = null;
  flightWatch?.disconnect();
  flightWatch = null;
  const to = img.getBoundingClientRect();
  if (!to.width || !to.height) return;
  img.animate([
    {
      transformOrigin: 'top left',
      translate: `${from.rect.left - to.left}px ${from.rect.top - to.top}px`,
      scale: `${from.rect.width / to.width} ${from.rect.height / to.height}`,
    },
    { transformOrigin: 'top left', translate: '0 0', scale: '1 1' },
  ], { duration: 520, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
}

function onCardClick(e) {
  if (motionLevel() !== 'expressive' || !(e.target instanceof Element)) return;
  const card = e.target.closest('.hover-game-card');
  const cover = card?.querySelector('[data-card-cover]');
  if (!cover) return;
  flight = { rect: cover.getBoundingClientRect(), at: performance.now() };
  flightWatch?.disconnect();
  flightWatch = new MutationObserver(() => {
    if (!flight || performance.now() - flight.at > FLIGHT_WINDOW_MS) {
      flight = null;
      flightWatch?.disconnect();
      flightWatch = null;
      return;
    }
    /* The page's cover, not one left on the outgoing page. */
    const img = document.querySelector('[data-vt-cover]');
    if (img && !card.isConnected) land(img);
  });
  flightWatch.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => { if (flight && performance.now() - flight.at >= FLIGHT_WINDOW_MS) { flight = null; flightWatch?.disconnect(); flightWatch = null; } }, FLIGHT_WINDOW_MS + 50);
}

/* ── Snap detents (expressive, Android) ──────────────────────────────────────
   A horizontal row that snaps (media strip, shelves) ticks once when it
   settles on a new item, like a dial clicking into place. scrollend does not
   bubble, but a capturing listener on document still sees it for every
   element. Only rows that snap, and only when the position actually changed. */
const settled = new WeakMap();
function onScrollEnd(e) {
  const el = e.target;
  if (motionLevel() !== 'expressive' || !(el instanceof Element)) return;
  if (!/x|inline|both/.test(getComputedStyle(el).scrollSnapType || '')) return;
  const was = settled.get(el) ?? 0;   // rows start at the left
  settled.set(el, el.scrollLeft);
  if (Math.abs(was - el.scrollLeft) > 4) haptic('select');
}

let started = false;

/** Applies the level and installs the listeners. Once, at startup. */
export function initMotion() {
  if (typeof document === 'undefined') return;
  apply();
  if (started) return;
  started = true;
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', apply);
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointerup', onPointerUp, { passive: true });
  document.addEventListener('pointercancel', onPointerUp, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', () => { if (tilted) untilt(tilted); }, { passive: true });
  document.addEventListener('click', onCardClick, true);
  document.addEventListener('scrollend', onScrollEnd, { capture: true, passive: true });
}
