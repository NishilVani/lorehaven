/* Drive the LoreHaven WebView on a USB-connected phone over the DevTools
 * protocol. Forwards the app's devtools socket to a local port, attaches
 * Playwright, and runs one action.
 *   node scripts/phone_cdp.mjs eval "<js expression>"
 *   node scripts/phone_cdp.mjs shot <out.png>
 *   node scripts/phone_cdp.mjs goto </path>
 *   node scripts/phone_cdp.mjs click "<css selector>"
 * Needs: adb on PATH, a debug build running (release WebViews are not
 * debuggable). PKG overrides the package (default com.lorehaven.games.debug). */
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const PKG = process.env.PKG || 'com.lorehaven.games.debug';
const PORT = Number(process.env.CDP_PORT || 9333);
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8' }).trim();

const pid = adb('shell', 'pidof', PKG).split(/\s+/)[0];
if (!pid) { console.error(`${PKG} is not running`); process.exit(2); }
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools')) ;
if (!page) { console.error('no page'); process.exit(3); }

const [cmd, arg] = process.argv.slice(2);
let out;
if (cmd === 'eval') out = await page.evaluate(arg);
else if (cmd === 'shot') { await page.screenshot({ path: arg }); out = arg; }
else if (cmd === 'goto') {
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, arg);
  await page.waitForTimeout(1500);
  out = await page.evaluate(() => location.pathname + location.search);
} else if (cmd === 'click') { await page.locator(arg).first().click(); await page.waitForTimeout(800); out = 'clicked'; }
else out = page.url();
console.log(typeof out === 'string' ? out : JSON.stringify(out));
await browser.close().catch(() => {});
