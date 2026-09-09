# Security

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting on
this repository: **Security -> Report a vulnerability**. That opens a channel
visible only to the maintainer.

Include what you found, how to reproduce it, and what an attacker gets. A
proof-of-concept is welcome; please do not test against other people's accounts.

This is a personal project maintained by one person, so there is no response-time
guarantee. Expect a reply within a week or so.

## What is worth reporting

The parts of this project where a mistake actually costs something:

- **Firestore rules** (`firestore.rules`). Every user's library, feedback and
  profile sit behind `lorehaven_users/{uid}`. A rule that lets one account read
  or write another's is the highest-severity bug this project can have.
- **The IGDB proxy** (`functions/proxy.js`). It holds the IGDB credential and
  authenticates every request it forwards. Its endpoint allowlist is what stops
  it being an open credential for the whole of IGDB; a way past that allowlist,
  or any path that returns the credential or a token to a caller, is a real
  finding.
- **The GitHub Actions workflows.** They have access to Android signing keys, a
  Windows code-signing certificate, and deploy credentials. A way to get a
  workflow to run attacker-controlled code with secrets in scope is a real
  finding.
- **The compatibility gate.** `compatLevel` in `firestore.rules` decides which
  clients may write. A way to satisfy it while writing data an older client
  would write is worth reporting.

## How publishing is gated

Two mechanisms, because they cover different routes:

- **A branch ruleset on `main`** requires a pull request, an approving review
  from a code owner, and a green `Lint, test, build` before anything merges.
- **A tag ruleset on `v*`** stops anyone creating, moving or deleting a release
  tag. Without it the release path went around the branch ruleset entirely: a
  tag is not a branch, so pushing `v9.9.9` would have built and signed a release
  with no review at all.
- **A `production` environment with a required reviewer** gates every job that
  holds a secret -- the desktop and Android builds that use the signing keys,
  the job that makes a release public, the Firestore write, the Store
  submission, and the workflow that arms the compatibility gate. Those jobs
  pause until a human approves the run, so neither a pushed tag nor a
  `workflow_dispatch` can publish anything on its own.

Repository admins are on the bypass list for both rulesets, so the maintainer is
not blocked; the environment approval applies to everyone including admins.

Deliberately **not** gated: the Firebase Hosting deploy. It runs on pushes to
`main`, and code only reaches `main` through the branch ruleset, so an approval
there would be a second approval for something already reviewed -- on every
commit. Its pull-request preview deploy is skipped for forks.

## Known and accepted

Stated openly so nobody spends time rediscovering them:

- **`config/igdb` in Firestore.** A world-readable document from before the proxy
  existed, holding a superseded IGDB credential pair. Nothing reads it. The rule
  exposing it has been removed; the document itself is scheduled for deletion.
  The pair it holds is not the one in use.
- **No automated test covers the Firestore rules.** The emulator needs a JDK the
  maintainer's machine does not have. Rules are verified by hand against the live
  project when they change, which tests what is actually deployed but will not
  catch a regression on its own. Recorded in `STATUS.md`.
- **The Cloudflare Worker's edge cache holds a Twitch access token.** Deliberate,
  and documented in `functions/proxy.js`: it is the short-lived access token
  rather than the client secret, keyed under an unroutable `.invalid` URL that no
  inbound request can produce. If you find a way to read it from outside the
  Worker, that is very much a finding.

## Not in scope

- Vulnerabilities in IGDB, Wikidata, Firebase or Cloudflare themselves. Report
  those to them.
- Anything requiring physical access to a user's unlocked device. Library data
  lives in `localStorage` by design.
- Missing hardening headers on the static site with no demonstrated impact.
