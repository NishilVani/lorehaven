#!/usr/bin/env node
/**
 * Every theme in src/constants/themes.js, measured against WCAG 2.2 AA.
 *
 * A theme is a set of colour pairs the app already renders; this checks the
 * pairs, not the swatches. Each rule below names the utility or token that
 * produces the pair, so a failure says where on screen it would show.
 *
 * Composition follows the browser: `text-white/N` is ink at alpha N composited
 * over the ground in gamma-encoded sRGB; `color-mix(in oklab, a P%, b)` is mixed
 * in OKLab. Exit 1 on any failure.
 *
 * Run: node tests/themes.test.mjs
 */
import { readFileSync } from 'node:fs';
import { THEMES, THEME_IDS, DEFAULT_THEME_ID, boostedAlpha, themeVars, onStateDim, isPreviewTheme } from '../src/constants/themes.js';

/* ── colour maths ─────────────────────────────────────────────────────────── */

const hex = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255);
};
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (rgb) => {
  const [r, g, b] = rgb.map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/* ink at alpha a over an opaque ground, as the compositor does it */
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

const toOklab = (rgb) => {
  const [r, g, b] = rgb.map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const fromOklab = ([L, A, B]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(c => Math.min(1, Math.max(0, toGam(c))));
};
const mixOklab = (a, b, p) => {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab(x.map((v, i) => v * p + y[i] * (1 - p)));
};

/* ── defaults the themes inherit from src/index.css ───────────────────────── */

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const token = (name) => {
  const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`index.css :root has no hex for --${name}`);
  return m[1];
};

const STATE_TEXT = [
  'status-solid-playing', 'status-solid-backlog', 'status-solid-wishlist',
  'status-solid-beaten', 'status-solid-dropped', 'status-solid-unreleased',
  'priority-next-up', 'priority-soon', 'priority-maybe', 'priority-someday',
  'feel-skip', 'feel-timepass', 'feel-go-for-it', 'feel-perfection-text',
];
/* Filled with --lh-on-state type: the poster stickers, the shelf strip, and the
   active status / priority / rating rows on a game's page. */
const STATE_FILL = [...STATE_TEXT.filter(n => n !== 'feel-perfection-text'), 'feel-perfection'];

/* ── checks ───────────────────────────────────────────────────────────────── */

let failures = 0;
let checks = 0;
const need = (theme, what, value, min) => {
  checks += 1;
  if (value + 1e-9 < min) {
    failures += 1;
    console.log(`  FAIL ${theme.id.padEnd(10)} ${what}: ${value.toFixed(2)}:1 (needs ${min}:1)`);
  }
};

const REQUIRED = ['id', 'name', 'group', 'description', 'scheme', 'paper', 'ink', 'text',
  'surface', 'surface2', 'fill', 'onFill', 'fillHover', 'onState'];

if (!THEME_IDS.has(DEFAULT_THEME_ID)) {
  console.log(`  FAIL default theme "${DEFAULT_THEME_ID}" is not registered`);
  failures += 1;
}
if (THEME_IDS.size !== THEMES.length) {
  console.log('  FAIL two themes share an id');
  failures += 1;
}

/* Preview marks a theme that changes more than colour. Editorial and Gallery
   change colour only; Daylight changes type and corners. */
for (const [id, want] of [['editorial', false], ['gallery', false], ['daylight', true]]) {
  checks += 1;
  if (isPreviewTheme(THEMES.find(t => t.id === id)) !== want) {
    failures += 1;
    console.log(`  FAIL ${id} should ${want ? '' : 'not '}be marked Preview`);
  }
}

for (const t of THEMES) {
  for (const k of REQUIRED) {
    checks += 1;
    if (t[k] === undefined || t[k] === '') {
      failures += 1;
      console.log(`  FAIL ${t.id} is missing "${k}"`);
    }
  }
  const v = themeVars(t);
  const c = (name) => hex(t.states?.[name] || token(name));

  const paper = hex(t.paper);
  const ink = hex(t.ink);
  const grounds = { paper, surface: hex(t.surface), surface2: hex(t.surface2) };

  for (const [gName, g] of Object.entries(grounds)) {
    need(t, `ink (text-white) on ${gName}`, ratio(ink, g), 7);
    need(t, `resting text (--text, gray-400) on ${gName}`, ratio(hex(t.text), g), 4.5);
    /* The app's floor for secondary copy, scripts/lint_contrast_tiers.mjs */
    const a50 = boostedAlpha(50, t.textBoost || 0) / 100;
    need(t, `text-white/50 (boosted to ${Math.round(a50 * 100)}%) on ${gName}`, ratio(over(ink, g, a50), g), 4.5);
  }

  /* The chosen/primary control: bg-white text-black, hover:bg-neutral-200 */
  need(t, 'fill against the ground (1.4.11)', ratio(hex(t.fill), paper), 3);
  need(t, 'on-fill type on fill', ratio(hex(t.onFill), hex(t.fill)), 4.5);
  need(t, 'on-fill type on fill hover', ratio(hex(t.onFill), hex(t.fillHover)), 4.5);

  /* Award shine: the darkest stop of the text gradient (index.css) */
  need(t, 'award-shine darkest stop', ratio(mixOklab(ink, paper, 0.62), paper), 4.5);

  for (const n of STATE_TEXT) need(t, `--${n} as text on paper`, ratio(c(n), paper), 4.5);
  for (const n of STATE_FILL) need(t, `on-state type on --${n}`, ratio(hex(t.onState), c(n)), 4.5);
  /* The shelf count on the mobile strip: text-(--lh-on-state-dim) (Library.jsx) */
  for (const n of STATE_FILL.filter(x => x.startsWith('status-solid'))) {
    const a = onStateDim(t) / 100;
    need(t, `on-state-dim count on --${n}`, ratio(over(hex(t.onState), c(n), a), c(n)), 4.5);
  }
  need(t, '--feel-perfection dot on paper (1.4.11)', ratio(c('feel-perfection'), paper), 3);

  need(t, '--destructive as text on paper', ratio(c('destructive'), paper), 4.5);
  need(t, 'paper type (hover:text-black) on --destructive-hover', ratio(paper, c('destructive-hover')), 4.5);
  need(t, '--warning as text on paper', ratio(c('warning'), paper), 4.5);

  checks += 1;
  if (!['light', 'dark'].includes(v['color-scheme'])) {
    failures += 1;
    console.log(`  FAIL ${t.id} has scheme "${t.scheme}"`);
  }
}

console.log(`themes: ${THEMES.length} themes, ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
