/**
 * Signing in to LoreHaven with Steam, end to end.
 *
 * Steam, the Worker's /auth routes and Firebase's own sign-in endpoints all
 * answer from the stubs below, so nothing here reaches Steam, Google or
 * Firestore, and no key of any kind is needed.
 */
import { test, expect, type Page } from '@playwright/test';
import { seed, KEYS } from './fixtures';

const STEAMID = '76561197960287930';
const OTHER_STEAMID = '76561198000000001';
const UID = 'steam_abc123';

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

/* What the account's own token says about its links: a list per service. */
const claimsFor = (state: Stub) =>
  (state.accounts.length ? { links: { steam: state.accounts.map(a => a.steamid) } } : {});

const openid = (returnTo: string) => new URLSearchParams({
  'openid.ns': 'http://specs.openid.net/auth/2.0',
  'openid.mode': 'id_res',
  'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
  'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAMID}`,
  'openid.identity': `https://steamcommunity.com/openid/id/${STEAMID}`,
  'openid.return_to': returnTo,
  'openid.response_nonce': '2026-09-16T10:00:00Zabc',
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce',
  'openid.sig': 'c2ln',
}).toString();

type Account = { steamid: string; name: string | null };
type Stub = { authCalls: string[]; linked: boolean; accounts: Account[] };

async function stub(page: Page, { linked = false, accounts = [] as Account[] } = {}) {
  const state: Stub = { authCalls: [], linked, accounts };
  const json = (r: Parameters<Parameters<Page['route']>[1]>[0], status: number, body: unknown) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  /* Everything Google, refused first; the sign-in endpoints below are
     registered after it and so are matched first. */
  await page.route(/googleapis\.com|firebaseio\.com/, r => r.abort());
  await page.route(/images\.igdb\.com/, r => r.abort());
  await page.route('**/wdqs/**', r => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  }));
  await page.route('**/api/**', r => json(r, 200, []));
  await page.route('**/steam/**', r => json(r, 200, { visible: true, games: [] }));

  await page.route(/identitytoolkit\.googleapis\.com/, (r) => {
    const url = r.request().url();
    if (url.includes('signInWithCustomToken') || url.includes('signInWithPassword')) {
      return json(r, 200, {
        idToken: idToken(claimsFor(state)),
        refreshToken: 'refresh', expiresIn: '3600', localId: UID, email: 'player@example.com',
      });
    }
    if (url.includes('accounts:lookup')) {
      return json(r, 200, {
        users: [{
          localId: UID, email: 'player@example.com', emailVerified: true,
          providerUserInfo: [{ providerId: 'password', federatedId: 'player@example.com' }],
          validSince: '0', lastLoginAt: `${Date.now()}`, createdAt: `${Date.now()}`,
        }],
      });
    }
    return json(r, 200, {});
  });
  await page.route(/securetoken\.googleapis\.com/, r => json(r, 200, {
    access_token: idToken(claimsFor(state)),
    id_token: idToken(claimsFor(state)),
    refresh_token: 'refresh', expires_in: '3600', user_id: UID, project_id: 'moctalegames',
  }));

  /* The Worker's endpoints only. A wider pattern also catches the browser's own
     navigation to /auth/steam and answers the page itself with JSON. */
  await page.route('**/auth/steam/*', (r) => {
    const action = new URL(r.request().url()).pathname.replace(/^\/auth\//, '');
    state.authCalls.push(action);
    if (action === 'steam/signin') {
      return state.linked
        ? json(r, 200, { status: 'signed-in', steamid: STEAMID, token: 'custom-token' })
        : json(r, 200, { status: 'unlinked', steamid: STEAMID, personaName: 'GabeN', ticket: 'a-ticket' });
    }
    if (action === 'steam/create') return json(r, 200, { uid: UID, steamid: STEAMID, personaName: 'GabeN', token: 'custom-token' });
    if (action === 'steam/link') return json(r, 200, { steamid: STEAMID, personaName: 'GabeN' });
    if (action === 'steam/accounts') return json(r, 200, { accounts: state.accounts });
    if (action === 'steam/unlink') {
      const { steamid } = JSON.parse(r.request().postData() || '{}');
      state.accounts = state.accounts.filter(a => a.steamid !== steamid);
      return json(r, 200, { unlinked: true, steamid, steamids: state.accounts.map(a => a.steamid) });
    }
    return json(r, 404, { error: 'unknown auth route' });
  });
  return state;
}

const prefs = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), KEYS.prefs);
const here = (path = '/auth/steam') => `http://localhost:5173${path}`;

test.describe('/auth/steam', () => {
  test('an unlinked Steam account offers both roads, and a new account lands on the import question', async ({ page }) => {
    const state = await stub(page);
    await seed(page, { [KEYS.library]: [] });
    await page.goto(`/auth/steam?from=%2Flibrary%2Fbacklog&${openid(here())}`);

    await expect(page.getByRole('heading', { name: 'Link It to My Account' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Start a New Account' })).toBeVisible();
    await expect(page.getByText('GabeN', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Create Account With Steam' }).click();
    await expect(page.getByRole('heading', { name: 'Bring Your Steam Library Over?' })).toBeVisible();
    expect(state.authCalls).toEqual(['steam/signin', 'steam/create']);

    /* Asked once: the answer is kept with the other synced preferences. */
    await page.getByRole('button', { name: 'Not Now' }).click();
    await expect(page).toHaveURL(/\/library\/backlog$/);
    expect((await prefs(page)).steamImportAsked).toMatchObject({ [`steam:${STEAMID}`]: true });
  });

  test('a linked Steam account signs straight in, and Import From Steam leads to the review', async ({ page }) => {
    const state = await stub(page, { linked: true, accounts: [{ steamid: STEAMID, name: 'GabeN' }] });
    await seed(page, { [KEYS.library]: [] });
    await page.goto(`/auth/steam?${openid(here())}`);

    await expect(page.getByRole('heading', { name: 'Bring Your Steam Library Over?' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual(['steam/signin']);

    await page.getByRole('button', { name: 'Import From Steam' }).click();
    await expect(page).toHaveURL(/\/import\/steam$/);
    expect((await prefs(page)).steamImportAsked).toMatchObject({ [`steam:${STEAMID}`]: true });
  });

  test('a sign-in meant for somewhere else is handed on, openid fields and all', async ({ page }) => {
    await stub(page);
    await page.goto(`/auth/steam?next=${encodeURIComponent(here('/import/steam'))}&${openid(here())}`);
    await expect(page).toHaveURL(/\/import\/steam\?.*openid\.mode=id_res/, { timeout: 20000 });
  });

  test('a sign-in the app began is handed back to it, with a button in case the browser holds the link back', async ({ page }) => {
    const state = await stub(page);
    /* A test browser has no program registered for lorehaven://, so the page's
       attempt to open the app goes nowhere, which is the case the button is
       for: the page stays, and says where the sign-in went. */
    const next = 'lorehaven://auth/steam?from=%2Fprofile';
    await page.goto(`/auth/steam?next=${encodeURIComponent(next)}&${openid(here())}`);

    await expect(page.getByRole('heading', { name: 'Back to the LoreHaven App' })).toBeVisible({ timeout: 20000 });
    const href = (await page.getByRole('link', { name: 'Open LoreHaven' }).getAttribute('href')) || '';
    expect(href.startsWith('lorehaven://auth/steam?')).toBe(true);
    expect(href).toContain('from=%2Fprofile');
    expect(href).toContain('openid.mode=id_res');
    expect(state.authCalls).toEqual([]);
  });

  test('a return address that is not ours is refused, without asking the Worker', async ({ page }) => {
    const state = await stub(page);
    await page.goto(`/auth/steam?next=${encodeURIComponent('https://evil.example/collect')}&${openid(here())}`);
    await expect(page.getByRole('alert').getByRole('heading', { name: 'That Return Address Is Not Ours' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual([]);
    expect(page.url()).toContain('/auth/steam');
  });

  test('a cancelled sign-in says so and changes nothing', async ({ page }) => {
    const state = await stub(page);
    const cancelled = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'cancel' }).toString();
    await page.goto(`/auth/steam?${cancelled}`);
    await expect(page.getByRole('alert').getByRole('heading', { name: 'Steam Sign-In Was Cancelled' })).toBeVisible({ timeout: 20000 });
    expect(state.authCalls).toEqual([]);
  });

test('Profile lists every linked Steam account, and unlinking one leaves the other', async ({ page }) => {
    const state = await stub(page, {
      linked: true,
      accounts: [{ steamid: STEAMID, name: 'GabeN' }, { steamid: OTHER_STEAMID, name: 'The Family One' }],
    });
    await seed(page, { [KEYS.library]: [] });

    /* Signed in through the Steam return, so the page has a real session. */
    await page.goto(`/auth/steam?from=%2Fprofile&${openid(here())}`);
    await page.getByRole('button', { name: 'Not Now' }).click();
    await expect(page).toHaveURL(/\/profile$/);

    const list = page.getByRole('list', { name: 'Steam accounts linked to this LoreHaven account' });
    /* first(): each row also carries the name inside its Unlink button, for a
       screen reader to hear which account the button belongs to. */
    await expect(list.getByText('GabeN').first()).toBeVisible({ timeout: 20000 });
    await expect(list.getByText('The Family One').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link Another Steam Account' })).toBeVisible();

    await page.getByRole('button', { name: 'Unlink The Family One' }).click();
    await expect(page.getByRole('heading', { name: 'Unlink this Steam account?' })).toBeVisible();
    await page.getByRole('button', { name: 'Unlink Steam', exact: true }).click();

    await expect(list.getByText('The Family One')).toHaveCount(0);
    await expect(list.getByText('GabeN').first()).toBeVisible();
    expect(state.authCalls).toContain('steam/unlink');
  });

  test('the import page offers a choice when the account signs in with two Steam accounts', async ({ page }) => {
    await stub(page, {
      linked: true,
      accounts: [{ steamid: STEAMID, name: 'GabeN' }, { steamid: OTHER_STEAMID, name: 'The Family One' }],
    });
    await seed(page, { [KEYS.library]: [] });

    await page.goto(`/auth/steam?from=%2Fprofile&${openid(here())}`);
    await page.getByRole('button', { name: 'Import From Steam' }).click();
    await expect(page).toHaveURL(/\/import\/steam$/);

    /* Neither library is read until one is chosen. */
    await expect(page.getByRole('heading', { name: 'Your Steam Accounts' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'GabeN' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'The Family One' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign In With Steam' })).toBeVisible();
  });
});
