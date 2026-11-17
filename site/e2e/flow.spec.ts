// The site in a real browser, driven the way a visitor drives it: by keys,
// clicks and scrolling. The listings are the small set in listings.ts.
import { expect, test, type Page } from '@playwright/test';
import { day, listings } from './listings.ts';

const data = listings();
const fetched: string[] = [];

test.beforeEach(async ({ page }) => {
  fetched.length = 0;
  await page.route('**/data/*.json.gz', (route) => {
    const name = route.request().url().split('/').pop()!;
    fetched.push(name);
    return route.fulfill({ contentType: 'application/json', body: name.startsWith('london') ? data.london : data.all });
  });
});

const column = (page: Page, title: string) => page.locator('.column', { has: page.locator('h2', { hasText: new RegExp(`^${title}$`) }) });
const cards = (page: Page, title: string) => column(page, title).locator('.cards li:not(.day)');
/** The column the keys act on. A page being previewed has the same title, so ask for this one by its place. */
const focused = (page: Page) => page.locator('.column.focused');
const menu = async (page: Page, entry: string) => {
  await page.goto('/#/browse');
  await cards(page, 'Browse').filter({ hasText: entry }).first().click();
  await page.keyboard.press('ArrowRight');
  await expect(focused(page).locator('h2')).toHaveText(entry);
};

test('the welcome page leads into the menu, and back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Browse the listings')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(column(page, 'Browse')).toHaveClass(/focused/);
  await expect(cards(page, 'Browse').first()).toContainText('Find showtimes');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText('Browse the listings')).toBeVisible();
});

test('arrow keys move through columns: films, a film, its showtimes, a showing', async ({ page }) => {
  await menu(page, 'Films');
  await expect(cards(page, 'Films').first()).toContainText('All');
  // Editions of one film are merged, and event cinema is left out.
  await expect(cards(page, 'Films')).toHaveText([/^All/, /^Dune/, /^Paddington/]);
  await page.keyboard.press('ArrowDown');
  await expect(cards(page, 'Films').nth(1)).toHaveClass(/selected/);
  await expect(page.locator('.preview h2')).toHaveText('Dune');
  await page.keyboard.press('ArrowRight');
  await expect(focused(page).locator('h2')).toHaveText('Dune');
  await expect(focused(page).locator('.cards li').first()).toContainText('every showtime of this film');
  await page.keyboard.press('ArrowRight'); // All: every showtime of the film
  await expect(focused(page).locator('.cards li:not(.day)').last()).toContainText('19:00–21:35');
  await expect(page).toHaveURL(/#\/browse\?row=\d+\|films\?row=2\|film\/F1\|film\/F1\/all$/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(column(page, 'Films')).toHaveClass(/focused/);
  await expect(cards(page, 'Films').nth(1)).toHaveClass(/selected/);
});

test('a search highlights its first match, and Enter opens it', async ({ page }) => {
  await menu(page, 'All showtimes');
  await page.keyboard.press('/');
  await page.keyboard.type('dune');
  const rows = cards(page, 'All showtimes');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveClass(/selected/);
  await page.keyboard.press('Enter'); // leaves the search box
  await page.keyboard.press('Enter');
  await expect(focused(page).locator('h2')).toContainText('Dune');
});

test('the window holds whole columns clear of the footer, and a row moved up to stays clear of its heading', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await menu(page, 'All showtimes');
  for (const [key, times] of [['ArrowDown', 40], ['ArrowUp', 30]] as const) for (let press = 0; press < times; press += 1) await page.keyboard.press(key);
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const [strip, footer, bar, row, first] = [await box('.columns'), await box('footer'), await box('.focused .bar'), await box('.focused .selected'), await box('.column')];
  expect(strip.y + strip.height).toBeLessThanOrEqual(footer.y + 1);
  expect(row.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
  expect(strip.width / first.width).toBeCloseTo(Math.round(strip.width / first.width), 1);
  // The footer names only the keys that do something on this page.
  await expect(page.locator('footer .keys')).toHaveText(/move.*open.*back.*search.*sort.*book.*calendar/);
  await expect(page.locator('footer .keys')).not.toHaveText(/tick|trailer/);
});

test('a long list draws more rows as the reader scrolls and as the highlight moves', async ({ page }) => {
  await menu(page, 'All showtimes');
  const rows = cards(page, 'All showtimes');
  await expect(rows).toHaveCount(100);
  await column(page, 'All showtimes').evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(rows).toHaveCount(200);
  for (let press = 0; press < 205; press += 1) await page.keyboard.press('ArrowDown');
  await expect(rows).toHaveCount(254);
  await expect(rows.nth(205)).toHaveClass(/selected/);
});

test('ticked cinemas go in the address and narrow every list', async ({ page }) => {
  await menu(page, 'Cinemas');
  await cards(page, 'Cinemas').filter({ hasText: 'London West End' }).locator('.tick').click();
  await expect(page).toHaveURL(/\?cinemas=155#/);
  await page.goto('about:blank'); // a fresh visit, as from a bookmark
  await page.goto('/?cinemas=155#/browse');
  await expect(cards(page, 'Browse').filter({ hasText: /^Films/ })).toContainText('2 films · 2 showings');
  expect(fetched).toEqual(['listings.json.gz', 'london.json.gz']); // only London's once only London is ticked
});

test('event cinema appears once it is switched on in the settings', async ({ page }) => {
  await menu(page, 'Settings');
  await cards(page, 'Settings').filter({ hasText: 'Event cinema' }).click();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?show=events#/);
  await page.goto('/?show=events#/browse|films');
  await expect(cards(page, 'Films')).toHaveText([/^All/, /^Dune/, /^Opera Live/, /^Paddington/]);
});

test('a showing lists the film that can follow it', async ({ page }) => {
  await page.goto('/#/browse|show/155/A');
  await expect(column(page, 'Dune · 18:00').locator('li.day')).toHaveText('Straight after this');
  await expect(cards(page, 'Dune · 18:00')).toHaveText([/Paddington15 min gap/]);
});

test('the finder narrows each column by the others', async ({ page }) => {
  await page.goto('/#/find');
  const total = column(page, 'Showtimes').locator('.bar .dim');
  await expect(total).toHaveText('254');
  await column(page, 'Film').getByText('Dune').click();
  await expect(total).toHaveText('3');
  await expect(column(page, 'Cinema').locator('li')).toHaveText([/^All/, /^Aberdeen1$/, /^Holloway1$/, /^West End1$/]);
  await column(page, 'Format').getByText('IMAX').click();
  await expect(total).toHaveText('1');
  await expect(page).toHaveURL(/#\/find\?film=F1&format=IMAX&col=4$/);
  await page.keyboard.press('Escape'); // the format back to All
  await expect(total).toHaveText('3');
});

test('a phone shows one page at a time, as cards to tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/#/films');
  await expect(page.locator('.columns')).toHaveCount(0);
  await page.locator('.cards li', { hasText: 'Dune' }).click();
  await expect(page).toHaveURL(/#\/film\/F1$/);
  await expect(page.locator('.cards li').first()).toContainText('All');
  expect(day(1) > day(0)).toBe(true);
});
