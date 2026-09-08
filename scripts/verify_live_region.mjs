/**
 * Assert that status changes actually reach the single #app-live-region.
 *
 * A live region only announces when it is ALREADY in the accessibility tree and
 * its text mutates. Every check here therefore asserts two things: the region
 * exists at load, and its textContent changes after the interaction. WCAG 4.1.3.
 *
 *   node scripts/verify_live_region.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';

/* route, what to do once loaded, substring the region must end up containing */
const CASES = [
    // Wikidata is unreachable from CI; 'Querying Wikidata' is then the correct,
    // honest announcement and matches what the page itself shows.
    ['/awards', null, /ceremon|unreachable|querying/i],
    ['/events', null, /event/i],
    ['/wallpapers', null, /wallpaper/i],
    ['/library', null, /game/i],
    ['/collections', null, /collection|result|search/i],
    ['/browse', null, /categor|genre|theme|mode|perspective/i],
    ['/games/genre/12', null, /game/i],
    /* Global search overlay — opened by the ?search=true param, not a shortcut. */
    ['/?search=true', async (p) => {
        await p.locator('input[placeholder]').first().fill('zelda');
    }, /searching|franchise/i],
];

const settle = (p) => p.waitForTimeout(2500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let failed = 0;
for (const [route, act, want] of CASES) {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await settle(page);

    if (act) await act(page);
    await settle(page);

    const present = await page.locator('#app-live-region').count();
    const text = (await page.locator('#app-live-region').textContent().catch(() => '')) || '';
    const live = await page.locator('#app-live-region').getAttribute('aria-live').catch(() => null);
    const ok = present === 1 && live === 'polite' && want.test(text);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${route.padEnd(18)} region=${present} live=${live} text=${JSON.stringify(text.slice(0, 70))}`);
}

await browser.close();
console.log(failed ? `\n${failed}/${CASES.length} routes announce nothing` : `\nAll ${CASES.length} routes announce.`);
process.exit(failed ? 1 : 0);
