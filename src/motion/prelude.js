/* Preludes: what a card already knows, handed to the page it opens, so that
 * page can render its final layout on the very first frame: the poster in its
 * place, the title set. Shared art then always has somewhere to land, and the
 * page never opens on a blank or on the word "Loading".
 * (docs/superpowers/specs/2026-10-06-motion-design.md, 1.3)
 *
 * Only data the card shows travels. Pure, so tests/motion.test.mjs runs it. */

const IGDB_IMAGE_ID = /^[a-z0-9]{1,40}$/;
const imageId = (v) => (typeof v === 'string' && IGDB_IMAGE_ID.test(v) ? v : null);

/** A prelude from a library entry or card game shape, or null. */
export function preludeFromCard(g) {
  const id = Number(g?.id);
  if (!Number.isInteger(id) || id <= 0 || !g?.name) return null;
  const year = Number(g.release_year)
    || (Number(g.first_release_date) > 0 ? new Date(Number(g.first_release_date) * 1000).getUTCFullYear() : null);
  return {
    id,
    name: String(g.name).slice(0, 200),
    cover: imageId(g.cover_id || g.cover?.image_id || null),
    year: year || null,
    hero: imageId(g.artwork_id || g.hero || null),
  };
}

/** The prelude in a location's state, when it is for this id. */
export function readPrelude(location, id) {
  const p = location?.state?.prelude;
  return p && String(p.id) === String(id) ? p : null;
}

/** Navigation options carrying a prelude, for navigate(to, options) or <Link state>. */
export const withPrelude = (g, options = {}) => {
  const prelude = preludeFromCard(g);
  return prelude ? { ...options, state: { ...(options.state || {}), prelude } } : options;
};

/* ── Titles ──────────────────────────────────────────────────────────────────
   Franchise, collection, event and award pages open on their name: the link
   that led there carries it in its state, and the name in the link travels to
   the page's title. The shared key comes from the destination's own path, so
   the link and the page agree without passing ids around. */

const TITLED = /^\/(franchise|collection|event|awards)\/(.+?)\/?$/;

/** The shared key for a titled page's heading, or null. */
export function titleKeyFor(pathname) {
  const m = TITLED.exec(String(pathname || '').split(/[?#]/)[0]);
  if (!m) return null;
  const id = m[2].replace(/[^A-Za-z0-9_-]/g, '-');
  const key = m[1] === 'franchise' ? `franchise-title:${id}` : `title:${m[1]}-${id}`;
  return key.length <= 60 ? key : null;
}

/** Link state carrying a page's title. */
export const titleState = (name) => (typeof name === 'string' && name.trim() ? { title: name.trim().slice(0, 200) } : undefined);

/** The title the link handed over, while the page loads its own. */
export const readTitle = (location) => {
  const t = location?.state?.title;
  return typeof t === 'string' && t ? t : null;
};
