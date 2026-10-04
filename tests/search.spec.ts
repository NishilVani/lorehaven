/**
 * The search overlay's local half: suggestions while typing, ghost-text
 * completion, the combobox keys, autocorrect and the empty-box starting points.
 *
 * IGDB is stubbed to answer NOTHING, on purpose. Everything asserted here comes
 * from the shipped index and this device, which is the point: one wrong letter
 * used to return no results at all, because IGDB alone was asked.
 */
import { test, expect, type Page } from '@playwright/test';
import { seed, KEYS } from './fixtures';

async function igdbSaysNothing(page: Page) {
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/wdqs/**', r => r.fulfill({
    status: 200, contentType: 'application/sparql-results+json',
    body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  }));
}

async function openSearch(page: Page) {
  await page.goto('/?search=true');
  const input = page.getByRole('combobox', { name: 'Search index' });
  await expect(input).toBeFocused();
  return input;
}

test.describe('search — local, instant, forgiving', () => {
  test.beforeEach(async ({ page }) => { await igdbSaysNothing(page); });

  test('an unfinished word suggests the game and Tab completes it', async ({ page }) => {
    const input = await openSearch(page);
    await input.pressSequentially('hollow kn');
    const list = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(list.getByRole('option').first()).toContainText('Hollow Knight');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#search-ghost-hint')).toHaveText('Press Tab to complete: hollow knight');
    await input.press('Tab');
    await expect(input).toHaveValue('hollow knight');
    await expect(input).toBeFocused();
  });

  test('ArrowDown and Enter open the marked suggestion', async ({ page }) => {
    const input = await openSearch(page);
    await input.pressSequentially('wicher 3');
    await expect(page.getByRole('option').first()).toContainText('The Witcher 3: Wild Hunt');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'search-suggestion-0');
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/game\/1942$/);
  });

  test('a typo is corrected, with a way back to exactly what was typed', async ({ page }) => {
    const input = await openSearch(page);
    await input.pressSequentially('elden rng');
    await input.press('Enter');
    await expect(page.getByText('Showing results for')).toBeVisible();
    await expect(page.locator('strong', { hasText: 'elden ring' })).toBeVisible();
    await expect(page.locator('.grid [role="link"]').first()).toHaveAttribute('aria-label', 'Elden Ring');

    await page.getByRole('button', { name: 'Search instead for elden rng' }).click();
    await expect(page.getByText('Showing results for')).toHaveCount(0);
    await expect(input).toHaveValue('elden rng');
  });

  test('the first Escape closes the suggestions, the second closes search', async ({ page }) => {
    const input = await openSearch(page);
    await input.pressSequentially('persona5');
    await expect(page.getByRole('option').first()).toContainText('Persona 5');
    await input.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
    await input.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0);
  });

  test('a game in your library is found with a typo and says so', async ({ page }) => {
    await seed(page, { [KEYS.library]: [{ id: 990001, name: 'Tiny Indie Gem', status: 'Backlog', is_custom: false }] });
    const input = await openSearch(page);
    await input.pressSequentially('tiny inide');   // a transposed letter
    const first = page.getByRole('option').first();
    await expect(first).toContainText('Tiny Indie Gem');
    await expect(first).toContainText('In library · Backlog');
  });

  test('an empty box offers what you are playing and what is popular', async ({ page }) => {
    await seed(page, { [KEYS.library]: [{ id: 990002, name: 'My Current Game', status: 'Playing', is_custom: false }] });
    await openSearch(page);
    await expect(page.getByRole('heading', { name: 'Playing Now' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Current Game' })).toHaveAttribute('href', '/game/990002');
    await expect(page.getByRole('heading', { name: 'Popular' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Grand Theft Auto V' })).toBeVisible();
  });
});
