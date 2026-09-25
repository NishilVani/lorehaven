// Which breaking generation this build belongs to, and the two comparisons
// that decide what to do about it.
//
// No imports on purpose. db.js stands up a Firestore client at import time and
// nothing in it can be unit-tested, so the logic that decides whether this
// build may sync lives here instead. tests/compat.test.mjs is the contract.

/* Incremented ONLY when a change makes older builds behave incorrectly -- in
   any layer, not just the database. Level 1 is every build before the
   per-item merge landed; those clients resurrect deleted games, never stamp
   their edits, and overwrite the whole library document, which is what cost
   seven games and 56 priorities on 2026-09-08.

   This is NOT the version number. Releases of fixes and features all stay at
   the same level and are all optional; only a genuine breaking change moves
   it. In this project's history it has moved once. */
export const COMPAT_LEVEL = 2;

/* Injected by vite.config.js from src-tauri/tauri.conf.json, which the release
   workflow already checks against the git tag. The typeof guard keeps this
   module importable under plain node, where the define does not exist -- which
   is how the tests run. */
export const APP_VERSION =
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/* Numeric semver compare, re-exported: it lives in version.js because the
   Android OTA bootstrap inlines that file into index.html, where nothing can
   be imported. One implementation for both, tested in compat.test.mjs. */
export { compareVersions } from './version.js';
import { compareVersions } from './version.js';

/**
 * What this build should do about the published config. PURE.
 *
 * `outdated` requires a real integer minimum: an absent, null, string or
 * fractional value means the config did not load or is malformed, and that
 * must resolve to "current". Failing closed would disable sync for everyone
 * the moment Firestore hiccups, and it buys nothing -- the rules are the hard
 * guarantee, so a genuinely incompatible client still cannot write.
 *
 * @param {{level: number, minLevel?: unknown, version?: string, latestVersion?: string}} args
 * @returns {{outdated: boolean, updateAvailable: boolean}}
 */
export const evaluateCompat = ({ level, minLevel, version, latestVersion }) => ({
    outdated: Number.isInteger(minLevel) && Number.isInteger(level) && level < minLevel,
    updateAvailable: !!latestVersion && compareVersions(version, latestVersion) < 0,
});
