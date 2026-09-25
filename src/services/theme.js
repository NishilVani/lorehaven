/* Puts the chosen theme on the page.
 *
 * The choice itself lives in prefs (`moctale_prefs.theme`), which is what makes
 * it follow the user between devices: prefs is already a synced domain in
 * db.js. This file only turns that id into CSS.
 *
 * A theme is applied as inline custom properties on <html>, not as a
 * stylesheet swap, so switching is one style recalculation with nothing to
 * download except the theme's own web font. The resolved declarations are also
 * cached in localStorage under THEME_CACHE_KEY; the inline script in index.html
 * reads that cache before the first paint, so a light theme does not open on a
 * frame of black while the bundle loads.
 */
import { getPrefs } from './db';
import { getTheme, themeVars, DEFAULT_THEME_ID } from '../constants/themes';

export const THEME_CACHE_KEY = 'lh_theme_css';
const FONT_LINK_ID = 'lh-theme-font';

let applied = null;
let appliedProps = [];

function loadFont(href) {
  const existing = document.getElementById(FONT_LINK_ID);
  if (!href) {
    existing?.remove();
    return;
  }
  if (existing?.getAttribute('href') === href) return;
  const link = existing || document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  if (!existing) document.head.appendChild(link);
}

export function applyTheme(id) {
  const theme = getTheme(id);
  if (applied === theme.id) return theme;
  const root = document.documentElement;

  /* Clear what the previous theme set. A dark theme after a light one must not
     keep the light theme's darkened status colours. */
  for (const prop of appliedProps) root.style.removeProperty(prop);
  /* On the first call, what is on <html> came from the pre-paint cache in
     index.html, which may be a different theme than the one now stored (a sync
     changed it while the app was closed). Clear every custom property it set. */
  if (applied === null) {
    for (const prop of Array.from(root.style)) {
      if (prop.startsWith('--') || prop === 'color-scheme') root.style.removeProperty(prop);
    }
  }

  const vars = themeVars(theme);
  for (const [prop, value] of Object.entries(vars)) root.style.setProperty(prop, value);
  appliedProps = Object.keys(vars);

  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
  if (theme.texture) root.dataset.texture = theme.texture;
  else delete root.dataset.texture;

  loadFont(theme.fontHref);

  /* The browser chrome on mobile (address bar, Android task switcher). */
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme.paper;

  try {
    if (theme.id === DEFAULT_THEME_ID) localStorage.removeItem(THEME_CACHE_KEY);
    else {
      localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({
        id: theme.id,
        scheme: theme.scheme,
        texture: theme.texture || '',
        font: theme.fontHref || '',
        css: root.style.cssText,
      }));
    }
  } catch {
    /* Storage full or blocked: the theme still applies, it just paints black
       for a frame on the next cold start. */
  }

  applied = theme.id;
  return theme;
}

/* Applies the stored theme now and keeps it current: a change in the
   Appearance dialog, a sync that brings another device's choice, or another
   tab of this app. Called once from main.jsx, before the first render. */
export function initTheme() {
  const sync = () => applyTheme(getPrefs().theme);
  sync();
  window.addEventListener('moctale_prefs_update', sync);
  window.addEventListener('moctale_sync_update', sync);
  window.addEventListener('storage', (e) => {
    if (e.key === 'moctale_prefs') sync();
  });
}
