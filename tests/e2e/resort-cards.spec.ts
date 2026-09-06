import { expect, test } from "@playwright/test";

test("camera quick view loads on demand, switches one feed, and restores focus and scroll", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-resort-slug="vail"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText(/cams? available/)).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  const trigger = card.getByRole("button", { name: "Live look", exact: true });
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

test("failed provider thumbnails preserve the camera count and quick-view action", async ({ page }) => {
  await page.route("https://player.brownrice.com/snapshot/**", route => route.abort());
  await page.goto("/");
  const card = page.locator('[data-resort-slug="vail"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText("Preview unavailable · Open cameras")).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  await expect(card.getByText(/cams? available/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Live look", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "Live look", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

for (const width of [390, 320]) {
  test(`cards and camera controls fit a ${width}px phone viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const card = page.locator('[data-resort-slug="vail"]');
    await card.scrollIntoViewIfNeeded();
    const cardBounds = await card.boundingBox();
    expect(cardBounds!.x).toBeGreaterThanOrEqual(0);
    expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(width);
    await card.getByRole("button", { name: "Live look", exact: true }).click();
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
