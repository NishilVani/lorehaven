/* Android launcher icons from one SVG mark.
 *
 *   node scripts/android_icon.mjs [path/to/mark.svg]
 *
 * Defaults to src-tauri/icons/android-mark.svg. Writes every density under
 * src-tauri/gen/android/app/src/main/res.
 *
 * Why this exists. Android 8+ draws an ADAPTIVE icon: a 108dp foreground layer
 * over a background layer, of which a launcher shows only the middle 72dp and
 * then cuts that to its own shape — a circle on most phones. Anything outside
 * the centre 66dp circle can be clipped. The old foreground was the whole icon,
 * black plate and mark, edge to edge on the 108dp canvas, so the launcher
 * zoomed into it (108 -> 72) and the circle took the corners off the mark.
 *
 * So the foreground is the white mark ALONE, scaled until the corner of its ink
 * box furthest from centre sits at SAFE_R dp, inside the 33dp safe radius with
 * room to spare; the black comes from the background layer. The legacy square
 * and round icons (Android 7 and below) are the same composition cropped to
 * the visible 72dp, on a black square and a black circle.
 *
 * Every density is rendered from the vector at its own pixel size rather than
 * resampled from one bitmap: every edge in this mark is straight, and a
 * downscale softens all of them. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] || path.join(ROOT, 'src-tauri/icons/android-mark.svg');
const RES = path.join(ROOT, 'src-tauri/gen/android/app/src/main/res');

const SAFE_R = 30;          // dp from centre to the mark's outermost corner (safe zone is 33)
const CANVAS = 108;         // adaptive icon layer, dp
const VISIBLE = 72;         // what a launcher shows of it, dp
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/* The mark is every white path in the file; the black plate is dropped. */
const svg = fs.readFileSync(src, 'utf8');
const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const paths = [...svg.matchAll(/<path\b[^>]*\/>/g)].map(m => m[0]).filter(p => /fill="(white|#fff(fff)?)"/i.test(p));
if (paths.length === 0) throw new Error(`no white paths in ${src}`);

/* Ink box of the mark, from the path data. Every command in it is absolute
   M/H/V/Z, which is what the logo tool exports; anything else is refused
   rather than measured wrong. */
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const p of paths) {
  const d = p.match(/\sd="([^"]+)"/)[1];
  if (/[^MHVZ0-9.\s-]/i.test(d) || /[mhvz]/.test(d.replace(/[MHVZ]/g, ''))) throw new Error('path uses commands other than absolute M/H/V/Z');
  let x = 0, y = 0;
  for (const [, cmd, args] of d.matchAll(/([MHVZ])([^MHVZ]*)/g)) {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === 'M') [x, y] = n;
    else if (cmd === 'H') x = n[0];
    else if (cmd === 'V') y = n[0];
    if (cmd !== 'Z') {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
}
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
const halfDiag = Math.hypot((maxX - minX) / 2, (maxY - minY) / 2);
const s = SAFE_R / halfDiag;                       // dp per source unit
const mark = `<g transform="translate(${CANVAS / 2 - cx * s} ${CANVAS / 2 - cy * s}) scale(${s})">${paths.join('')}</g>`;

/* Foreground: 108dp, transparent, mark only. */
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">${mark}</svg>`;
/* Legacy: the visible 72dp of the same composition on a black plate. */
const o = (CANVAS - VISIBLE) / 2;
const legacy = (shape) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${o} ${VISIBLE} ${VISIBLE}">${shape}${mark}</svg>`;
const square = legacy(`<rect x="${o}" y="${o}" width="${VISIBLE}" height="${VISIBLE}" fill="#000"/>`);
const round = legacy(`<circle cx="${CANVAS / 2}" cy="${CANVAS / 2}" r="${VISIBLE / 2}" fill="#000"/>`);

/* density makes the vector rasterise at exactly px, so nothing is resampled. */
const render = (svgText, units, px, out) => sharp(Buffer.from(svgText), { density: 72 * px / units })
  .png({ compressionLevel: 9 })
  .toFile(out);

for (const [name, k] of Object.entries(DENSITIES)) {
  const dir = path.join(RES, `mipmap-${name}`);
  await render(foreground, CANVAS, Math.round(CANVAS * k), path.join(dir, 'ic_launcher_foreground.png'));
  await render(square, VISIBLE, Math.round(48 * k), path.join(dir, 'ic_launcher.png'));
  await render(round, VISIBLE, Math.round(48 * k), path.join(dir, 'ic_launcher_round.png'));
}

console.log(`mark ink ${maxX - minX}x${maxY - minY} units, scale ${s.toFixed(4)} dp/unit, ` +
  `drawn ${((maxX - minX) * s).toFixed(1)}x${((maxY - minY) * s).toFixed(1)}dp, corner at ${SAFE_R}dp of 33dp safe`);
