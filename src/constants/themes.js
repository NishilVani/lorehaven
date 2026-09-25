/* The theme registry. One entry per theme, and the only place a theme's colours,
 * type and geometry are written down.
 *
 * Three readers, which is why this is plain data with no DOM in it:
 *   - src/services/theme.js turns an entry into CSS custom properties on <html>;
 *   - src/components/ui/AppearanceDialog.jsx draws each entry's preview card;
 *   - tests/themes.test.mjs measures every entry against WCAG 2.2 AA, so a theme
 *     that reads well to the eye but fails contrast cannot ship.
 *
 * HOW A THEME REACHES THE PAGE
 * The app was written in two colours, and ~2,500 Tailwind utilities say so:
 * `text-white`, `border-white/15`, `bg-black`. src/index.css points Tailwind's
 * `--color-white` at `--lh-ink` and `--color-black` at `--lh-paper`, so "white"
 * now means "the ink of the current theme" and "black" means "its ground". The
 * utilities did not change; what they resolve to did.
 *
 * `fill` is what a chosen or primary control wears -- the `bg-white text-black`
 * inversion that is this app's one selection signal. In Editorial it IS the ink.
 * Other themes may give it a hue of its own (a red, a green) so their accent
 * shows up where the user's attention already goes.
 *
 * `textBoost` exists because of alpha text. `text-white/50` is the floor the
 * app uses for secondary copy; over pure black it measures 5.32:1, but ink at
 * half strength over any lighter ground falls under 4.5:1 (over white it can
 * never exceed 3.95:1). A boost of k lifts every `text-white/N` to
 * N + (100 - N) * k, keeping the ramp in order while clearing AA. It touches
 * text colour only; borders and washes keep the alpha they were written with.
 *
 * Names are our own. Themes are INSPIRED BY an app, a game or a film, and the
 * description says so, but none of them carries another company's name, logo
 * or proprietary typeface.
 */

/* Status, priority and feel on a light ground. The default hues are bright so
   they read against black and against cover art; on paper they wash out, and
   several are used as text. These are the same hues taken down to where they
   clear 4.5:1 as text on a light page and carry white type as a fill. */
const LIGHT_STATES = {
  'status-solid-playing': '#065f46',
  'status-solid-backlog': '#1d4ed8',
  'status-solid-wishlist': '#6d28d9',
  'status-solid-beaten': '#92400e',
  'status-solid-dropped': '#b91c1c',
  'status-solid-unreleased': '#155e75',
  'priority-next-up': '#3f6212',
  'priority-soon': '#9a3412',
  'priority-maybe': '#0369a1',
  'priority-someday': '#475569',
  'feel-skip': '#be123c',
  'feel-timepass': '#92400e',
  'feel-go-for-it': '#065f46',
  'feel-perfection': '#7e22ce',
  'feel-perfection-text': '#7e22ce',
  destructive: '#b91c1c',
  'destructive-hover': '#991b1b',
  'destructive-border': 'rgba(185, 28, 28, 0.7)',
  'destructive-wash': 'rgba(185, 28, 28, 0.08)',
  warning: '#92400e',
  'warning-border': 'rgba(146, 64, 14, 0.6)',
};

const GF = 'https://fonts.googleapis.com/css2?display=swap&';

export const THEME_GROUPS = [
  { id: 'signature', label: 'Signature', blurb: 'LoreHaven as it was drawn.' },
  { id: 'apps', label: 'Inspired By Apps', blurb: 'The feel of the apps you already live in.' },
  { id: 'games', label: 'Inspired By Games', blurb: 'Interfaces lifted from the worlds you play.' },
  { id: 'film', label: 'Inspired By Film', blurb: 'Grades and type from the cinema.' },
];

export const THEMES = [
  /* ── Signature ─────────────────────────────────────────────────────────── */
  {
    id: 'editorial',
    name: 'Editorial',
    group: 'signature',
    description: 'Stark editorial brutalism. Pitch black, pure white, sharp edges. Art is the only colour.',
    scheme: 'dark',
    paper: '#000000',
    ink: '#ffffff',
    text: '#a3a3a3',
    surface: '#0a0a0a',
    surface2: '#171717',
    fill: '#ffffff',
    onFill: '#000000',
    fillHover: '#e5e5e5',
    onState: '#000000',
    textBoost: 0,
  },
  {
    id: 'gallery',
    name: 'Gallery',
    group: 'signature',
    description: 'The same museum with the lights up. Black type on white walls, still square, still uppercase.',
    scheme: 'light',
    paper: '#ffffff',
    ink: '#000000',
    text: '#525252',
    surface: '#ffffff',
    surface2: '#f0f0f0',
    fill: '#000000',
    onFill: '#ffffff',
    fillHover: '#262626',
    onState: '#ffffff',
    textBoost: 0.36,
    states: LIGHT_STATES,
  },

  /* ── Inspired by apps ──────────────────────────────────────────────────── */
  {
    id: 'daylight',
    name: 'Daylight',
    group: 'apps',
    description: 'Inspired by Apple. Soft grey canvas, system type, rounded controls and a clear blue for action.',
    scheme: 'light',
    paper: '#f5f5f7',
    ink: '#1d1d1f',
    text: '#515154',
    surface: '#ffffff',
    surface2: '#e8e8ed',
    fill: '#0066cc',
    onFill: '#ffffff',
    fillHover: '#0058b0',
    onState: '#ffffff',
    textBoost: 0.42,
    states: LIGHT_STATES,
    sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Helvetica Neue', system-ui, sans-serif",
    heading: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Helvetica Neue', system-ui, sans-serif",
    fontHref: `${GF}family=Inter:wght@400..700`,
    radiusControl: '10px',
    radiusPanel: '16px',
    caseLabel: 'none',
    caseDisplay: 'none',
    labelTracking: '0.01em',
    displayTracking: '-0.025em',
  },
  {
    id: 'marquee',
    name: 'Marquee',
    group: 'apps',
    description: 'Inspired by Netflix. Cinema black, a red that means play, and tall condensed titles.',
    scheme: 'dark',
    paper: '#141414',
    ink: '#ffffff',
    text: '#b3b3b3',
    surface: '#181818',
    surface2: '#232323',
    fill: '#e50914',
    onFill: '#ffffff',
    fillHover: '#c11119',
    onState: '#000000',
    textBoost: 0.08,
    sans: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
    heading: "'Bebas Neue', 'Inter', system-ui, sans-serif",
    fontHref: `${GF}family=Bebas+Neue&family=Inter:wght@400..700`,
    radiusControl: '4px',
    radiusPanel: '6px',
    displayTracking: '0.02em',
    texture: 'vignette',
  },
  {
    id: 'groove',
    name: 'Groove',
    group: 'apps',
    description: 'Inspired by Spotify. Near-black panels, pill buttons and a bright green for what is playing.',
    scheme: 'dark',
    paper: '#121212',
    ink: '#ffffff',
    text: '#b3b3b3',
    surface: '#181818',
    surface2: '#282828',
    fill: '#1ed760',
    onFill: '#000000',
    fillHover: '#3be477',
    onState: '#000000',
    textBoost: 0.06,
    sans: "'Figtree', 'Helvetica Neue', system-ui, sans-serif",
    heading: "'Figtree', 'Helvetica Neue', system-ui, sans-serif",
    fontHref: `${GF}family=Figtree:wght@400..800`,
    radiusControl: '9999px',
    radiusPanel: '8px',
    caseLabel: 'none',
    caseDisplay: 'none',
    labelTracking: '0.02em',
    displayTracking: '-0.03em',
  },
  {
    id: 'lounge',
    name: 'Lounge',
    group: 'apps',
    description: 'Inspired by Discord. Slate greys, soft corners and an indigo that says you are here.',
    scheme: 'dark',
    paper: '#1e1f22',
    ink: '#f2f3f5',
    text: '#b5bac1',
    surface: '#2b2d31',
    surface2: '#313338',
    fill: '#7c86ff',
    onFill: '#000000',
    fillHover: '#9ba3ff',
    onState: '#000000',
    textBoost: 0.18,
    sans: "'Noto Sans', 'Helvetica Neue', system-ui, sans-serif",
    heading: "'Noto Sans', 'Helvetica Neue', system-ui, sans-serif",
    fontHref: `${GF}family=Noto+Sans:wght@400..800`,
    radiusControl: '4px',
    radiusPanel: '8px',
    caseLabel: 'none',
    caseDisplay: 'none',
    labelTracking: '0.02em',
    displayTracking: '-0.01em',
    /* #ef4444 carries the slate ground as type at 4.38:1; one step lighter clears it. */
    states: { 'destructive-hover': '#f87171' },
  },

  /* ── Inspired by games ─────────────────────────────────────────────────── */
  {
    id: 'phosphor',
    name: 'Phosphor',
    group: 'games',
    description: 'Inspired by the wasteland wrist terminal. Green phosphor on a dead screen, monospace, scan lines.',
    scheme: 'dark',
    paper: '#050d06',
    ink: '#6bff8f',
    text: '#43c965',
    surface: '#08140a',
    surface2: '#0e2112',
    fill: '#6bff8f',
    onFill: '#050d06',
    fillHover: '#a3ffb9',
    onState: '#000000',
    textBoost: 0.1,
    sans: "'IBM Plex Mono', ui-monospace, Consolas, monospace",
    heading: "'VT323', 'IBM Plex Mono', ui-monospace, monospace",
    fontHref: `${GF}family=IBM+Plex+Mono:wght@400;500;700&family=VT323`,
    labelTracking: '0.08em',
    displayTracking: '0.02em',
    texture: 'scanlines',
  },
  {
    id: 'neon',
    name: 'Neon Arcade',
    group: 'games',
    description: 'Inspired by synthwave racers and arcade cabinets. Midnight violet, hot magenta, chrome type.',
    scheme: 'dark',
    paper: '#0d0221',
    ink: '#fbf3ff',
    text: '#c7b3dd',
    surface: '#150533',
    surface2: '#1f0a45',
    fill: '#ff2bd6',
    onFill: '#000000',
    fillHover: '#ff6ae2',
    onState: '#000000',
    textBoost: 0.08,
    heading: "'Orbitron', 'Space Grotesk', system-ui, sans-serif",
    fontHref: `${GF}family=Orbitron:wght@500..900`,
    radiusControl: '2px',
    radiusPanel: '2px',
    displayTracking: '0.02em',
    texture: 'grid',
  },
  {
    id: 'nightcity',
    name: 'Night City',
    group: 'games',
    description: 'Inspired by cyberpunk RPGs. Hazard yellow on black glass, cyan for the thing you picked.',
    scheme: 'dark',
    paper: '#0a0a0c',
    ink: '#fcee0a',
    text: '#c9bd2a',
    surface: '#111116',
    surface2: '#1a1a22',
    fill: '#02d7f2',
    onFill: '#000000',
    fillHover: '#6ae9f8',
    onState: '#000000',
    textBoost: 0.08,
    sans: "'Barlow', 'Helvetica Neue', system-ui, sans-serif",
    heading: "'Rajdhani', 'Barlow', system-ui, sans-serif",
    fontHref: `${GF}family=Barlow:wght@400;500;600;700&family=Rajdhani:wght@600;700`,
    displayTracking: '0.01em',
    texture: 'hatch',
  },
  {
    id: 'grimoire',
    name: 'Grimoire',
    group: 'games',
    description: 'Inspired by fantasy RPG journals. Aged parchment, ink-brown serif type, a wax-seal red.',
    scheme: 'light',
    paper: '#f3e9d2',
    ink: '#2b1d0e',
    text: '#5a4630',
    surface: '#f8f1e0',
    surface2: '#eadcbd',
    fill: '#7a1f1f',
    onFill: '#f8f1e0',
    fillHover: '#5e1616',
    onState: '#ffffff',
    textBoost: 0.4,
    states: LIGHT_STATES,
    sans: "'EB Garamond', Georgia, 'Times New Roman', serif",
    heading: "'Cinzel', 'EB Garamond', Georgia, serif",
    fontHref: `${GF}family=Cinzel:wght@500..800&family=EB+Garamond:wght@400..700`,
    radiusControl: '2px',
    radiusPanel: '2px',
    labelTracking: '0.14em',
    displayTracking: '0.02em',
    texture: 'grain',
  },

  /* ── Inspired by film ──────────────────────────────────────────────────── */
  {
    id: 'noir',
    name: 'Noir',
    group: 'film',
    description: 'Inspired by 1940s crime pictures. Warm black, projector cream, high-contrast serif titles and film grain.',
    scheme: 'dark',
    paper: '#0f0d0b',
    ink: '#f2e8d5',
    text: '#b8ab94',
    surface: '#171411',
    surface2: '#221e19',
    fill: '#f2e8d5',
    onFill: '#0f0d0b',
    fillHover: '#d9ccb3',
    onState: '#000000',
    textBoost: 0.1,
    sans: "'Libre Franklin', 'Helvetica Neue', system-ui, sans-serif",
    heading: "'Playfair Display', Georgia, serif",
    fontHref: `${GF}family=Playfair+Display:wght@500..900&family=Libre+Franklin:wght@400..700`,
    caseDisplay: 'none',
    displayTracking: '-0.01em',
    texture: 'grain',
  },
  {
    id: 'spice',
    name: 'Spice',
    group: 'film',
    description: 'Inspired by desert-planet epics. Sun-bleached sand, deep umber type, a burnt-orange horizon.',
    scheme: 'light',
    paper: '#ede0c6',
    ink: '#24160a',
    text: '#57432d',
    surface: '#f5ecd9',
    surface2: '#e2d1b0',
    fill: '#a3401a',
    onFill: '#ffffff',
    fillHover: '#853414',
    onState: '#ffffff',
    textBoost: 0.4,
    states: LIGHT_STATES,
    heading: "'Marcellus', Georgia, serif",
    fontHref: `${GF}family=Marcellus`,
    labelTracking: '0.22em',
    displayTracking: '0.04em',
  },
  {
    id: 'replicant',
    name: 'Replicant',
    group: 'film',
    description: 'Inspired by neo-noir science fiction. Amber haze over a dark city, orange light, thin tech type.',
    scheme: 'dark',
    paper: '#0e0905',
    ink: '#ffd9a8',
    text: '#c9a57a',
    surface: '#160e08',
    surface2: '#22160c',
    fill: '#ff8a1f',
    onFill: '#000000',
    fillHover: '#ffa552',
    onState: '#000000',
    textBoost: 0.1,
    sans: "'Barlow', 'Helvetica Neue', system-ui, sans-serif",
    heading: "'Oxanium', 'Barlow', system-ui, sans-serif",
    fontHref: `${GF}family=Barlow:wght@400;500;600;700&family=Oxanium:wght@500..800`,
    displayTracking: '0.02em',
    texture: 'haze',
  },
];

export const DEFAULT_THEME_ID = 'editorial';

/* The keys that change more than colour: type, case, tracking, corners and
   texture. Colour is measured for every theme by tests/themes.test.mjs; these
   are not, and every screen was built square, uppercase and in Space Grotesk,
   so a theme that sets any of them is labelled Preview in the picker until it
   has been looked at screen by screen. Derived rather than flagged by hand, so
   a new theme cannot forget the label. */
const BEYOND_COLOUR = ['sans', 'heading', 'fontHref', 'radiusControl', 'radiusPanel',
  'caseLabel', 'caseDisplay', 'labelTracking', 'displayTracking', 'texture'];

export const isPreviewTheme = (t) => BEYOND_COLOUR.some(k => t[k] !== undefined);

export const THEME_IDS = new Set(THEMES.map(t => t.id));

export const getTheme = (id) =>
  THEMES.find(t => t.id === id) || THEMES.find(t => t.id === DEFAULT_THEME_ID);

/* The secondary type on a state fill (the shelf count on the mobile strip).
   Black at 70% clears AA on every bright fill; white over the darker light-theme
   fills needs more of itself to do the same. */
export const onStateDim = (t) => (t.scheme === 'light' ? 90 : 70);

/* Tailwind alpha steps the app actually writes for text. The contrast test
   checks the floor (/50) and the boost keeps the rest in order above it. */
export const boostedAlpha = (n, k) => n + (100 - n) * k;

/**
 * The CSS custom properties a theme sets on <html>. Anything a theme leaves out
 * falls back to Editorial's value, so an entry only states what makes it
 * different.
 */
export function themeVars(theme) {
  const t = theme || getTheme(DEFAULT_THEME_ID);
  const vars = {
    '--lh-paper': t.paper,
    '--lh-ink': t.ink,
    '--lh-text': t.text,
    '--lh-surface': t.surface,
    '--lh-surface-2': t.surface2,
    '--lh-fill': t.fill,
    '--lh-on-fill': t.onFill,
    '--lh-fill-hover': t.fillHover,
    '--lh-on-state': t.onState,
    '--lh-on-state-dim': `color-mix(in oklab, ${t.onState} ${onStateDim(t)}%, transparent)`,
    '--lh-text-boost': String(t.textBoost || 0),
    '--lh-radius-control': t.radiusControl || '0px',
    '--lh-radius-panel': t.radiusPanel || '0px',
    '--lh-case-label': t.caseLabel || 'uppercase',
    '--lh-case-display': t.caseDisplay || 'uppercase',
    '--lh-label-tracking': t.labelTracking || '0.18em',
    '--lh-display-tracking': t.displayTracking || '-0.02em',
    '--sans': t.sans || "'Space Grotesk', system-ui, 'Segoe UI', sans-serif",
    '--heading': t.heading || "'Space Grotesk', system-ui, sans-serif",
    'color-scheme': t.scheme === 'light' ? 'light' : 'dark',
  };
  for (const [k, v] of Object.entries(t.states || {})) vars[`--${k}`] = v;
  return vars;
}
