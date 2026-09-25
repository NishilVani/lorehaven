/* getPrefs() rebuilds prefs from localStorage and keeps only fields it knows,
   so a flag written with setPrefs is only real if getPrefs reads it back.
   xboxImportAsked was written by XboxAuth.jsx and dropped here, which made the
   "import your Xbox games?" question come back on every sign-in. */
import assert from 'node:assert';
import './dom-shim.mjs';
const { getPrefs, setPrefs } = await import('../src/services/db.js');

setPrefs({ steamImportAsked: { steam_1: true } });
assert.deepStrictEqual(getPrefs().steamImportAsked, { steam_1: true }, 'Steam flag survives');

setPrefs({ xboxImportAsked: { xbox_2535: true } });
assert.deepStrictEqual(getPrefs().xboxImportAsked, { xbox_2535: true }, 'Xbox flag survives a getPrefs round trip');
assert.deepStrictEqual(getPrefs().steamImportAsked, { steam_1: true }, 'writing Xbox keeps Steam');

/* User-editable storage: only plain true flags are kept. */
localStorage.setItem('moctale_prefs', JSON.stringify({ xboxImportAsked: { a: true, b: 'yes', c: 1 } }));
assert.deepStrictEqual(getPrefs().xboxImportAsked, { a: true }, 'non-true values are dropped');
localStorage.setItem('moctale_prefs', '{not json');
assert.deepStrictEqual(getPrefs().xboxImportAsked, {}, 'corrupt storage falls back to empty');

console.log('prefs: all assertions passed');
process.exit(0);
