import { test, expect } from '@playwright/test';

test('static server fallback has a useful document title', async ({ page }) => {
  const response = await page.goto('/500');
  expect(response?.status()).toBe(500);
  await expect(page).toHaveTitle('Temporarily unavailable | PeakCam');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('We couldn’t load this page.');
});

test('signup marker cleanup preserves other query parameters and the fragment', async ({ page }) => {
  await page.goto('/auth?welcome=signup&keep=yes#alerts');
  await expect(page).toHaveURL(/\/auth\?keep=yes#alerts$/);
  await page.reload();
  await expect(page).toHaveURL(/\/auth\?keep=yes#alerts$/);
});

for (const width of [390, 1440]) {
  test(`home skip link bypasses all repeated navigation at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('/');
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.keyboard.press(tab);
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.keyboard.press(tab);
    const search = page.getByPlaceholder(/Search \d+ resorts/);
    await expect(search).toBeFocused();
    await expect(search).toBeInViewport();
    // The fixed header must not obscure the destination.
    await expect.poll(async () => (await search.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(64);
  });
}

for (const width of [360, 390]) {
  test(`auth heading fits at 200 percent root text size at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.goto('/auth');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await page.evaluate(() => document.fonts.ready);
    const heading = page.getByRole('heading', { name: 'Keep your mountains in one place.' });
    await expect(heading).toBeVisible();
    const dimensions = await heading.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return { width: element.clientWidth, scrollWidth: element.scrollWidth,
        lines: [...range.getClientRects()].map(line => ({ left: line.left, right: line.right })),
        left: bounds.left, right: bounds.right };
    });
    const pageWidth = await page.evaluate(() => ({ viewport: window.innerWidth,
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(pageWidth.document).toBeLessThanOrEqual(pageWidth.viewport);
    expect(pageWidth.body).toBeLessThanOrEqual(pageWidth.viewport);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    for (const line of dimensions.lines) {
      expect(line.left).toBeGreaterThanOrEqual(dimensions.left - 1);
      expect(line.right).toBeLessThanOrEqual(dimensions.right + 1);
    }
  });
}

test('keyboard skip link moves focus to main and continues within it', async ({ page, browserName }) => {
  await page.goto('/auth');
  // WebKit follows macOS's default: Option+Tab includes links in navigation.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  // WebKit follows macOS's default: Option+Tab includes links in navigation.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.locator('main').getByRole('link', { name: 'PeakCam', exact: true })).toBeFocused();
});
