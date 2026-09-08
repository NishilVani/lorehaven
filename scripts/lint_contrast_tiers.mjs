#!/usr/bin/env node
/**
 * Guards the two contrast rules that a clean axe run does NOT catch, and that this
 * codebase has regressed on before. Run: node scripts/lint_contrast_tiers.mjs
 *
 * 1. Sub-AA text alpha. On the #000000 page, Tailwind alpha composites to a flat
 *    grey with one fixed ratio per step. Anything below /50 fails WCAG 1.4.3 for
 *    normal text:
 *      /20 1.66  /25 2.03  /30 2.48  /35 3.00  /40 3.66  /45 4.43   FAIL
 *      /50 5.32  /60 7.37                                            PASS
 *    Only `text-` is checked — border-/bg-/ring- at low alpha are decorative and
 *    legitimately exempt (WCAG 1.4.11 applies to controls, not dividers).
 *
 * 2. Compound opacity. An `opacity-*` utility on an element whose text colour
 *    already carries alpha multiplies the two. That shipped 131 nodes at
 *    1.93-2.48:1 in 9-10px type before it was caught, and it is invisible to axe
 *    unless the element happens to be on screen during a scan.
 *
 * Exit 1 on any violation so CI can gate it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const SKIP = new Set(['temp', '_archive', 'node_modules']);

const SUB_AA = /(?:^|[\s"'`:])((?:[a-z-]+:)*text-white\/(?:[0-9]|[1-4][0-9]))(?![0-9])/g;
/**
 * Bare `opacity-N` only. A variant-prefixed one (`disabled:opacity-40`,
 * `sm:group-hover:opacity-100`) is state-specific rather than a persistent dim —
 * and WCAG 1.4.3 exempts inactive controls — so those are not the defect.
 */
const OPACITY = /(?:^|\s)opacity-(?:[0-9]|[1-9][0-9])(?![0-9-])/;
const ALPHA_TEXT = /\btext-white\/[0-9]+/;

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
  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(SUB_AA)) {
      problems.push({ file, line: i + 1, rule: 'sub-aa-text-alpha', detail: m[1] });
    }
    // Only flag when BOTH appear in the same class string.
    for (const cls of line.matchAll(/class(?:Name)?=["'`]([^"'`]+)["'`]/g)) {
      if (OPACITY.test(cls[1]) && ALPHA_TEXT.test(cls[1])) {
        problems.push({ file, line: i + 1, rule: 'compound-opacity', detail: cls[1].slice(0, 60) });
      }
    }
  });
}

if (problems.length === 0) {
  console.log('contrast tiers: clean (no sub-AA text alpha, no compound opacity)');
  process.exit(0);
}
console.error(`contrast tiers: ${problems.length} violation(s)\n`);
for (const p of problems) {
  console.error(`  ${relative('.', p.file)}:${p.line}  [${p.rule}]  ${p.detail}`);
}
console.error('\nUse text-white/50 (5.32:1) or /60 (7.37:1). Never stack opacity-* on alpha text.');
process.exit(1);
