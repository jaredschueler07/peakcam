import { expect, test } from "@playwright/test";

/**
 * Drop In v3 (the Descent engine) smoke run. Headless Chromium draws with
 * SwiftShader, so this checks the flow — menu, gate, countdown, riding, the
 * line-following bot reaching the finish, the results card — not the pixels.
 */

// `?e2e=1` exposes `window.__descent` in the production bundle (see lib/descent/Descent.ts).
const URL = "/resorts/breckenridge/drop-in?e2e=1";

declare global {
  interface Window {
    __descent?: {
      setAutopilot(on: boolean): void;
      setCourse(index: number): void;
      hud: { getState(): { phase: string; speedKmh: number; progress: number; style: number; courseName: string } };
      world: { courses: { name: string }[] };
    };
  }
}

test.describe("Drop In v3", () => {
  test.setTimeout(240_000);

  test("menu, trail map and controls card render over the live mountain", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('[data-descent-phase="menu"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: /ski now/i })).toBeVisible();
    await page.getByRole("button", { name: /trail map/i }).click();
    await expect(page.getByRole("listbox", { name: "Lines" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Lines" }).getByRole("option").first()).toContainText(/horseshoe bowl/i);
    await page.getByRole("button", { name: /controls/i }).click();
    await expect(page.getByRole("dialog")).toContainText(/carve & steer/i);
    await page.keyboard.press("Escape");
  });

  test("a free ski run drops in, follows Horseshoe Bowl and reaches the results card", async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('[data-descent-phase="menu"]')).toBeVisible({ timeout: 90_000 });
    await page.waitForFunction(() => Boolean(window.__descent));
    await page.getByRole("button", { name: /ski now/i }).click();
    await page.getByRole("button", { name: /drop in/i }).last().click();
    await expect(page.locator('[data-descent-phase="countdown"]')).toBeVisible();
    await expect(page.locator('[data-descent-phase="riding"]')).toBeVisible({ timeout: 10_000 });

    // Real held keys reach the sim: a tuck off the gate gets the rider moving.
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(3000);
    await page.keyboard.up("KeyW");
    const moving = await page.evaluate(() => window.__descent!.hud.getState().speedKmh);
    expect(moving).toBeGreaterThan(3);

    // Then the bot takes the line to the finish.
    await page.evaluate(() => window.__descent!.setAutopilot(true));
    await expect(page.locator("[data-descent-results]")).toBeVisible({ timeout: 180_000 });
    await expect(page.locator("[data-descent-results]")).toContainText(/horseshoe bowl/i);
    const hud = await page.evaluate(() => window.__descent!.hud.getState());
    expect(hud.progress).toBeGreaterThan(0.95);
    expect(hud.style).toBeGreaterThan(0);
  });
});
