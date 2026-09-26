/* The notification center: what each update records, and how updates become
 * notifications. src/services/discover.js and src/services/notifications.js. */
import assert from 'node:assert';
import './dom-shim.mjs';
const { diffSnapshots, addedMedia, mergeGameEvents } = await import('../src/services/discover.js');
const { toNotifications, groupByDay, hasDetail, unreadCount } = await import('../src/services/notifications.js');
const { timeAgo } = await import('../src/pages/notifications/timeAgo.js');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`  ok    ${name}`); }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

const now = 1_800_000_000;
const snap = (over = {}) => ({
  _snap_at: now - 100, videos: 1, screens: 2, art: 0, release: now + 90 * 86400, rating: null,
  videoIds: [11], screenIds: [21, 22], artIds: [], ...over,
});

test('a new trailer carries the video itself, not only a count', () => {
  const ev = diffSnapshots(snap(), snap({ videos: 2, videoIds: [11, 12] }), now, {
    videos: [{ id: 11, video_id: 'old', name: 'Reveal' }, { id: 12, video_id: 'abc123', name: 'Gameplay Trailer' }],
  });
  assert.deepStrictEqual(ev, [{ type: 'video', detail: 'New trailer', items: [{ id: 12, video_id: 'abc123', name: 'Gameplay Trailer' }] }]);
});

test('new screenshots and artwork carry their image ids', () => {
  const ev = diffSnapshots(snap(), snap({ screens: 3, screenIds: [21, 22, 23], art: 1, artIds: [31] }), now, {
    screenshots: [{ id: 21, image_id: 'a' }, { id: 22, image_id: 'b' }, { id: 23, image_id: 'c' }],
    artworks: [{ id: 31, image_id: 'z' }],
  });
  assert.deepStrictEqual(ev.find(e => e.type === 'screens').items, [{ id: 23, image_id: 'c' }]);
  assert.deepStrictEqual(ev.find(e => e.type === 'art').items, [{ id: 31, image_id: 'z' }]);
});

test('a swapped screenshot (same count, new id) is not news', () => {
  const ev = diffSnapshots(snap(), snap({ screenIds: [21, 99] }), now, { screenshots: [{ id: 21 }, { id: 99, image_id: 'x' }] });
  assert.deepStrictEqual(ev, []);
});

test('a snapshot from before ids were kept still reports the count, without items', () => {
  const old = snap();
  delete old.videoIds;
  const ev = diffSnapshots(old, snap({ videos: 3, videoIds: [11, 12, 13] }), now, { videos: [{ id: 12 }, { id: 13 }] });
  assert.strictEqual(ev[0].detail, '2 new videos');
  assert.strictEqual(ev[0].items, undefined);
  assert.strictEqual(addedMedia(undefined, [{ id: 1 }], 'image'), null);
});

test('a moved date and a changed score record where they were and where they are', () => {
  const later = now + 200 * 86400;
  const ev = diffSnapshots(snap({ rating: 80 }), snap({ release: later, rating: 84 }), now);
  assert.deepStrictEqual(ev.find(e => e.type === 'date').change, { from: now + 90 * 86400, to: later });
  assert.deepStrictEqual(ev.find(e => e.type === 'rating').change, { from: 80, to: 84 });
  assert.deepStrictEqual(diffSnapshots(snap(), snap({ rating: 71 }), now)[0].change, { from: null, to: 71 });
});

test('two date moves merge into one, from the first to the latest', () => {
  const merged = mergeGameEvents([
    { type: 'date', at: 1, change: { from: 100, to: 200 }, detail: 'a' },
    { type: 'date', at: 2, change: { from: 200, to: 300 }, detail: 'b' },
  ]);
  assert.deepStrictEqual(merged[0].change, { from: 100, to: 300 });
  assert.strictEqual(merged[0].detail, 'b');
});

test('media from several passes merge, newest first, once each', () => {
  const merged = mergeGameEvents([
    { type: 'screens', at: 1, items: [{ id: 1 }, { id: 2 }] },
    { type: 'screens', at: 5, items: [{ id: 3 }, { id: 2 }] },
  ]);
  assert.deepStrictEqual(merged[0].items.map(i => i.id), [3, 2, 1]);
  assert.strictEqual(merged[0].at, 5);
});

const events = [
  { gameId: 1, gameName: 'One', cover: 'c1', type: 'released', detail: 'Now released', at: 3000 },
  { gameId: 2, gameName: 'Two', cover: 'c2', type: 'video', detail: 'New trailer', at: 2000 },
  { gameId: 2, gameName: 'Two', cover: 'c2', type: 'date', detail: 'moved', at: 1000 },
  { gameId: 9, gameName: 'Gone', type: 'rating', detail: 'x', at: 5000 },
];
const library = [{ id: 1 }, { id: 2 }];

test('one notification per library game, newest first; games that left the library drop out', () => {
  const list = toNotifications(events, library, 0);
  assert.deepStrictEqual(list.map(n => n.gameId), [1, 2]);
  assert.strictEqual(list[1].events.length, 2);
  assert.strictEqual(list[1].at, 2000);
  assert.strictEqual(list[1].label, 'Date Moved', 'the most significant change leads');
});

test('unread is anything newer than the last visit', () => {
  const list = toNotifications(events, library, 2500);
  assert.deepStrictEqual(list.map(n => n.unread), [true, false]);
  assert.strictEqual(unreadCount(list), 1);
});

test('a released-only notification opens the game; anything else has its own page', () => {
  const [one, two] = toNotifications(events, library, 0);
  assert.strictEqual(hasDetail(one), false);
  assert.strictEqual(hasDetail(two), true);
});

test('day groups: Today, Yesterday, This Week, Earlier, and empty ones are left out', () => {
  const t = new Date(2026, 8, 26, 15, 0).getTime();
  const D = 86400000;
  const g = groupByDay([{ at: t - 1000 }, { at: t - D }, { at: t - 4 * D }, { at: t - 40 * D }], t);
  assert.deepStrictEqual(g.map(x => x.label), ['Today', 'Yesterday', 'This Week', 'Earlier']);
  assert.deepStrictEqual(groupByDay([{ at: t }], t).map(x => x.label), ['Today']);
});

test('timeAgo', () => {
  const t = Date.UTC(2026, 8, 26, 12);
  assert.strictEqual(timeAgo(t - 10_000, t), 'Just now');
  assert.strictEqual(timeAgo(t - 5 * 60_000, t), '5m ago');
  assert.strictEqual(timeAgo(t - 3 * 3600_000, t), '3h ago');
  assert.strictEqual(timeAgo(t - 2 * 86400_000, t), '2d ago');
  assert.match(timeAgo(t - 30 * 86400_000, t), /^[A-Z][a-z]{2} \d+$/);
});

console.log(process.exitCode ? 'notifications: FAILED' : `notifications: ${passed} passed`);
process.exit(process.exitCode || 0);
