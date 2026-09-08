/**
 * WCAG 1.4.11 Non-text Contrast on form controls.
 *
 * A text input whose only boundary is a 1.39:1 hairline is not perceivable as a
 * control. This measures the REAL computed border colour against the real
 * background behind it — alpha composited, not read off the class name — and
 * fails anything under 3:1.
 *
 *   node scripts/verify_control_borders.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';
const MIN = 3.0;
const ROUTES = ['/', '/?search=true', '/library/backlog', '/collections', '/events',
    '/wallpapers', '/awards', '/platforms', '/keywords', '/import',
    '/game/1942'];   // a populated game detail page — see a11y_gate.mjs

const PROBE = () => {
    /* Tailwind v4 hands back oklab(...), so a naive rgb() regex reads the L/a/b
       channels as r/g/b and reports near-black for every border. Painting the
       colour and reading the pixel normalises whatever syntax the browser used. */
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.globalCompositeOperation = 'copy';
    const parse = (c) => {
        if (!c || c === 'transparent') return null;
        ctx.fillStyle = '#000';
        ctx.fillStyle = c;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
    };
    const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
    const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    /* Walk up for the first ancestor that actually paints a background. */
    const backdrop = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c[3] > 0.9) return c.slice(0, 3);
        }
        return [0, 0, 0];   // the app's page background
    };

    const out = [];
    for (const el of document.querySelectorAll('input, textarea, select')) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;           // visually hidden inputs
        const cs = getComputedStyle(el);
        const sides = ['Top', 'Right', 'Bottom', 'Left']
            .filter((s) => parseFloat(cs[`border${s}Width`]) > 0);
        if (!sides.length) continue;                         // borderless by design
        const bg = backdrop(el);
        for (const s of sides) {
            const c = parse(cs[`border${s}Color`]);
            if (!c || c[3] === 0) continue;
            const v = ratio(over(c, bg), bg);
            if (v < 3.0) {
                out.push({
                    name: (el.getAttribute('aria-label') || el.placeholder || el.name || el.type || 'input').slice(0, 34),
                    side: s.toLowerCase(),
                    color: cs[`border${s}Color`],
                    ratio: +v.toFixed(2),
                });
            }
        }
    }
    return out;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let failed = 0;
for (const route of ROUTES) {
    try { await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch { /* SPA keeps sockets open */ }
    await page.waitForTimeout(3000);
    const bad = await page.evaluate(PROBE);
    failed += bad.length;
    console.log(`  ${bad.length ? 'FAIL' : 'PASS'}  ${route.padEnd(18)} ${bad.length
        ? bad.map((b) => `${b.name}[${b.side}] ${b.ratio}:1`).join(' | ')
        : 'all control borders >= 3:1'}`);
}

await browser.close();
console.log(failed ? `\ncontrol borders: ${failed} under ${MIN}:1` : '\ncontrol borders: CLEAN');
process.exit(failed ? 1 : 0);
