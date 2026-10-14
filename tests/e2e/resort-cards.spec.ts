import { expect, test } from "@playwright/test";

test("camera quick view loads on demand, switches one feed, and restores focus and scroll", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-resort-slug="vail"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText(/cams? available/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  // The preview is the only Live look trigger; the old footer button is gone.
  await expect(card.getByRole("button", { name: "Live look", exact: true })).toHaveCount(0);
  const trigger = card.getByRole("button", { name: /^Live look at Vail Mountain/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Vail Mountain webcams" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close camera preview" })).toBeFocused();
  await expect(dialog.locator("iframe")).toHaveCount(1);
  const firstSource = await dialog.locator("iframe").getAttribute("src");
  await dialog.getByRole("button", { name: "Next cam" }).click();
  await expect(dialog.locator("iframe")).toHaveCount(1);
  await expect(dialog.locator("iframe")).not.toHaveAttribute("src", firstSource!);
  // Native modal makes the resort grid inert and keeps tab navigation inside.
  await dialog.getByRole("button", { name: "Close camera preview" }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("compare sits in the preview overlay as a 44px link beside the favorite heart", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-resort-slug="vail"]');
  await card.scrollIntoViewIfNeeded();
  const compare = card.getByRole("link", { name: /^Compare Vail Mountain/ });
  await expect(compare).toHaveAttribute("href", "/compare?resorts=vail");
  await expect(compare).toHaveAttribute("title", "Compare");
  const compareBox = await compare.boundingBox();
  expect(compareBox!.width).toBeGreaterThanOrEqual(44);
  expect(compareBox!.height).toBeGreaterThanOrEqual(44);
  const heartBox = await card.getByRole("button", { name: /favorites$/ }).boundingBox();
  expect(heartBox!.width).toBeGreaterThanOrEqual(44);
  expect(heartBox!.height).toBeGreaterThanOrEqual(44);
  // Overlay controls are siblings of the main card link and the preview button — no nested interactives.
  await expect(card.locator('a[href="/resorts/vail"] a, a[href="/resorts/vail"] button')).toHaveCount(0);
  await expect(card.locator('button[aria-label^="Live look at"] a, button[aria-label^="Live look at"] button')).toHaveCount(0);
});

test("failed provider thumbnails preserve the camera count and quick-view action", async ({ page }) => {
  await page.route("https://player.brownrice.com/snapshot/**", route => route.abort());
  await page.goto("/");
  const card = page.locator('[data-resort-slug="vail"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText("Preview unavailable · Open cameras")).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  await expect(card.getByText(/cams? available/)).toBeVisible();
  const trigger = card.getByRole("button", { name: /^Live look at Vail Mountain/ });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

// Measured Vail card heights with a one-line name: 388px at 390, 348px at 320
// (~488px at 393 before the action footer was removed). Bounds carry ~30px slack.
const MAX_CARD_HEIGHT: Record<number, number> = { 390: 420, 320: 380 };
// A "Fresh snow" / "Snow forecast" badge adds one more row (measured 25px).
const SNOW_BADGE_ALLOWANCE = 36;

for (const width of [390, 320]) {
  test(`cards and camera controls fit a ${width}px phone viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const card = page.locator('[data-resort-slug="vail"]');
    await card.scrollIntoViewIfNeeded();
    const cardBounds = await card.boundingBox();
    expect(cardBounds!.x).toBeGreaterThanOrEqual(0);
    expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(width);
    const nameBounds = await card.getByRole("heading", { name: "Vail Mountain" }).boundingBox();
    if (nameBounds!.height < 40) {
      const badges = await card.getByText(/^(Fresh snow|Snow forecast)$/).count();
      expect(cardBounds!.height).toBeLessThan(MAX_CARD_HEIGHT[width] + (badges ? SNOW_BADGE_ALLOWANCE : 0));
    }
    await card.getByRole("button", { name: /^Live look at Vail Mountain/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(dialog.getByRole("button", { name: "Close camera preview" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Next cam" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close camera preview" }).click();
    await expect(dialog).toHaveCount(0);
  });
}
