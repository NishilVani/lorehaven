#!/usr/bin/env node
/**
 * Guards against font-size utilities that cannot render.
 * Run: node scripts/lint_label_size.mjs [dir]   (dir defaults to src/)
 *
 * `.lh-label` is declared in src/index.css OUTSIDE every `@layer`. Unlayered CSS
 * beats anything inside `@layer utilities`, which is where Tailwind puts
 * `text-[9px]`, `text-xs`, `lg:text-[11px]` and friends — specificity never enters
 * into it, the cascade layer decides first. So any font-size utility sharing a
 * className with `.lh-label` is dead on arrival: the element renders at the class's
 * own 0.6875rem (11px).
 *
 * Measured 2026-08-14 in headless Chromium against the running app: 545 of 545
 * `.lh-label` elements carrying a size utility computed to 11px, across 12 routes
 * and both 414px and 1280px viewports. Responsive variants lose too — at 1280px
 * (lg active) `lh-label text-[9px] lg:text-[10px]` measured 11px while the same
 * pair without `lh-label` measured 10px.
 *
 * This is not cosmetic. A dead utility is a lie in the source: someone reads
 * `text-[8px]`, believes an 8px step exists, and designs the next screen around a
 * ramp that has never rendered. The fix is deletion, not a `!` — the app has always
 * shipped one label size and 8px on a card spine was never legible anyway.
 *
 * `.lh-display` and `.lh-brand` are also unlayered but set no font-size, so their
 * paired utilities render normally and are NOT flagged.
 *
 * Exit 1 on any violation so CI can gate it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] || 'src';
const SKIP = new Set(['temp', '_archive', 'node_modules']);

/** Classes proven to set font-size from outside any cascade layer. */
const OVERRIDING = ['lh-label'];

/**
 * A font-SIZE utility, optionally variant-prefixed (`lg:`, `group-hover:`, `md:`).
 * Arbitrary values are matched only in absolute units, so `text-white/60`,
 * `text-center`, `text-balance` and `tracking-widest` are left alone.
 */
const SIZE_UTIL =
  /(?<![\w/-])((?:[a-z0-9.@-]+:)*text-(?:\[[0-9.]+(?:px|rem|em)\]|xs|sm|base|lg|xl|[2-9]xl))(?![\w/[-])/g;

/**
 * Every quoted literal on a line — className is often a template with holes.
 *
 * The trailing branch matters: a className template routinely spans lines, and
 * its closing backtick then sits on a later one. Requiring a matching quote on
 * the SAME line made every multi-line className invisible to this lint, and one
 * was live the whole time — GameDetail.jsx:837 opens a template carrying
 * `lh-label text-[9px]`, never closes it on that line, and so was skipped
 * entirely while the gate reported clean. Anything after an unmatched opening
 * quote is treated as literal text to the end of the line.
 */
function stringLiterals(line) {
  const out = [];
  const re = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  let end = 0;
  while ((m = re.exec(line))) { out.push(m[2]); end = re.lastIndex; }
  const rest = line.slice(end);
  const open = rest.search(/["'`]/);
  if (open !== -1) out.push(rest.slice(open + 1));
  return out;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.jsx')) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const text of stringLiterals(line)) {
      const cls = OVERRIDING.find((c) => new RegExp(`(^|\\s)${c}(\\s|$)`).test(text));
      if (!cls) continue;
      SIZE_UTIL.lastIndex = 0;
      for (const m of text.matchAll(SIZE_UTIL)) {
        problems.push({ file, line: i + 1, cls, util: m[1] });
      }
    }
  });
}

if (problems.length === 0) {
  console.log(`label size: clean (no font-size utility paired with .${OVERRIDING.join('/.')})`);
  process.exit(0);
}
console.error(`label size: ${problems.length} dead font-size utilit(ies)\n`);
for (const p of problems) {
  console.error(`  ${relative('.', p.file)}:${p.line}  ${p.util} is dead — .${p.cls} renders it at 11px`);
}
console.error('\nDelete the utility. Labels are one size (11px, set by .lh-label); if a');
console.error('different size is genuinely needed, drop .lh-label and set the type directly.');
process.exit(1);
