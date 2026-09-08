/**
 * Pick Next — "which of my own games should I start?"
 *
 * Three things this got wrong in the field, all invisible to a build:
 *
 *   1. It suggested from Backlog and Playing only. Someone holding 110 Wishlist,
 *      9 Backlog and 4 Dropped was told "that is all 11 of them" — 9 Backlog
 *      plus 2 Playing — with 123 games sitting in shelves it never looked at.
 *   2. It read the name off the library entry, which is not guaranteed to carry
 *      one: the Library page hydrates names from IGDB at render and never writes
 *      them back. The dialog rendered a card with a status, two reasons and a
 *      blank title.
 *   3. It dead-ended. Once every game had been offered, Pick Another stopped.
 *
 * Seeded entirely with custom games so no IGDB request is made and the result is
 * deterministic.
 *
 *   node scripts/verify_picknext.mjs [baseUrl]
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:5173';

const mk = (n, status, prefix, opts = {}) => Array.from({ length: n }, (_, i) => ({
  id: `custom_${prefix}${i}`,
  ...(opts.nameless ? {} : { name: `${prefix} ${i}` }),
  status,
  is_custom: true,
}));

/* The user's shape, plus every shelf that must never be offered and two entries
   with no name on disk. */
const SEED = [
  ...mk(9, 'Backlog', 'BACK'),
  ...mk(12, 'Wishlist', 'WISH'),
  ...mk(4, 'Dropped', 'DROP'),
  ...mk(3, 'Playing', 'PLAY'),
  ...mk(3, 'Beaten', 'BEAT'),
  ...mk(2, 'Unreleased', 'UNREL'),
  // Legacy strings an import writes; they normalise to Beaten and Unreleased.
  ...mk(1, 'Completed', 'LEGACYDONE'),
  ...mk(1, 'Interested', 'LEGACYINT'),
  // On disk with no name at all — must never be offered as a blank card.
  ...mk(2, 'Backlog', 'NONAME', { nameless: true }),
];
const SUGGESTABLE = 9 + 12 + 4;
const FORBIDDEN = /^(PLAY|BEAT|UNREL|LEGACYDONE|LEGACYINT) /;

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
const page = await ctx.newPage();
/* The diagnostics exist so a blank poster can be told apart from a missing one.
   Custom games can have neither a stored cover nor a profile to rescue one, so
   this seed is exactly the case the warning is for. */
const logs = [];
page.on('console', m => { if (/\[picknext\]/.test(m.text())) logs.push({ type: m.type(), text: m.text() }); });
await page.addInitScript((g) => localStorage.setItem('moctale_library', JSON.stringify(g)), SEED);
await page.goto(`${BASE}/library/backlog`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Pick a game to play next' }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Pick a game to play next' }).click();

const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 10000 });

const shown = async () => {
  await page.waitForFunction(() => {
    const d = document.querySelector('[role="dialog"]');
    return d && !d.querySelector('[class*="animate-"]');
  }, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const title = d.querySelector('[data-pick-name]') || d.querySelector('.lh-display.text-lg');
    const status = d.querySelector('.lh-label.text-white\\/60:not(:first-child)');
    return {
      name: title ? title.textContent.trim() : null,
      status: status ? status.textContent.trim() : null,
      body: d.innerText,
    };
  });
};

/* Ask for far more than the pool holds. Every answer must be a real game from a
   suggestable shelf, and the run must never end in the empty state. */
const seen = [];
let blanks = 0, forbidden = 0, deadEnded = false;
for (let i = 0; i < SUGGESTABLE + 8; i++) {
  const s = await shown();
  if (/Nothing on your/.test(s.body)) { deadEnded = true; break; }
  if (!s.name) blanks++;
  else {
    seen.push(s.name);
    if (FORBIDDEN.test(s.name)) forbidden++;
  }
  const another = dialog.getByRole('button', { name: 'Pick Another' });
  if (await another.isDisabled()) { deadEnded = true; break; }
  await another.click();
}

check('it never offers a game with no name', blanks === 0, `${blanks} blank card(s)`);
check('it never offers Playing, Beaten or Unreleased',
  forbidden === 0, `${forbidden} forbidden of ${seen.length} draws`);
check('legacy statuses normalise before the shelf test — no Completed or Interested',
  !seen.some(n => /^LEGACY/.test(n)));
check('Pick Another never dead-ends', !deadEnded, `${seen.length} draws without stopping`);
check('it draws from Backlog, Wishlist AND Dropped',
  ['BACK', 'WISH', 'DROP'].every(p => seen.some(n => n.startsWith(p + ' '))),
  [...new Set(seen.map(n => n.split(' ')[0]))].sort().join(' '));
check('it reaches well past the old Backlog-and-Playing pool',
  new Set(seen).size > 11, `${new Set(seen).size} distinct games offered`);

check('it reports how the pool resolved, once per draw',
  logs.filter(l => /\[picknext\] pool/.test(l.text)).length >= seen.length,
  `${logs.filter(l => /pool/.test(l.text)).length} pool lines for ${seen.length} draws`);
check('it names the games that have no cover from any source',
  logs.some(l => l.type === 'warning' && /no cover from entry OR profile/.test(l.text)));

/* The one empty state left: nothing on any suggestable shelf. Games on Playing
   and Beaten do not rescue it — they are exactly what must not be offered. */
{
  const c2 = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const p2 = await c2.newPage();
  await p2.addInitScript((g) => localStorage.setItem('moctale_library', JSON.stringify(g)),
    [...mk(3, 'Playing', 'PLAY'), ...mk(2, 'Beaten', 'BEAT')]);
  await p2.goto(`${BASE}/library/playing`, { waitUntil: 'domcontentloaded' });
  await p2.getByRole('button', { name: 'Pick a game to play next' }).click({ timeout: 15000 });
  await p2.getByRole('dialog').waitFor({ timeout: 10000 });
  await p2.waitForTimeout(600);
  const body = await p2.getByRole('dialog').innerText();
  check('with nothing suggestable it says so, and names the right shelves',
    /Nothing on your Backlog, Wishlist or Dropped/.test(body));
  check('and Pick Another is disabled rather than dead-ending silently',
    await p2.getByRole('button', { name: 'Pick Another' }).isDisabled());
  await c2.close();
}

await browser.close();
console.log(fails.length ? `\npick-next gate: ${fails.length} FAILURE(S)` : '\npick-next gate: CLEAN');
process.exit(fails.length ? 1 : 0);
