/* Records a library shelf switch (short shelf to a 60-game shelf) as video,
 * which, unlike screenshots, shows the composited view-transition frames,
 * then writes every frame that changed into one contact sheet.
 *
 *   node scripts/motion_video.mjs [baseUrl] [outDir] [chromium|firefox] [toShelf]
 *
 * Needs ffmpeg on PATH. A black frame or tiles in the wrong place in the
 * sheet is a rendering fault during the transition. */
import { chromium, firefox } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const base = process.argv[2] || 'http://localhost:5173';
const out = path.resolve(process.argv[3] || 'qa/motion-video');
const engine = process.argv[4] === 'chromium' ? chromium : firefox;
const toShelf = new RegExp(process.argv[5] || 'backlog', 'i');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f));

const browser = await engine.launch({ headless: process.env.HEADED !== '1' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: out, size: { width: 1280, height: 900 } } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  if (localStorage.getItem('__video_seed')) return;
  const covers = ['co1wyy', 'co4jni', 'co2lbd', 'co1r7f', 'co5vmg', 'co3p2d'];
  const lib = [{ id: 920001, name: 'Only Playing', status: 'Playing', cover_id: 'co1wyy' }];
  for (let i = 0; i < 60; i++) lib.push({ id: 900000 + i, name: `Backlog Game ${i + 1}`, status: 'Backlog', cover_id: covers[i % 6] });
  localStorage.setItem('moctale_library', JSON.stringify(lib));
  localStorage.setItem('__video_seed', '1');
});
const start = Date.now();
await page.goto(base + '/library/playing');
await page.waitForSelector('.hover-game-card', { timeout: 60000 });
await page.waitForTimeout(2500);
const clickAt = (Date.now() - start) / 1000;
await page.locator('button.lh-tab').filter({ hasText: toShelf }).first().click();
await page.waitForTimeout(1500);
await ctx.close();
await browser.close();

const video = fs.readdirSync(out).find((f) => f.endsWith('.webm'));
const from = Math.max(0, clickAt - 0.3);
execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', path.join(out, video), '-t', '1.3', '-vf', 'fps=30,scale=320:-1', path.join(out, 'f_%03d.png')]);
console.log(JSON.stringify({ video, clickAt, frames: fs.readdirSync(out).filter((f) => f.startsWith('f_')).length }));
