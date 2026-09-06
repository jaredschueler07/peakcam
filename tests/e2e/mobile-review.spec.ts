import { test, expect } from "@playwright/test";

test.describe("mobile layout and navigation", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  test("conditions start early and filters are modal with focus restoration", async ({ page }) => {
    await page.goto("/");
    const preview = page.getByRole("button", { name: /^Live look at/ }).first();
    await expect(preview).toBeVisible();
    expect((await preview.boundingBox())!.y).toBeLessThan(650);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const filters = page.getByRole("button", { name: /^Filters/ });
    await filters.click();
    const dialog = page.getByRole("dialog", { name: "Filters and sort" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(filters).toBeFocused();
    const menu = page.getByRole("button", { name: "Toggle menu" });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  test("long resort names fit and cameras have a direct jump", async ({ page }) => {
    await page.goto("/resorts/breckenridge");
    await expect(page.getByRole("heading", { name: "Breckenridge", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.getByRole("navigation", { name: "Resort sections" }).getByRole("link", { name: "Cameras", exact: true }).click();
    await expect(page).toHaveURL(/#cameras$/);
    await expect(page.locator("#cameras h2")).toBeInViewport();
  });

  test("comparison shows two complete value columns", async ({ page }) => {
    await page.goto("/compare?resorts=vail,breckenridge");
    const comparison = page.getByRole("region", { name: "Mobile resort comparison" });
    await expect(comparison.getByRole("link", { name: "Vail Mountain", exact: true })).toBeInViewport();
    await expect(comparison.getByRole("link", { name: "Breckenridge", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("public alerts signup opens without a management token", async ({ page }) => {
    const response = await page.goto("/alerts");
    expect(response?.status()).toBe(200);
    await page.getByRole("button", { name: "Get powder alerts", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Get powder alerts" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("password recovery sends the safe callback and handles completion without exposing account existence", async ({ page }) => {
    let redirect = "";
    await page.route("**/auth/v1/recover**", async route => {
      redirect = new URL(route.request().url()).searchParams.get("redirect_to") ?? "";
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto("/auth?next=https://untrusted.invalid");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page.getByRole("textbox", { name: "Email address" }).fill("mobile-test@example.invalid");
    await page.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const callback = new URL(redirect);
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe("/auth/update-password");
    await expect(page.getByRole("status")).toContainText("If mobile-test@example.invalid has a PeakCam account");
  });

  test("game start scrolls into reach and control preferences survive reload", async ({ page }) => {
    await page.goto("/resorts/breckenridge/drop-in?gfx=webgl");
    await page.getByText("Control preferences", { exact: true }).click();
    await page.getByLabel("Steering hand", { exact: true }).selectOption("right");
    await page.getByLabel("Steering style", { exact: true }).selectOption("buttons");
    await page.reload();
    await page.getByText("Control preferences", { exact: true }).click();
    await expect(page.getByLabel("Steering hand", { exact: true })).toHaveValue("right");
    await expect(page.getByLabel("Steering style", { exact: true })).toHaveValue("buttons");
    const start = page.getByRole("button", { name: "Start descent", exact: true });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test("landscape phones retain touch buttons with the selected handedness", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(`${test.info().project.use.baseURL}/resorts/breckenridge/drop-in?gfx=webgl`);
  await page.getByText("Control preferences", { exact: true }).click();
  await page.getByLabel("Steering hand", { exact: true }).selectOption("right");
  await page.getByLabel("Steering style", { exact: true }).selectOption("buttons");
  await page.getByRole("button", { name: "Start descent", exact: true }).click();
  const tuck = page.getByRole("button", { name: "Tuck", exact: true });
  await expect(tuck).toBeVisible({ timeout: 90_000 });
  await expect(tuck).toBeInViewport({ ratio: 1 });
  const right = page.getByRole("button", { name: "Steer right", exact: true });
  await expect(right).toBeInViewport({ ratio: 1 });
  expect((await tuck.boundingBox())!.x).toBeLessThan((await right.boundingBox())!.x);
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeFocused();
  await expect(tuck).toHaveCount(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(tuck).toBeVisible();
  await context.close();
});
