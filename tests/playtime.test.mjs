/* Imported play time: the shape the importers write and what the game page
   reads back out of it. Pure, no storage. Run: node tests/playtime.test.mjs */
import assert from 'node:assert';
import { withSteamPlay, withXboxPlay, playSummary, agoPhrase, hoursText } from '../src/services/playtime.js';

const NOW = 1800000000000;
const DAY = 86400000;

/* ── Writing ── */
assert.deepStrictEqual(
  withSteamPlay(undefined, { playtimeMinutes: 125.4, lastPlayed: 1700000000 }, NOW),
  { steam: { minutes: 125, lastPlayed: 1700000000000, at: NOW } },
  'Steam seconds become ms, minutes are whole',
);
assert.deepStrictEqual(
  withSteamPlay(null, { playtimeMinutes: 0, lastPlayed: 0 }, NOW).steam,
  { minutes: 0, lastPlayed: null, at: NOW },
  'owned and never played: zero minutes, no date -- not a missing record',
);
const xbox = { lastPlayed: 1690000000000, at: 1700000000000 };
assert.deepStrictEqual(withSteamPlay({ xbox }, { playtimeMinutes: 60, lastPlayed: null }, NOW).xbox, xbox, 'Steam never touches the Xbox half');

assert.deepStrictEqual(withXboxPlay(undefined, { lastPlayed: '2026-03-03T00:00:00Z' }, NOW),
  { xbox: { lastPlayed: Date.parse('2026-03-03T00:00:00Z'), at: NOW } });
assert.strictEqual(withXboxPlay(undefined, { lastPlayed: null }, NOW), null, 'nothing to say, nothing written');
assert.strictEqual(withXboxPlay(undefined, { lastPlayed: 'not a date' }, NOW), null, 'an unparseable date is dropped');
const steam = { minutes: 10, lastPlayed: null, at: 1 };
assert.deepStrictEqual(withXboxPlay({ steam }, { lastPlayed: '2026-01-01T00:00:00Z' }, NOW).steam, steam, 'Xbox never touches the Steam half');

/* ── Reading ── */
assert.strictEqual(playSummary({}), null);
assert.strictEqual(playSummary({ play: {} }), null);
assert.strictEqual(playSummary({ play: { epic: { minutes: 5 } } }), null, 'unknown sources are ignored');
assert.deepStrictEqual(
  playSummary({ play: { steam: { minutes: 600, lastPlayed: NOW - 10 * DAY, at: NOW - DAY }, xbox: { lastPlayed: NOW - 2 * DAY, at: NOW - 5 * DAY } } }),
  { minutes: 600, lastPlayed: NOW - 2 * DAY, lastSource: 'Xbox', minutesAt: NOW - DAY },
  'minutes are Steam\'s and dated by Steam\'s own import; the latest play wins across sources',
);
assert.strictEqual(playSummary({ play: { xbox } }).minutes, null, 'Xbox alone has no minutes, and says so as null rather than 0');

/* ── Phrasing ── */
assert.strictEqual(agoPhrase(null, NOW), null);
assert.strictEqual(agoPhrase(NOW - 3600000, NOW), 'today');
assert.strictEqual(agoPhrase(NOW - 1.5 * DAY, NOW), 'yesterday');
assert.strictEqual(agoPhrase(NOW - 3 * DAY, NOW), '3 days ago');
assert.strictEqual(agoPhrase(NOW - 40 * DAY, NOW), 'last month');
assert.strictEqual(agoPhrase(NOW - 200 * DAY, NOW), '7 months ago');
assert.strictEqual(agoPhrase(Date.UTC(2019, 5, 1), NOW), 'in 2019');

assert.strictEqual(hoursText(null), null);
assert.deepStrictEqual(hoursText(0), { value: '0', unit: 'h' });
assert.deepStrictEqual(hoursText(20), { value: '<1', unit: 'h' }, 'opened once is under an hour, not zero');
assert.deepStrictEqual(hoursText(90), { value: '1.5', unit: 'h' });
assert.deepStrictEqual(hoursText(120), { value: '2', unit: 'h' });
assert.deepStrictEqual(hoursText(5460), { value: '91', unit: 'h' });

console.log('playtime: all assertions passed');
