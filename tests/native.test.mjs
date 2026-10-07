/* The Android app's native features, pure parts: what the release-day reminder
   planner schedules, how a re-sync changes what is pending, which shortcut and
   web links open the app, and the device-only settings. Run:
   node tests/native.test.mjs */
import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { dispatchEvent: () => {} };

const { planReminders, diffReminders, DEFAULT_REMINDERS } = await import('../src/services/native/reminders.js');
const { routeFromShortcut, routeFromWebLink, routeFromAppGame, routeFromNotificationTap } = await import('../src/services/native/links.js');
const { buildWidgetData } = await import('../src/services/native/widgets.js');
const { parseSharedText, searchRoute } = await import('../src/services/native/shareIn.js');
const { planDigest, nextDigestAt, DIGEST_HOUR, DIGEST_ID } = await import('../src/services/native/libraryDigest.js');
const { routeForScan } = await import('../src/services/native/qr.js');
const { getDeviceSettings, setDeviceSettings, isAndroidApp } = await import('../src/services/native/device.js');

/* ── Planning reminders ── */
const NOW = new Date(2026, 9, 6, 12, 0, 0).getTime();          // 6 Oct 2026, noon local
const utcDay = (y, m, d) => Date.UTC(y, m, d) / 1000;          // how IGDB stores a release date
const lib = [
  { id: 1001, name: 'Soon Game', status: 'Wishlist', first_release_date: utcDay(2026, 9, 20) },
  { id: 1002, name: 'Waiting Game', status: 'Unreleased', first_release_date: utcDay(2026, 10, 2) },
  { id: 1003, name: 'Backlog Game', status: 'Backlog', first_release_date: utcDay(2026, 9, 25) },
  { id: 1004, name: 'Already Out', status: 'Wishlist', first_release_date: utcDay(2026, 8, 1) },
  { id: 1005, name: 'No Date', status: 'Wishlist' },
  { id: 'custom_1', name: 'Custom', status: 'Wishlist', first_release_date: utcDay(2026, 9, 30) },
  { id: 1006, name: 'Played It', status: 'Beaten', first_release_date: utcDay(2026, 9, 30) },
];

assert.deepStrictEqual(planReminders(lib, { ...DEFAULT_REMINDERS, enabled: false }, NOW), [], 'off schedules nothing');

const on = { enabled: true, when: 'day-of', shelves: ['Wishlist', 'Unreleased'] };
const plan = planReminders(lib, on, NOW);
assert.deepStrictEqual(plan.map(r => r.id), [1001, 1002], 'chosen shelves only, future dated releases only, nearest first; no custom ids');
assert.strictEqual(plan[0].title, 'Soon Game is out today');
assert.deepStrictEqual([plan[0].at.getFullYear(), plan[0].at.getMonth(), plan[0].at.getDate(), plan[0].at.getHours()], [2026, 9, 20, 10],
  'the release day in the phone\'s own calendar, at 10:00');
assert.strictEqual(plan[0].body, 'On your Wishlist shelf. Tap to open it.');

const eve = planReminders(lib, { ...on, when: 'day-before' }, NOW);
assert.deepStrictEqual([eve[0].at.getDate(), eve[0].at.getHours()], [19, 18], 'the evening before, at 18:00');
assert.strictEqual(eve[0].title, 'Soon Game is out tomorrow');

assert.deepStrictEqual(planReminders(lib, { ...on, shelves: ['Backlog'] }, NOW).map(r => r.id), [1003]);

const lateToday = new Date(2026, 9, 20, 11, 0, 0).getTime();
assert.deepStrictEqual(planReminders(lib, on, lateToday).map(r => r.id), [1002], 'a reminder whose time has passed is not scheduled');

const many = Array.from({ length: 80 }, (_, i) => ({ id: 2000 + i, name: `G${i}`, status: 'Wishlist', first_release_date: utcDay(2027, 0, 1 + i) }));
assert.strictEqual(planReminders(many, on, NOW).length, 60, 'capped well under Android\'s alarm limit');

/* ── Re-syncing ── */
const at = (r) => r.at.getTime();
assert.deepStrictEqual(diffReminders({}, plan), { cancel: [], add: plan }, 'first run: schedule everything');
const same = Object.fromEntries(plan.map(r => [String(r.id), at(r)]));
assert.deepStrictEqual(diffReminders(same, plan), { cancel: [], add: [] }, 'nothing changed: nothing scheduled or cancelled');
const moved = { ...same, 1001: at(plan[0]) - 86400000 };
assert.deepStrictEqual(diffReminders(moved, plan), { cancel: [1001], add: [plan[0]] }, 'a new release date reschedules');
const gone = { ...same, 9999: 123 };
assert.deepStrictEqual(diffReminders(gone, plan).cancel, [9999], 'a game off the shelf is cancelled');

/* ── Shortcuts: fixed screens only ── */
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/search'), '/?search=true');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/playing'), '/library/playing');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/library'), '/library');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/pick'), '/library/backlog?pick=1');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/pick?x=/profile'), '/library/backlog?pick=1', 'nothing from the link reaches the router');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/profile'), null);
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/toString'), null, 'not fooled by object prototype names');
assert.strictEqual(routeFromShortcut('lorehaven://auth/steam'), null);
assert.strictEqual(routeFromShortcut('LOREHAVEN://Shortcut/library'), '/library', 'scheme and host are case-insensitive');
assert.strictEqual(routeFromShortcut('evil://shortcut/library'), null);
{
  /* Android WebView 124 parses lorehaven://shortcut/x with an empty host and a
     pathname of "//shortcut/x". Routing must not depend on the engine's URL
     parser, so run both routers with that parser in place of node's. */
  const RealURL = globalThis.URL;
  globalThis.URL = class extends RealURL {
    get host() { return this.protocol === 'lorehaven:' ? '' : super.host; }
    get pathname() { return this.protocol === 'lorehaven:' ? `//${super.host}${super.pathname}` : super.pathname; }
  };
  try {
    const { routeFromAppLink } = await import('../src/services/appSignIn.js');
    assert.strictEqual(routeFromShortcut('lorehaven://shortcut/playing'), '/library/playing', 'old WebView: shortcut');
    assert.strictEqual(routeFromAppLink('lorehaven://auth/steam?openid.mode=id_res'), '/auth/steam?openid.mode=id_res', 'old WebView: sign-in return');
  } finally { globalThis.URL = RealURL; }
}
assert.strictEqual(routeFromShortcut('https://lorehaven.app/shortcut/search'), null);

/* ── App Links: read-only pages, numeric ids, our host ── */
assert.strictEqual(routeFromWebLink('https://lorehaven.app/game/1942'), '/game/1942');
assert.strictEqual(routeFromWebLink('https://lorehaven.app/game/1942/'), '/game/1942');
assert.strictEqual(routeFromWebLink('https://www.lorehaven.app/franchise/452'), '/franchise/452');
assert.strictEqual(routeFromWebLink('https://lorehaven.app/game/1942?x=1'), '/game/1942', 'the query is dropped');
assert.strictEqual(routeFromWebLink('https://lorehaven.app/profile'), null);
assert.strictEqual(routeFromWebLink('https://lorehaven.app/game/abc'), null);
assert.strictEqual(routeFromWebLink('https://evil.example/game/1942'), null);
assert.strictEqual(routeFromWebLink('http://lorehaven.app/game/1942'), null, 'https only');
assert.strictEqual(routeFromWebLink('https://lorehaven.app.evil.example/game/1'), null);

/* ── Device settings: defaults, sanitised, never synced ── */
assert.strictEqual(isAndroidApp(), false, 'not the Android app here');
assert.deepStrictEqual(getDeviceSettings(), { reminders: { enabled: false, when: 'day-of', shelves: ['Wishlist', 'Unreleased'] }, haptics: true, updates: false });
setDeviceSettings({ reminders: { enabled: true, when: 'day-before' } });
assert.deepStrictEqual(getDeviceSettings().reminders, { enabled: true, when: 'day-before', shelves: ['Wishlist', 'Unreleased'] }, 'a partial patch keeps the rest');
localStorage.setItem('lorehaven_device_settings', JSON.stringify({ reminders: { enabled: 'yes', when: 'never', shelves: ['Hacked', 'Backlog'] }, haptics: 0 }));
assert.deepStrictEqual(getDeviceSettings(), { reminders: { enabled: false, when: 'day-of', shelves: ['Backlog'] }, haptics: true, updates: false },
  'hand-edited storage is cleaned, not trusted');
assert.ok(!store.has('moctale_prefs'), 'nothing written to the synced prefs');

/* ── Widget links: lorehaven://game/<id> and the headers' shortcuts ── */
assert.strictEqual(routeFromAppGame('lorehaven://game/1942'), '/game/1942');
assert.strictEqual(routeFromAppGame('lorehaven://game/1942/'), '/game/1942');
assert.strictEqual(routeFromAppGame('lorehaven://game/0'), null);
assert.strictEqual(routeFromAppGame('lorehaven://game/1942?x=/profile'), null, 'no query reaches the router');
assert.strictEqual(routeFromAppGame('lorehaven://game/../profile'), null);
assert.strictEqual(routeFromAppGame('lorehaven://shortcut/1942'), null);
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/backlog'), '/library/backlog');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/schedule'), '/schedule');

/* ── Widget snapshot ── */
{
  const NOW = Date.UTC(2026, 9, 6, 12);
  const day = (n) => Math.floor(Date.UTC(2026, 9, 6 + n) / 1000);
  const lib = [
    { id: 1, name: 'Old Play', status: 'Playing', cover_id: 'co1', notes: '\n  Chapter 3, by the lighthouse\nmore', play: { steam: { lastPlayed: NOW - 40 * 86400000 } } },
    { id: 2, name: 'Fresh Play', status: 'Playing', cover_id: 'co2', play: { xbox: { lastPlayed: NOW - 86400000 } } },
    { id: 3, name: 'No Note', status: 'Playing' },
    { id: 4, name: 'Fourth', status: 'Playing' },
    { id: 5, name: 'Queued', status: 'Backlog', priority: 'Next Up', cover_id: 'BAD/../x' },
    { id: 6, name: 'Someday', status: 'Backlog', priority: 'Someday' },
    { id: 7, name: 'Later', status: 'Wishlist', first_release_date: day(30) },
    { id: 8, name: 'Today', status: 'Unreleased', first_release_date: day(0) },
    { id: 9, name: 'Past', status: 'Wishlist', first_release_date: day(-2) },
    { id: 10, name: 'Custom', status: 'Playing', is_custom: true },
    { id: 'x', name: 'Bad id', status: 'Playing' },
  ];
  const w = buildWidgetData(lib, NOW);
  assert.deepStrictEqual(w.playing.map(r => r.id), [2, 1, 3], 'most recently played first, three rows, custom and bad ids dropped');
  assert.strictEqual(w.playing[1].line, 'Chapter 3, by the lighthouse', 'the first line of the note');
  assert.strictEqual(w.playing[0].line, 'Last played yesterday');
  assert.strictEqual(w.playing[2].line, '');
  assert.deepStrictEqual(w.upNext.map(r => r.id), [5]);
  assert.strictEqual(w.upNext[0].cover, null, 'a cover id that is not IGDB-shaped is not sent');
  assert.deepStrictEqual(w.soon.map(r => [r.id, r.release]), [[8, day(0)], [7, day(30)]], 'today counts, the past does not, soonest first');
  assert.deepStrictEqual(buildWidgetData(null), { playing: [], upNext: [], soon: [] });
  const long = buildWidgetData([{ id: 1, name: 'A', status: 'Playing', notes: 'x'.repeat(200) }]).playing[0].line;
  assert.ok(long.length <= 80 && long.endsWith('...'));
}

/* ── Share into the app ── */
assert.deepStrictEqual(parseSharedText('https://lorehaven.app/game/1942'), { kind: 'route', route: '/game/1942' });
assert.deepStrictEqual(parseSharedText('Check this out https://store.steampowered.com/app/1145350/Hades_II/'),
  { kind: 'steam', appid: '1145350', query: 'Hades II' }, 'the store slug beats the words around it');
assert.deepStrictEqual(parseSharedText('Look at this https://store.epicgames.com/en-US/p/hades-ii'),
  { kind: 'search', query: 'hades ii' }, 'found on the emulator: the comment used to win');
assert.deepStrictEqual(parseSharedText('https://store.steampowered.com/app/1145350/Hades_II/'),
  { kind: 'steam', appid: '1145350', query: 'Hades II' }, 'a bare Steam link falls back to its slug');
assert.deepStrictEqual(parseSharedText('Save 20% on Hades II on Steam https://store.steampowered.com/app/1145350'),
  { kind: 'steam', appid: '1145350', query: 'Hades II' }, 'store noise is dropped');
assert.deepStrictEqual(parseSharedText('https://store.epicgames.com/en-US/p/hades-ii'), { kind: 'search', query: 'hades ii' });
assert.deepStrictEqual(parseSharedText('https://www.gog.com/en/game/the_witcher_3_wild_hunt'), { kind: 'search', query: 'the witcher 3 wild hunt' });
assert.deepStrictEqual(parseSharedText('https://www.xbox.com/en-US/games/store/starfield/9NCJSXWZTP88'), { kind: 'search', query: 'starfield' }, 'product ids are skipped');
assert.deepStrictEqual(parseSharedText('Elden Ring™'), { kind: 'search', query: 'Elden Ring' });
assert.strictEqual(parseSharedText('   '), null);
assert.strictEqual(parseSharedText('https://example.com/'), null, 'a link with nothing to search for');
assert.strictEqual(searchRoute('a&b c'), '/?search=true&q=a%26b%20c');

/* ── QR codes ── */
assert.deepStrictEqual(routeForScan('https://lorehaven.app/franchise/7'), { route: '/franchise/7' });
assert.deepStrictEqual(routeForScan('https://store.steampowered.com/app/620/Portal_2/'), { steam: '620', query: 'Portal 2' });
assert.deepStrictEqual(routeForScan('https://store.epicgames.com/p/hades-ii'), { route: '/?search=true&q=hades%20ii' });
assert.strictEqual(routeForScan('WIFI:S:home;T:WPA;P:secret;;'), null, 'not every code is about a game');

/* ── Library update digest ── */
{
  const ev = (gameId, gameName, detail, at) => ({ id: `${gameId}-${at}`, gameId, gameName, detail, at, type: 'date' });
  assert.strictEqual(planDigest([], 0), null);
  assert.strictEqual(planDigest([ev(1, 'A', 'New trailer', 100)], 100), null, 'already seen');
  const one = planDigest([ev(1, 'Hades II', 'Now released', 200), ev(1, 'Hades II', 'New trailer', 150)], 100);
  assert.deepStrictEqual([one.title, one.games, one.newestAt], ['Hades II: Now released', 1, 200], 'one game, its newest change');
  const many = planDigest([ev(1, 'A', 'x', 101), ev(2, 'B', 'y', 102), ev(3, 'C', 'z', 103), ev(4, 'D', 'w', 104), ev(5, 'E', 'v', 105)], 100);
  assert.strictEqual(many.title, '5 games in your library changed');
  assert.strictEqual(many.body, 'E: v. D: w. C: z. And 2 more.');
  const local = new Date(2026, 9, 6, 9, 30).getTime();
  assert.strictEqual(new Date(nextDigestAt(local)).getHours(), DIGEST_HOUR);
  assert.strictEqual(new Date(nextDigestAt(local)).getDate(), 6, 'later today');
  assert.strictEqual(new Date(nextDigestAt(new Date(2026, 9, 6, 18, 0, 30).getTime())).getDate(), 7, 'too close: tomorrow');
}

console.log('native: all assertions passed');

/* A tapped notification: the id is all Android hands back. */
assert.strictEqual(routeFromNotificationTap(1942), '/game/1942', 'a release reminder opens its game');
assert.strictEqual(routeFromNotificationTap(DIGEST_ID), '/explore/updates', 'the digest opens In Your Library');
assert.strictEqual(routeFromNotificationTap(null), null);
assert.strictEqual(routeFromNotificationTap(0), null);
assert.strictEqual(routeFromNotificationTap(-5), null);
assert.strictEqual(routeFromNotificationTap('1942; drop'), null, 'nothing but a number reaches the router');
console.log('notification taps: ok');
