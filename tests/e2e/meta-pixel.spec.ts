import { test, expect, type Page } from '@playwright/test';

// The pixel is env-gated (lib/meta-pixel.ts) and the id is inlined at build
// time, so this suite only applies to a build made with the var set.
const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
test.skip(!PIXEL_ID, 'Meta pixel is env-gated: build and run with NEXT_PUBLIC_META_PIXEL_ID set');

async function pixelCalls(page: Page) {
  return page.evaluate(() => {
    const fbq = window.fbq as typeof window.fbq & { queue?: IArguments[] };
    return (fbq?.queue ?? []).map((args) => Array.from(args));
  });
}

// Keep the real inline initializer but block every external request, including
// fbevents.js and all analytics beacons. No conversion reaches a live service.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3128' && ['GET', 'HEAD'].includes(route.request().method())) {
      return route.continue();
    }
    return route.abort();
  });
});

test('one init and PageView per pathname, including initial hydration and back navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/about');
  await expect(page.locator('main')).toBeVisible();
  await expect.poll(() => pixelCalls(page)).toEqual([
    ['init', PIXEL_ID], ['track', 'PageView', undefined],
  ]);
  await expect(page.locator('script#meta-pixel')).toHaveCount(1);
  await page.evaluate(() => window.history.pushState({}, '', '/about?q=fixture'));
  await expect.poll(() => page.url()).toContain('?q=fixture');
  await page.locator('a[href="/"]').first().click();
  await expect(page).toHaveURL('http://127.0.0.1:3128/');
  await expect.poll(async () => (await pixelCalls(page)).filter((call) => call[1] === 'PageView').length).toBe(2);
  await page.goBack();
  await expect(page).toHaveURL(/\/about\?q=fixture$/);
  await expect.poll(async () => (await pixelCalls(page)).filter((call) => call[1] === 'PageView').length).toBe(3);
  expect((await pixelCalls(page)).filter((call) => call[0] === 'init')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a throwing pixel cannot break page rendering or navigation', async ({ page }) => {
  await page.addInitScript(() => { window.fbq = () => { throw new Error('Blocked pixel'); }; });
  await page.goto('/about');
  await expect(page.locator('main')).toBeVisible();
  await page.locator('a[href="/"]').first().click();
  await expect(page).toHaveURL('http://127.0.0.1:3128/');
  await expect(page.locator('main')).toBeVisible();
});

test('signup welcome queues one registration without counting URL cleanup as another PageView', async ({ page }) => {
  await page.goto('/about?welcome=signup');
  await expect(page).toHaveURL(/\/about$/);
  await expect.poll(async () => (await pixelCalls(page)).filter((call) => call[1] === 'CompleteRegistration').length).toBe(1);
  expect((await pixelCalls(page)).filter((call) => call[1] === 'PageView')).toHaveLength(1);
  expect((await pixelCalls(page)).filter((call) => call[0] === 'init')).toHaveLength(1);
});
