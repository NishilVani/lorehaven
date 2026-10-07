/* Layout audit of the app on a USB phone (debug build), one route at a time.
 *   node scripts/phone_audit.mjs <outDir> <route|@harvest> [...]
 * A route is a path; "@<path>|<href prefix>" visits <path> and audits the
 * first link starting with <href prefix> (real ids for detail pages).
 *
 * Per route it waits for the page to settle, then measures, at the top, the
 * middle and the bottom of the page:
 *   - overflowX: the document scrolls sideways
 *   - offscreen: visible elements past either edge, outside any scroller
 *   - statusBar: what is painted, topmost, under the status bar
 *   - handleBar: interactive elements under the gesture handle
 *   - clipped: text cut off without an ellipsis
 *   - skeletons: placeholders still on screen after settling
 * and saves <outDir>/<slug>.png (the three viewports side by side) and
 * <outDir>/report.json. Pixels still need a human look: these are leads. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

const PKG = process.env.PKG || 'com.lorehaven.games.debug';
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();
const [outDir, ...targets] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const pid = adb('shell', 'pidof', PKG).split(/\s+/)[0];
adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];

/* Router navigation without a reload: the history shape React Router writes,
   so Back and the page stack behave as after a tap. */
const go = (path) => page.evaluate((p) => {
  const idx = (window.history.state?.idx ?? 0) + 1;
  window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', p);
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}, path);

const settle = async () => {
  await page.waitForTimeout(1200);
  for (let i = 0; i < 16; i++) {
    const busy = await page.evaluate(() => !!document.documentElement.dataset.vt
      || [...document.querySelectorAll('main .skeleton-placeholder, main [aria-busy="true"]')].some((e) => !e.closest('[hidden]') && e.getClientRects().length));
    if (!busy) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
};

const measure = () => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0, bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  const front = document.querySelector('main') || document.body;
  const live = (el) => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0;
  const name = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const txt = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls === '.' ? '' : cls}${txt ? ` "${txt}"` : ''}`;
  };
  const scroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
    }
    return false;
  };
  const offscreen = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!live(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !scroller(el)) {
      const s = getComputedStyle(el);
      if (s.position === 'fixed' && (r.left >= vw || r.right <= 0)) continue; // parked off screen on purpose
      if (s.visibility === 'hidden' || s.opacity === '0') continue;
      offscreen.push(`${name(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
  }
  const at = (x, y) => document.elementFromPoint(x, y);
  const statusBar = new Set();
  if (top > 0) for (const x of [12, vw * 0.3, vw * 0.5, vw * 0.7, vw - 12]) {
    const el = at(x, top / 2);
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const isChrome = el.closest('header, [data-chrome], #root > div > div:first-child') && !el.closest('main');
    const hasText = (el.innerText || '').trim().length > 0 || el.tagName === 'IMG' || el.tagName === 'svg';
    if (!['HTML', 'BODY'].includes(el.tagName) && (hasText || el.closest('[role=dialog], [role=menu]')) && !isChrome) statusBar.add(name(el) + ` bg=${bg}`);
  }
  const handleBar = new Set();
  if (bottom > 0) for (const x of [vw * 0.3, vw * 0.5, vw * 0.7]) {
    const el = at(x, vh - bottom / 2);
    const hit = el?.closest('a, button, input, select, textarea, [role=button], [role=tab], [role=menuitem]');
    if (hit) handleBar.add(name(hit));
  }
  const clipped = [];
  for (const el of front.querySelectorAll('h1, h2, h3, h4, p, span, a, button, div, li, label')) {
    if (!live(el) || el.children.length > 2) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' || /line-clamp/.test(el.className) || s.webkitLineClamp !== 'none') continue;
    if (!/(hidden|clip)/.test(s.overflow + s.overflowX)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && (el.innerText || '').trim()) clipped.push(name(el));
  }
  const skeletons = [...document.querySelectorAll('main .skeleton-placeholder')].filter(live).length;
  return { vw, vh, insets: { top, bottom }, overflowX: document.scrollingElement.scrollWidth - vw, offscreen: offscreen.slice(0, 8), statusBar: [...statusBar], handleBar: [...handleBar], clipped: clipped.slice(0, 8), skeletons, scrollH: document.scrollingElement.scrollHeight };
});

const report = [];
for (const t of targets) {
  let path = t;
  try {
    if (t.startsWith('@')) {
      const [from, prefix] = t.slice(1).split('|');
      await go(from); await settle();
      path = await page.evaluate((p) => [...document.querySelectorAll(`main a[href^="${p}"]`)].find((a) => !a.closest('[hidden]'))?.getAttribute('href'), prefix);
      if (!path) { report.push({ route: t, error: `no link ${prefix} on ${from}` }); console.log(`${t}: no link`); continue; }
    }
    await go(path);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle();
    const slug = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
    const shots = []; const views = [];
    const h = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    for (const y of [0, Math.round(h / 2), h]) {
      if (views.length && y === views.at(-1).y) continue;
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(700);
      const m = await measure();
      views.push({ y, ...m });
      shots.push(await page.screenshot());
    }
    const panels = await Promise.all(shots.map((b) => sharp(b).resize({ width: 360 }).toBuffer()));
    const meta = await Promise.all(panels.map((b) => sharp(b).metadata()));
    const H = Math.max(...meta.map((m) => m.height));
    await sharp({ create: { width: 370 * panels.length, height: H, channels: 3, background: '#ff00ff' } })
      .composite(panels.map((b, i) => ({ input: b, left: i * 370, top: 0 }))).png().toFile(`${outDir}/${slug}.png`);
    const flat = (k) => [...new Set(views.flatMap((v) => v[k]))];
    const r = { route: t, path, overflowX: Math.max(...views.map((v) => v.overflowX)), offscreen: flat('offscreen'), statusBar: flat('statusBar'), handleBar: flat('handleBar'), clipped: flat('clipped'), skeletons: Math.max(...views.map((v) => v.skeletons)), insets: views[0].insets, shot: `${slug}.png` };
    report.push(r);
    const flags = [r.overflowX > 0 && `overflowX=${r.overflowX}`, r.offscreen.length && `offscreen=${r.offscreen.length}`, r.statusBar.length && `statusBar=${r.statusBar.length}`, r.handleBar.length && `handleBar=${r.handleBar.length}`, r.clipped.length && `clipped=${r.clipped.length}`, r.skeletons && `skeletons=${r.skeletons}`].filter(Boolean);
    console.log(`${path}: ${flags.join(' ') || 'clean'}`);
  } catch (e) {
    report.push({ route: t, error: String(e.message || e).slice(0, 200) });
    console.log(`${t}: ERROR ${String(e.message || e).slice(0, 120)}`);
  }
}
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
