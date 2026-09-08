/**
 * Tab through each route and assert every stop is actually visible.
 *
 * Off-canvas drawers, cross-fading toolbar layers and collapsed accordions are
 * hidden with `translate`, `opacity-0` or `max-height:0` — none of which remove
 * anything from the tab order. The result is a run of invisible tab stops where
 * the focus ring simply vanishes (WCAG 2.4.3 Focus Order, 2.4.7 Focus Visible).
 * `inert` is the fix; this is the check that it stayed applied.
 *
 *   node scripts/verify_tab_order.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const ROUTES = ['/', '/library/backlog', '/collections', '/events', '/wallpapers', '/awards', '/platforms',
    '/profile', '/profile/year/2025', '/game/1942'];   // a populated game detail page — see a11y_gate.mjs
const STOPS = 60;

/* Mobile is where the off-canvas layers live, so it is the shell that matters most. */
const SHELLS = [
    ['desktop', { width: 1280, height: 900 }],
    ['mobile', { width: 375, height: 812 }],
];

const PROBE = () => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Walk up for an ancestor that zeroes out opacity or clips the box shut.
    let hiddenBy = null;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (parseFloat(s.opacity) === 0) { hiddenBy = 'opacity:0 on ' + n.tagName.toLowerCase(); break; }
        if (s.visibility === 'hidden') { hiddenBy = 'visibility:hidden'; break; }
        const nr = n.getBoundingClientRect();
        if (s.overflow !== 'visible' && (nr.height < 1 || nr.width < 1)) { hiddenBy = 'clipped by collapsed ancestor'; break; }
    }
    const offscreen = r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight + 4000;
    return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        zero: r.width < 1 || r.height < 1,
        srOnly: el.className && String(el.className).includes('sr-only'),
        offscreen, hiddenBy,
    };
};

const browser = await chromium.launch();
let failed = 0, checked = 0;

for (const [shell, viewport] of SHELLS) {
    console.log(`\n=== ${shell} (${viewport.width}px) ===`);
    const page = await browser.newPage({ viewport });
    for (const route of ROUTES) {
        try { await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch { /* SPA keeps sockets open */ }
        await page.waitForTimeout(3000);
        await page.evaluate(() => document.body.focus());

        const bad = [];
        const seen = new Set();
        for (let i = 0; i < STOPS; i++) {
            await page.keyboard.press('Tab');
            const s = await page.evaluate(PROBE);
            if (!s) continue;
            checked++;
            const key = `${s.tag}:${s.name}`;
            if (seen.has(key + i)) break;
            seen.add(key + i);
            // sr-only skip links are deliberately 1x1 and become visible on focus.
            if (s.srOnly) continue;
            if (s.zero || s.offscreen || s.hiddenBy) {
                bad.push(`${s.tag}<${s.name || '?'}> ${s.hiddenBy || (s.zero ? 'zero-size' : 'offscreen')}`);
            }
        }
        const uniq = [...new Set(bad)];
        if (uniq.length) failed += uniq.length;
        console.log(`  ${uniq.length ? 'FAIL' : 'PASS'}  ${route.padEnd(18)} ${uniq.length ? uniq.slice(0, 4).join(' | ') : 'all stops visible'}`);
    }
    await page.close();
}

await browser.close();
console.log(`\n${checked} tab stops checked`);
console.log(failed ? `tab order: ${failed} invisible stop(s)` : 'tab order: CLEAN');
process.exit(failed ? 1 : 0);
