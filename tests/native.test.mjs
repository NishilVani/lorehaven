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
const { routeFromShortcut, routeFromWebLink } = await import('../src/services/native/links.js');
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
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/pick'), '/library?pick=1');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/pick?x=/profile'), '/library?pick=1', 'nothing from the link reaches the router');
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/profile'), null);
assert.strictEqual(routeFromShortcut('lorehaven://shortcut/toString'), null, 'not fooled by object prototype names');
assert.strictEqual(routeFromShortcut('lorehaven://auth/steam'), null);
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
assert.deepStrictEqual(getDeviceSettings(), { reminders: { enabled: false, when: 'day-of', shelves: ['Wishlist', 'Unreleased'] }, haptics: true });
setDeviceSettings({ reminders: { enabled: true, when: 'day-before' } });
assert.deepStrictEqual(getDeviceSettings().reminders, { enabled: true, when: 'day-before', shelves: ['Wishlist', 'Unreleased'] }, 'a partial patch keeps the rest');
localStorage.setItem('lorehaven_device_settings', JSON.stringify({ reminders: { enabled: 'yes', when: 'never', shelves: ['Hacked', 'Backlog'] }, haptics: 0 }));
assert.deepStrictEqual(getDeviceSettings(), { reminders: { enabled: false, when: 'day-of', shelves: ['Backlog'] }, haptics: true },
  'hand-edited storage is cleaned, not trusted');
assert.ok(!store.has('moctale_prefs'), 'nothing written to the synced prefs');

console.log('native: all assertions passed');
