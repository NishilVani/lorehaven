/* How a navigation should move. Pure, so tests/motion.test.mjs runs it.
 *
 * Types (docs/superpowers/specs/2026-10-06-motion-design.md, 1.1):
 *   carry       a shared piece of art travels to the new page
 *   carry-back  the same, going back: the art flies home
 *   sideways    between siblings (library shelves, browse taxonomies)
 *   deeper      any other forward navigation
 *   back        any other back navigation
 */

export const SHARED_KINDS = ['poster', 'hero', 'franchise-title', 'mosaic', 'event-art', 'ceremony-title', 'wallpaper', 'media'];

/** 'poster:1942' -> { kind: 'poster', id: '1942' }, or null. */
export function parseShared(value) {
  const m = /^([a-z-]+):([A-Za-z0-9_-]{1,40})$/.exec(String(value ?? ''));
  if (!m || !SHARED_KINDS.includes(m[1])) return null;
  return { kind: m[1], id: m[2] };
}

export const sharedKey = ({ kind, id }) => `${kind}:${id}`;

/* Sibling routes, in the order their tabs appear. Moving to a later sibling
   slides content toward the right-hand tab. */
const SIBLINGS = [
  { prefix: '/library/', items: ['playing', 'backlog', 'wishlist', 'beaten', 'dropped', 'unreleased'] },
  { prefix: '/browse/', items: ['genres', 'themes', 'modes'] },
];

const siblingOf = (pathname) => {
  for (const group of SIBLINGS) {
    if (!pathname.startsWith(group.prefix)) continue;
    const name = pathname.slice(group.prefix.length).replace(/\/$/, '').toLowerCase();
    const index = group.items.indexOf(name);
    if (index >= 0) return { group, index };
  }
  return null;
};

/** 'left' | 'right' when both paths are siblings in one group, else null. */
export function siblingDirection(from, to) {
  const a = siblingOf(from);
  const b = siblingOf(to);
  if (!a || !b || a.group !== b.group || a.index === b.index) return null;
  return b.index > a.index ? 'right' : 'left';
}

/** The transition type for a navigation, or null when the page does not change. */
export function classifyTransition({ from, to, navigationType, pair }) {
  if (from === to) return null;
  if (siblingDirection(from, to)) return 'sideways';
  const back = navigationType === 'POP';
  if (pair) return back ? 'carry-back' : 'carry';
  return back ? 'back' : 'deeper';
}

/* The first motion pass offered standard and expressive; both now mean
   "follow the system". */
export function migrateMotionChoice(value) {
  return value === 'reduced' ? 'reduced' : 'system';
}
