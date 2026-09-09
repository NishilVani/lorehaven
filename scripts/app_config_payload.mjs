// What CI is allowed to write into the Firestore document `config/app`.
//
// Two payload builders, deliberately separate, because the document holds two
// kinds of value with very different consequences:
//
//   latestVersion / latestNotes  advisory. Says a newer release exists. Nothing
//                                gates on it. Safe to write on every release.
//   minCompatLevel               THE GATE. A client below it stops syncing.
//
// Writing `minCompatLevel` when a release is cut would arm the gate the instant
// the tag landed -- before anyone had installed that release. The website
// auto-deploys from main so it would be fine, but every desktop and Android
// user would lose cloud sync until they got round to updating. That is the flag
// day the three-step rollout in docs/RELEASING.md exists to prevent.
//
// So the release path cannot express that field. It builds its object from
// named locals rather than spreading its input, which is why no amount of
// creative argument passing gets `minCompatLevel` into a release write.
// tests/app-config.test.mjs is the contract.
//
// No imports: pure, so the safety property is testable without a Firestore
// client or a service account. scripts/publish_app_config.mjs does the writing.

/* Same shape the release workflow already enforces against tauri.conf.json. */
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * The advisory half. PURE.
 * @param {{version: string, notes?: string, now?: number}} args
 * @returns {{latestVersion: string, latestNotes: string, updatedAt: number}}
 */
export const releasePayload = ({ version, notes, now = Date.now() } = {}) => {
    const clean = String(version ?? '').replace(/^v/, '');
    if (!SEMVER.test(clean)) {
        throw new Error(`Refusing to publish "${version}" as latestVersion: not a version.`);
    }
    /* Built from named locals, never spread from the argument. This is the
       line that makes the safety property structural. */
    return {
        latestVersion: clean,
        latestNotes: String(notes ?? ''),
        updatedAt: now,
    };
};

/**
 * The gate. PURE. Only ever reached from a workflow_dispatch a human pressed.
 * @param {{level: number, now?: number}} args
 * @returns {{minCompatLevel: number, updatedAt: number}}
 */
export const armPayload = ({ level, now = Date.now() } = {}) => {
    /* The Firestore rule tests `compatLevel is int`. A float or a string stored
       here would make the client's idea of who is gated disagree with the
       rule's, which is the worst possible way for this to be wrong. */
    if (!Number.isInteger(level) || level < 1) {
        throw new Error(`Refusing to set minCompatLevel to ${JSON.stringify(level)}: expected a positive integer level.`);
    }
    return { minCompatLevel: level, updatedAt: now };
};
