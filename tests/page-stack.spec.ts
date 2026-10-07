import { test, expect } from '@playwright/test';
import { offlineIgdb } from './igdb-stub';

/**
 * The page stack (src/motion/PageStack.jsx) keeps pages you have left mounted,
 * so Back returns to the same page. A redirect route must not be kept: the
 * kept one had already redirected, so the second visit to /library showed a
 * blank page. The Library launcher shortcut on Android opens /library, and
 * the second tap on it was the one that failed.
 */

test.beforeEach(async ({ page }) => { await offlineIgdb(page); });

/* Navigate inside the app, without a reload, as a link or the shortcut does. */
const go = (page, path: string) => page.evaluate((p) => {
  history.pushState({}, '', p);
  dispatchEvent(new PopStateEvent('popstate'));
}, path);

test('bare /library redirects to a shelf every time, not only the first', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL(/\/library\/backlog/);
  await expect(page.locator('main h1:visible')).toHaveText('Backlog');

  await go(page, '/');
  await expect(page.locator('main h1:visible')).toHaveText(/Explore/i);

  await go(page, '/library');
  await expect(page).toHaveURL(/\/library\/backlog/);
  await expect(page.locator('main h1:visible')).toHaveText('Backlog');
});

test('bare /browse redirects to genres every time', async ({ page }) => {
  await page.goto('/browse');
  await expect(page).toHaveURL(/\/browse\/genres/);
  await go(page, '/');
  await expect(page.locator('main h1:visible')).toHaveText(/Explore/i);
  await go(page, '/browse');
  await expect(page).toHaveURL(/\/browse\/genres/);
});
