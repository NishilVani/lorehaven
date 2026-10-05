/* Share into LoreHaven: what to do with text another app shared.
 *
 * Apps share a link, a title, or both ("Hades II on Steam https://..."). In
 * order of how sure the answer is:
 *
 *   1. A LoreHaven link opens that page (the App Links allowlist).
 *   2. A Steam store link carries the app id, which IGDB maps to the game
 *      exactly (matchSteamApps); the page slug is kept as the fallback search.
 *   3. Any other link becomes a search for the slug of its last wordy path
 *      segment (most store pages name the game there: /p/hades-ii,
 *      /game/the_witcher_3_wild_hunt). The words shared alongside are only
 *      the fallback: they are as often "look at this" as a title, while the
 *      slug is the store's own name for the game. Text with no link at all is
 *      searched as it is.
 *
 * The search is the typo-tolerant one, so "Hades II - Save 20%" still finds
 * the game. Pure: tests/native.test.mjs runs it directly. */
import { routeFromWebLink } from './links.js';

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/* Store-page noise around a title. */
const NOISE = [
  /\bon steam\b/gi, /\bsave \d+% on\b/gi, /\bbuy\b/gi, /\bpre-?order\b/gi,
  /\|.*$/g, /\s[-:]\s(?:steam|epic games store|gog\.com|playstation store|xbox|nintendo).*$/gi,
  /[™®©]/g,
];

const cleanQuery = (text) => {
  let q = String(text || '');
  for (const re of NOISE) q = q.replace(re, ' ');
  return q.replace(/\s+/g, ' ').trim().slice(0, 80);
};

const slugQuery = (url) => {
  const parts = url.pathname.split('/').filter(Boolean);
  /* The last segment that reads like words, not an id or a locale. */
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const seg = decodeURIComponent(parts[i]);
    if (/^[a-z]{2}(-[a-z]{2})?$/i.test(seg) || /^\d+$/.test(seg) || seg.length < 3) continue;
    if (/^[A-Z0-9]{8,}$/.test(seg)) continue;   // a product id (9PBLMX0KDKQS)
    const words = seg.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/[a-z]/i.test(words)) return cleanQuery(words);
  }
  return '';
};

/**
 * { kind: 'route', route } | { kind: 'steam', appid, query } |
 * { kind: 'search', query } | null
 */
export function parseSharedText(text) {
  const raw = String(text || '').slice(0, 2000).trim();
  if (!raw) return null;
  const link = raw.match(URL_RE)?.[0]?.replace(/[).,;!?]+$/, '');
  const words = cleanQuery(raw.replace(URL_RE, ' '));

  if (link) {
    const route = routeFromWebLink(link);
    if (route) return { kind: 'route', route };
    let url = null;
    try { url = new URL(link); } catch { /* not a link after all */ }
    if (url) {
      const steam = /(^|\.)steampowered\.com$|(^|\.)steamcommunity\.com$/i.test(url.hostname)
        && url.pathname.match(/^\/app\/(\d{1,10})(?:\/([^/?#]+))?/);
      if (steam) return { kind: 'steam', appid: steam[1], query: (steam[2] ? cleanQuery(steam[2].replace(/_/g, ' ')) : '') || words };
      const query = slugQuery(url) || words;
      return query ? { kind: 'search', query } : null;
    }
  }
  return words ? { kind: 'search', query: words } : null;
}

export const searchRoute = (query) => `/?search=true&q=${encodeURIComponent(query)}`;
