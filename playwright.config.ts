import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */

/* The route probe (tests/routes.spec.ts, 37 cases) runs on ONE desktop and ONE
   phone project, and the restriction lives here rather than as a skip inside the
   spec. Two reasons, and the second is not a preference:

   1. Every route in this app fans out to IGDB, which rate-limits at 4 req/s.
      37 routes x 5 projects reliably drew `Too Many Requests`.
   2. `test.skip()` in a `beforeEach` skips too LATE. The `page` fixture has
      already built a browser context by the time the hook runs, so a skipped
      test still launches and tears down a browser. Measured: with the skip in
      the spec, the full suite reported `111 skipped / 99 passed` and still hung
      its webkit worker for the full 300s teardown (7.6m, exit 1). `testIgnore`
      drops the file at COLLECTION time, so those contexts never exist.

   tests/smoke.spec.ts is unrestricted and still covers all five projects. */
const ROUTE_PROBE = /routes\.spec\.ts/;
export default defineConfig({
  testDir: './tests',
  /* Only Playwright specs. tests/ also holds plain `node` .test.mjs files run by
     npm run test:* — Playwright would try to execute them and fail. */
  testMatch: '**/*.spec.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* One, not "one per core", and not two.
     Two reasons, and the second is why this is 1 rather than 2:

     1. Every route here fans out to IGDB, which rate-limits at 4 requests/second.
        At the default 8 workers x 5 projects the dev server logged
        `IGDB Error (/api/games): Too Many Requests` and a different test failed on
        each run (firefox /browse, then Mobile Chrome /game/1942). A gate that fails
        somewhere random is not a gate.

     2. At workers: 2 the suite exited 1 on a 25/25 GREEN run. Isolated per project
        (qa/2026-09-05-deep/pw-*.log): chromium 8s, firefox 9s, webkit 7s, Mobile
        Chrome 7s all exit 0 — `Mobile Safari` alone exits 1 after 307s with
        `Error: worker-N process did not exit within 300000ms after stop,
        force-killed it`. Narrowed further: every one of its five tests passes alone
        in 2-5s, and Mobile Safari at --workers=1 passes in 11s, so it is the second
        webkit+iPhone-12 worker process that never exits on Windows, not any test.
        Playwright then blocks for the full teardown timeout and reports failure.

     Measured, smoke suite (25 tests): workers 2 -> exit 1, 336s.
                                       workers 1 -> exit 0, 58s.
     Serial is both correct and four times faster here.

     NOT SUFFICIENT ON ITS OWN. This setting fixes the concurrent-worker trigger
     only. The same webkit worker also wedges MID-RUN once one worker process has
     accumulated enough browser contexts: measured at 37 contexts on desktop
     webkit and about 5 on Mobile Safari (phase 12). The testIgnore above does
     not fix that; routes.spec.ts was simply the first file long enough to hit
     it. Playwright's own test timeout never fires when it happens, so any spec
     past ~37 cases silently caps its coverage on webkit. Run long specs sharded
     (scripts/e2e-shard.sh, the test:e2e:* scripts) and judge iOS shards by
     their reported pass counts, not their exit code. */
  workers: 1,
  /* `open: 'never'` — the default spawns a browser on failure, which hangs an
     unattended run forever. */
  reporter: [['list'], ['html', { open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: 'http://localhost:5173',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ROUTE_PROBE,
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ROUTE_PROBE,
    },

    /* Test against mobile viewports. A desktop pass proves nothing here: the
       library h1 is sr-only below lg and the nav rail is a different component. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testIgnore: ROUTE_PROBE,
    },
  ],

  /* Run the vite dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
