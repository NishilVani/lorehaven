# LoreHaven

A personal game library: track what you own across every platform, browse an
awards corpus, and keep a profile of what you have played. Runs as a web app, a
desktop app, and an Android app from one React codebase.

- **Web** — https://moctalegames.web.app
- **Desktop** — Windows, macOS and Linux, via Tauri
- **Android** — via Tauri

## Stack

| Layer | Choice |
|---|---|
| UI | React 19, React Router 7, Tailwind CSS 4 |
| Build | Vite 8 |
| Native shell | Tauri 2 (Rust) |
| Data | Firebase Auth + Firestore |
| Game metadata | IGDB, through a Cloudflare Worker proxy |
| Tests | Playwright (e2e), Node test scripts (unit) |

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on http://localhost:5173.

No IGDB credential is needed on a developer machine. `.env.development` points
at the deployed Cloudflare Worker proxy, which holds the credential server-side.

### Desktop

```bash
npm run tauri dev
```

Building a desktop bundle needs a Rust toolchain (1.77.2 or newer) and the
platform prerequisites listed in the [Tauri
docs](https://v2.tauri.app/start/prerequisites/).

```bash
npm run tauri build
```

### Android

Needs the Android SDK, NDK, and a JDK. Set `ANDROID_HOME` and `NDK_HOME`, then:

```bash
npm run tauri android build
```

Release builds are signed with a keystore that is **not** in this repository.
See [docs/RELEASING.md](docs/RELEASING.md).

## Testing

```bash
npm test                  # unit tests: cache, profile stats, sorting, platform match, hero pick
npm run test:e2e          # Playwright, Chromium
npm run test:e2e:webkit   # sharded; WebKit wedges past ~37 contexts in one process
npm run test:e2e:ios      # judge by reported pass counts, not the exit code
npm run lint              # ESLint
npm run lint:a11y         # accessibility gate
```

`tests/phase7-mobile.spec.ts` is restricted by the CLI invocation, not by a
`test.skip`. Run it with `--project="Mobile Chrome"` or
`--project="Mobile Safari"`; under a desktop project its cases fail by design.

## Deploying

- **Web** deploys itself. Every push to `main` lints, tests, builds and ships to
  Firebase Hosting; every pull request gets a preview channel.
- **Desktop and Android** releases are cut by pushing a tag. One tag builds
  macOS, Linux, Windows and Android into a single GitHub Release.
- **Microsoft Store** submissions update automatically when a release is
  published, pointing at that release's installer.

Firestore rules are deployed by hand on purpose (`firebase deploy --only
firestore`) — a rules change is a security change.

The runbooks are [docs/RELEASING.md](docs/RELEASING.md) and
[docs/MICROSOFT-STORE.md](docs/MICROSOFT-STORE.md).

## Repository layout

```
src/            Application source
src-tauri/      Rust shell, native config, Android/desktop bundle setup
public/         Static assets
functions/      Cloudflare Worker IGDB proxy
scripts/        Build and quality-gate scripts
tests/          Playwright specs and Node unit tests
tokens/         Design tokens (DTCG)
components/     Component specs
accessibility/  WCAG checklists and ARIA patterns
design-systems/ Design-system reference
```

Design rules that contributors and agents must follow are in
[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md). Product intent is in
[PRODUCT.md](PRODUCT.md); the visual system is in [DESIGN.md](DESIGN.md).

## Contributing

Contributions are welcome. **A fresh clone needs no credentials** — the IGDB
credential lives server-side in a Cloudflare Worker, so `npm ci && npm run dev`
gives you real game data on a machine holding no secrets.

```bash
npm ci
npm run dev
```

Three gates run on every pull request and all must be green: `npm run lint`
(zero errors, not "no new errors"), `npm test`, and `npm run build`. Playwright
end-to-end tests also run but are advisory.

Two conventions that catch people:

- **No emoji anywhere** — code, comments, commit messages, UI copy or docs. Use
  a lucide icon or plain words.
- **Comments explain why, not what.** The code already says what it does.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It covers
how tests are written here (plain `node:assert` scripts, no framework), which
files ask for a review and why, and the one constant you should not touch.

Found a security problem? Do not open an issue — see [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE).
