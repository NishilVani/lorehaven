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
