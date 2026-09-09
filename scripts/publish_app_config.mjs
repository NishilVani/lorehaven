// Writes the Firestore document `config/app` from CI.
//
//   node scripts/publish_app_config.mjs release --version v0.2.0 [--notes "..."]
//   node scripts/publish_app_config.mjs arm --level 2
//
// Credentials come from GOOGLE_APPLICATION_CREDENTIALS_JSON, the service
// account JSON as a single environment variable. The Admin SDK authenticates
// through IAM and therefore bypasses security rules -- which is the point:
// `config/app` is `allow write: if false` for every client, so a privileged
// identity is the only thing that can ever change it.
//
// The two subcommands exist for the reason spelled out in
// scripts/app_config_payload.mjs: `release` can never touch minCompatLevel, and
// `arm` can never touch anything else. Both write with merge, so neither
// disturbs the other's fields.

import { readFileSync } from 'node:fs';
import { releasePayload, armPayload } from './app_config_payload.mjs';

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
};

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!credsJson) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set. See docs/RELEASING.md.');
    process.exit(1);
}

let payload;
try {
    if (mode === 'release') {
        payload = releasePayload({ version: flag('version'), notes: flag('notes') });
    } else if (mode === 'arm') {
        /* Number() rather than parseInt: parseInt('2.5') is 2, which would
           silently arm the gate at a level nobody asked for. The raw text is
           kept for the error, because Number('abc') is NaN and NaN stringifies
           to null -- "refusing to set it to null" tells you nothing about what
           you actually typed. */
        const raw = flag('level');
        try {
            payload = armPayload({ level: Number(raw) });
        } catch {
            throw new Error(`Refusing to set minCompatLevel to ${JSON.stringify(raw)}: expected a positive integer level.`);
        }
    } else {
        console.error(`Unknown mode "${mode ?? ''}". Expected "release" or "arm".`);
        process.exit(1);
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}

/* Imported after the argument check so a malformed invocation fails in
   milliseconds rather than after the SDK has connected. */
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

let creds;
try {
    creds = JSON.parse(credsJson);
} catch {
    /* Never echo the value: it is a private key. */
    console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON.');
    process.exit(1);
}

initializeApp({ credential: cert(creds), projectId: creds.project_id });
const db = getFirestore();
const ref = db.doc('config/app');

const before = await ref.get();
await ref.set({ ...payload, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
const after = (await ref.get()).data();

/* Print what the document now says, so the Actions log is the audit trail. A
   release run should show minCompatLevel unchanged from `before`; if it ever
   does not, this script has a bug and the log is where you would see it. */
const summary = (d) => JSON.stringify({
    minCompatLevel: d?.minCompatLevel ?? null,
    latestVersion: d?.latestVersion ?? null,
});
console.log(`mode:   ${mode}`);
console.log(`before: ${summary(before.exists ? before.data() : null)}`);
console.log(`after:  ${summary(after)}`);

if (mode === 'release') {
    const was = before.exists ? (before.data()?.minCompatLevel ?? null) : null;
    const now = after?.minCompatLevel ?? null;
    if (was !== now) {
        console.error(`A release write changed minCompatLevel from ${was} to ${now}. That must never happen.`);
        process.exit(1);
    }
    console.log('ok      minCompatLevel untouched by the release write');
}
