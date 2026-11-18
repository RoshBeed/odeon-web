// The site in a real browser, driven the way a visitor drives it: by keys,
// clicks and scrolling. The listings are the small set in listings.ts.
import { expect, test, type Page } from '@playwright/test';
import { listings } from './listings.ts';

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

const column = (page: Page, title: string) => page.locator('.column', { has: page.locator('.bar h2', { hasText: new RegExp(`^${title}$`) }) });
const choices = (page: Page, title: string) => column(page, title).locator('.facet li:not(.note)');
const showtimes = (page: Page) => page.locator('.column.showtimes .cards li:not(.day)');
const titles = (page: Page) => page.locator('.columns .bar h2');
const total = (page: Page) => page.locator('.column.showtimes .bar .count');
/** Open an address and wait until the finder is drawn, so that keys pressed next reach it. */
async function visit(page: Page, address: string) {
  await page.goto(address);
  await expect(page.locator('.column.showtimes .bar .count')).toHaveText(/\d/);
}

test('the site opens on the finder, with the default columns and a quick start', async ({ page }) => {
  await visit(page, '/');
  await expect(titles(page)).toHaveText(['Cinema', 'Film', 'Showtimes', /./]);
  await expect(total(page)).toHaveText('254'); // event cinema left out
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Paddington/]);
});

test('keys choose in each column, each counts what the others leave, and the address keeps it', async ({ page }) => {
  await visit(page, '/#/?cols=day,film,cinema,picture');
  await page.keyboard.press('ArrowRight'); // to Film
  await page.keyboard.press('ArrowDown'); // Dune
  await expect(total(page)).toHaveText('3');
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Aberdeen\s*1$/, /^Holloway\s*1$/, /^West End\s*1$/]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // to Picture
  await page.keyboard.press('ArrowDown'); // IMAX
  await expect(total(page)).toHaveText('1');
  await expect(page).toHaveURL(/#\/\?cols=day,film,cinema,picture&film=F1&picture=IMAX&col=4$/);
  await page.reload();
  await expect(total(page)).toHaveText('1');
  await expect(column(page, 'Picture')).toHaveClass(/focused/);
  await page.keyboard.press('Escape'); // the picture back to All
  await expect(total(page)).toHaveText('3');
});

test('the highlighted showtime shows its details and its double bill, which can be followed', async ({ page }) => {
  await visit(page, '/#/?film=F1&col=3');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const details = page.locator('.column.details');
  await expect(details.locator('.bar h2')).toHaveText('Dune · 18:00');
  await expect(details.locator('.bills li.day')).toHaveText('Straight after this');
  await expect(details.locator('h3')).toHaveText('Dune'); // the film's own details follow
  await details.locator('.bills li', { hasText: 'Paddington' }).click();
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Paddington');
  await expect(details.locator('.bar h2')).toHaveText('Paddington · 20:50');
});

test('the columns panel adds, moves and removes columns, and a bookmark keeps the view', async ({ page }) => {
  await visit(page, '/#/?cols=day,film,cinema,picture');
  await page.keyboard.press('o');
  const panel = page.locator('dialog.panel');
  await panel.getByLabel(/^\s*Screen each/).check();
  await panel.getByRole('button', { name: 'Move Screen left' }).click();
  await panel.getByRole('button', { name: 'Move Screen left' }).click(); // past Picture, then Cinema
  await panel.getByLabel(/^\s*Picture IMAX/).uncheck();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(titles(page)).toHaveText(['Day', 'Film', 'Screen', 'Cinema', 'Showtimes', /./]);
  await expect(choices(page, 'Screen').nth(1)).toContainText('#1 West End300 seats');
  const bookmark = page.url();
  expect(bookmark).toMatch(/#\/\?cols=day,film,screen,cinema$/);
  await page.goto('about:blank');
  await visit(page, bookmark);
  await expect(titles(page)).toHaveText(['Day', 'Film', 'Screen', 'Cinema', 'Showtimes', /./]);
});

test('[ and ] move the column in hand, and x hides it', async ({ page }) => {
  await visit(page, '/#/?cols=day,film,cinema,picture&col=2');
  await page.keyboard.press(']');
  await expect(titles(page)).toHaveText(['Day', 'Cinema', 'Film', 'Picture', 'Showtimes', /./]);
  await expect(column(page, 'Film')).toHaveClass(/focused/);
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await expect(titles(page)).toHaveText(['Film', 'Day', 'Cinema', 'Picture', 'Showtimes', /./]);
  await page.keyboard.press('x');
  await expect(titles(page)).toHaveText(['Day', 'Cinema', 'Picture', 'Showtimes', /./]);
  await expect(page).toHaveURL(/cols=day,cinema,picture/);
});

test('/ searches the column in hand, and s orders it', async ({ page }) => {
  await visit(page, '/#/?col=2');
  await page.keyboard.press('/');
  await page.keyboard.type('padd');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Paddington/]);
  await page.keyboard.press('Enter'); // leaves the search box
  await page.keyboard.press('ArrowDown');
  await expect(total(page)).toHaveText('251');
  await page.keyboard.press('Escape'); // All again
  await page.keyboard.press('Escape'); // and the search cleared
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Paddington/]);
  await page.keyboard.press('s'); // by how many showings
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Paddington/, /^Dune/]);
  await expect(page).toHaveURL(/order=film:count/);
});

test('a long list of showtimes draws more as the reader scrolls and as the highlight moves', async ({ page }) => {
  await visit(page, '/#/?col=3');
  await expect(showtimes(page)).toHaveCount(100);
  await page.locator('.column.showtimes').evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(showtimes(page)).toHaveCount(200);
  for (let press = 0; press < 205; press += 1) await page.keyboard.press('ArrowDown');
  await expect(showtimes(page)).toHaveCount(254);
  await expect(showtimes(page).nth(205)).toHaveClass(/selected/);
});

test('the window holds the columns clear of the footer, and a highlighted row clear of its heading', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await visit(page, '/#/?col=3');
  for (const [key, times] of [['ArrowDown', 40], ['ArrowUp', 30]] as const) for (let press = 0; press < times; press += 1) await page.keyboard.press(key);
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const [strip, footer, bar, row] = [await box('.columns'), await box('footer'), await box('.showtimes .bar'), await box('.showtimes .selected')];
  expect(strip.y + strip.height).toBeLessThanOrEqual(footer.y + 1);
  expect(row.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
});

test('London only, in the header, ticks Greater London as ?cinemas=london and loads only its listings', async ({ page }) => {
  await visit(page, '/');
  const london = page.locator('header').getByLabel('London only');
  await london.check();
  await expect(page).toHaveURL(/\?cinemas=london#/);
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Holloway/, /^West End/]);
  const bookmark = page.url();
  await page.goto('about:blank'); // a fresh visit, as from the bookmark
  fetched.length = 0;
  await visit(page, bookmark);
  await expect(london).toBeChecked();
  expect(fetched).toEqual(['london.json.gz']);
  await page.keyboard.press('l'); // the key does the same
  await expect(london).not.toBeChecked();
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Aberdeen/, /^Holloway/, /^West End/]);
  expect(fetched).toEqual(['london.json.gz', 'listings.json.gz']); // every cinema, fetched once needed
});

test('event cinema and single cinemas are chosen in the settings', async ({ page }) => {
  await visit(page, '/');
  await page.getByRole('button', { name: 'Columns & settings' }).click();
  const panel = page.locator('dialog.panel');
  await panel.getByLabel(/Event cinema/).check();
  await expect(page).toHaveURL(/\?show=events#/);
  await panel.getByLabel(/^ ?Aberdeen$/).check();
  await expect(page).toHaveURL(/cinemas=001/);
  await page.keyboard.press('Escape');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/]);
  await visit(page, '/?show=events#/');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Opera Live/, /^Paddington/]);
});

test('a phone shows one column at a time, and a choice moves on to the next', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await visit(page, '/');
  await expect(page.locator('.column:visible .bar h2')).toHaveText('Cinema');
  await page.locator('.column.cinema li', { hasText: 'All' }).first().click(); // All moves on too
  await expect(page.locator('.column:visible .bar h2')).toHaveText('Film');
  await page.locator('.column.film li', { hasText: 'Dune' }).click();
  await expect(page.locator('.column:visible')).toHaveClass(/showtimes/);
  await showtimes(page).first().click();
  await expect(page.locator('.column:visible')).toHaveClass(/details/);
  await expect(page.locator('.column.details .actions a')).toHaveText('Book on odeon.co.uk');
});
