/**
 * Signing in with Xbox, and importing what an Xbox account has played.
 *
 * Microsoft, the Worker's /auth/xbox routes, IGDB and Firebase's own sign-in
 * endpoints all answer from the stubs below, so nothing here reaches Microsoft,
 * Xbox, Google or Firestore, and no key of any kind is needed.
 */
import { test, expect, type Page } from '@playwright/test';
import { seed, KEYS } from './fixtures';

const XUID = '2533274800000001';
const UID = 'xbox_abc123';
const NONCE = 'a-nonce-this-device-kept';
const VERIFIER = 'a-verifier-this-device-kept';

/* A Firebase ID token is only ever decoded on the client, never verified there,
   so a well-formed unsigned one is enough to stand in for the real thing. */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: Record<string, unknown> = {}) => [
  b64({ alg: 'none', typ: 'JWT' }),
  b64({
    iss: 'https://securetoken.google.com/moctalegames',
    aud: 'moctalegames',
    sub: UID,
    user_id: UID,
    auth_time: Math.floor(Date.now() / 1000),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  }),
  'signature',
].join('.');

/* The state the app packs into the address it sends Microsoft, and reads back. */
const packState = (state: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(state)).toString('base64url');

const returned = (state: Record<string, unknown>, code = 'a-code') =>
  `code=${code}&state=${packState({ nonce: NONCE, purpose: 'signin', from: '/', ...state })}`;

type Title = {
  titleId: string; name: string; productIds: string[];
  platform: string | null; lastPlayed: string | null; image: string | null;
};

const title = (over: Partial<Title> = {}): Title => ({
  titleId: '1',
  name: 'Clair Obscur: Expedition 33',
  productIds: ['9PBLMX0KDKQS'],
  platform: 'Xbox Series X|S',
  lastPlayed: '2026-08-02T19:04:00Z',
  image: null,
  ...over,
});

type Stub = { authCalls: string[]; linked: boolean; titles: Title[]; igdbByUid: Record<string, unknown>; search: unknown[] };

async function stub(page: Page, { linked = false, titles = [title()], igdbByUid = {}, search = [] } = {}) {
  const state: Stub = { authCalls: [], linked, titles, igdbByUid, search };
  const json = (r: Parameters<Parameters<Page['route']>[1]>[0], status: number, body: unknown) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  /* Everything Google, refused first; the sign-in endpoints below are
     registered after it and so are matched first. */
  await page.route(/googleapis\.com|firebaseio\.com/, r => r.abort());
  await page.route(/images\.igdb\.com/, r => r.abort());
  await page.route('**/wdqs/**', r => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ results: { bindings: [] } }),
  }));

  /* IGDB, as the proxy answers it: external_games for the Store-id match, games
     for the search by name. */
  await page.route('**/api/**', (r) => {
    const url = r.request().url();
    const body = r.request().postData() || '';
    if (url.includes('external_games')) {
      const rows = Object.entries(state.igdbByUid).map(([uid, game]) => ({ uid, game }));
      return json(r, 200, rows.filter(row => body.includes(`"${row.uid}"`)));
    }
    if (url.includes('/api/games')) return json(r, 200, state.search);
    return json(r, 200, []);
  });

  await page.route(/identitytoolkit\.googleapis\.com/, (r) => {
    const url = r.request().url();
    if (url.includes('signInWithCustomToken')) {
      return json(r, 200, { idToken: idToken(), refreshToken: 'refresh', expiresIn: '3600', localId: UID });
    }
    if (url.includes('accounts:lookup')) {
      return json(r, 200, { users: [{ localId: UID, email: null, providerUserInfo: [], validSince: '0', lastLoginAt: `${Date.now()}`, createdAt: `${Date.now()}` }] });
    }
    return json(r, 200, {});
  });
  await page.route(/securetoken\.googleapis\.com/, r => json(r, 200, {
    id_token: idToken(), access_token: idToken(), refresh_token: 'refresh', expires_in: '3600', user_id: UID, project_id: 'moctalegames',
  }));

  /* The Worker's endpoints only. A wider pattern also catches the browser's own
     navigation to /auth/xbox and answers the page itself with JSON. */
  await page.route('**/auth/xbox/*', (r) => {
    const action = new URL(r.request().url()).pathname.replace(/^\/auth\//, '');
    state.authCalls.push(action);
    if (action === 'xbox/start') return json(r, 200, { url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=test' });
    if (action === 'xbox/signin') {
      return state.linked
        ? json(r, 200, { status: 'signed-in', xuid: XUID, token: 'custom-token' })
        : json(r, 200, { status: 'unlinked', xuid: XUID, gamertag: 'LoreHavenOwner', ticket: 'a-ticket' });
    }
    if (action === 'xbox/create') return json(r, 200, { uid: UID, xuid: XUID, gamertag: 'LoreHavenOwner', token: 'custom-token' });
    if (action === 'xbox/link') return json(r, 200, { xuid: XUID, gamertag: 'LoreHavenOwner', xuids: [XUID] });
    if (action === 'xbox/accounts') return json(r, 200, { accounts: [] });
    if (action === 'xbox/library') return json(r, 200, { xuid: XUID, gamertag: 'LoreHavenOwner', titles: state.titles });
    return json(r, 404, { error: 'unknown auth route' });
  });
  return state;
}

/* What the device kept when it started the sign-in. Without both of these the
   page refuses the return, which is the point of them. */
const keepSecrets = (page: Page, { nonce = NONCE, verifier = VERIFIER } = {}) =>
  page.addInitScript(([n, v]) => {
    localStorage.setItem('lorehaven_xbox_state', JSON.stringify({ nonce: n, at: Date.now() }));
    localStorage.setItem('lorehaven_xbox_verifier', JSON.stringify({ verifier: v, at: Date.now() }));
  }, [nonce, verifier]);

const prefs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('moctale_prefs') || '{}'));
const library = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('moctale_library') || '[]'));

test.describe('/auth/xbox', () => {
  test('an unlinked Xbox account offers both roads, and a new account lands on the import question', async ({ page }) => {
    const state = await stub(page);
    await seed(page, { [KEYS.library]: [] });
    await keepSecrets(page);
    await page.goto(`/auth/xbox?${returned({ from: '/library/backlog' })}`);

    await expect(page.getByRole('heading', { name: 'Link It to My Account' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Start a New Account' })).toBeVisible();
    await expect(page.getByText('LoreHavenOwner', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Create Account With Xbox' }).click();
    await expect(page.getByRole('heading', { name: 'Bring Your Xbox Games Over?' })).toBeVisible();
    expect(state.authCalls).toEqual(['xbox/signin', 'xbox/create']);

    /* Asked once: the answer is kept with the other synced preferences. */
    await page.getByRole('button', { name: 'Not Now' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);
    expect((await prefs(page)).xboxImportAsked).toMatchObject({ [`xbox:${XUID}`]: true });
  });

  test('a linked Xbox account signs straight in', async ({ page }) => {
    const state = await stub(page, { linked: true });
    await seed(page, { [KEYS.library]: [] });
    await keepSecrets(page);
    await page.goto(`/auth/xbox?${returned({})}`);

    await expect(page.getByRole('heading', { name: 'Bring Your Xbox Games Over?' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual(['xbox/signin']);
  });

  test('a sign-in that did not start on this device is refused, without asking the Worker', async ({ page }) => {
    const state = await stub(page);
    await keepSecrets(page, { nonce: 'a-different-nonce' });
    await page.goto(`/auth/xbox?${returned({})}`);

    await expect(page.getByRole('alert').getByRole('heading', { name: 'That Sign-In Did Not Start Here' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual([]);
  });

  test('a cancelled sign-in says so and changes nothing', async ({ page }) => {
    const state = await stub(page);
    await keepSecrets(page);
    await page.goto('/auth/xbox?error=access_denied&error_description=The+user+cancelled');

    await expect(page.getByRole('alert').getByRole('heading', { name: 'Xbox Sign-In Was Cancelled' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual([]);
  });

  test('a sign-in an app began is handed back to it, with a button in case the browser holds the link', async ({ page }) => {
    const state = await stub(page);
    /* A test browser has no program registered for lorehaven://, so the page's
       attempt to open the app goes nowhere, which is the case the button is
       for: the page stays, and says where the sign-in went. */
    await keepSecrets(page);
    await page.goto(`/auth/xbox?${returned({ next: 'lorehaven://auth/xbox' })}`);

    await expect(page.getByRole('heading', { name: 'Back to the LoreHaven App' })).toBeVisible({ timeout: 20000 });
    const href = (await page.getByRole('link', { name: 'Open LoreHaven' }).getAttribute('href')) || '';
    expect(href.startsWith('lorehaven://auth/xbox?')).toBe(true);
    expect(href).toContain('code=a-code');
    expect(state.authCalls).toEqual([]);
  });

  test('a return address that is not ours is refused', async ({ page }) => {
    const state = await stub(page);
    await keepSecrets(page);
    await page.goto(`/auth/xbox?${returned({ next: 'https://evil.example/collect' })}`);

    await expect(page.getByRole('alert').getByRole('heading', { name: 'That Return Address Is Not Ours' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual([]);
  });
});

test.describe('/import/xbox', () => {
  test('a Store id match arrives ticked and a name match does not, and importing writes both marks', async ({ page }) => {
    const state = await stub(page, {
      titles: [
        title(),
        title({ titleId: '2', name: 'A Game With No Store Id', productIds: [], platform: 'Xbox One' }),
      ],
      igdbByUid: { '9PBLMX0KDKQS': { id: 1, name: 'Clair Obscur: Expedition 33', game_type: 0 } },
      search: [{ id: 2, name: 'A Game With No Store Id', game_type: 0 }],
    });
    await seed(page, { [KEYS.library]: [] });
    await keepSecrets(page);
    await page.goto(`/auth/xbox?${returned({ purpose: 'import' })}`);

    await expect(page).toHaveURL(/\/import\/xbox$/, { timeout: 20000 });
    expect(state.authCalls).toEqual(['xbox/library']);

    const matched = page.getByRole('listitem').filter({ hasText: 'Clair Obscur: Expedition 33' });
    const suggested = page.getByRole('listitem').filter({ hasText: 'A Game With No Store Id' });
    await expect(matched.getByRole('checkbox')).toBeChecked();
    await expect(suggested.getByRole('checkbox')).not.toBeChecked();
    await expect(suggested.getByText('Matched by name, check it')).toBeVisible();

    /* The console titlehub implied, shown and changeable. */
    await expect(matched.getByRole('button', { name: /Console for/ })).toContainText('Xbox Series X|S');

    await matched.getByRole('button', { name: /Status for/ }).click();
    await page.getByRole('menuitemradio', { name: 'Beaten', exact: true }).click();
    await page.getByRole('button', { name: /^Import 1 Game$/ }).click();

    await expect(page.getByRole('heading', { name: '1 Game Imported' })).toBeVisible();
    const saved = await library(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 1, status: 'Beaten' });
    expect(saved[0].user_platforms.map((p: { id: string | number }) => p.id))
      .toEqual(['custom_store_microsoft_store', 169]);
  });

  test('the page asks for a sign-in when it has no list, because nothing is kept', async ({ page }) => {
    const state = await stub(page);
    await seed(page, { [KEYS.library]: [] });
    await page.goto('/import/xbox');

    await expect(page.getByRole('heading', { name: 'Sign In With Xbox' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual([]);
  });

  test('an Xbox account with no Xbox profile is told what to do about it', async ({ page }) => {
    await stub(page);
    await keepSecrets(page);
    await page.route('**/auth/xbox/library', r => r.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'that Microsoft account has no Xbox profile. Create one at xbox.com, then sign in again' }),
    }));
    await page.goto(`/auth/xbox?${returned({ purpose: 'import' })}`);

    await expect(page.getByRole('alert').getByRole('heading', { name: 'Xbox Live Would Not Allow That Account' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/no Xbox profile/)).toBeVisible();
  });
});
