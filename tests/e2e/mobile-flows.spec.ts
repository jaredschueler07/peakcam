import { test, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("favorite sign-in uses the account form and restores focus", async ({ page }) => {
  await page.goto("/");
  const favorite = page.locator('[data-resort-slug="vail"]').getByRole("button", { name: /favorite/i });
  await favorite.click();
  const dialog = page.getByRole("dialog", { name: "Sign in to PeakCam" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Forgot password?" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 420 });
  await dialog.getByRole("button", { name: "Email me a sign-in link instead" }).click();
  await expect(dialog.getByRole("button", { name: "Email sign-in link", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(favorite).toBeFocused();
});

test("panorama previews preserve the full frame and detail video waits for a tap", async ({ page }) => {
  await page.goto("/");
  const image = page.locator('[data-resort-slug="aspen-snowmass"] img').first();
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveCSS("object-fit", "contain");
  await page.goto("/resorts/breckenridge");
  await expect(page.locator("iframe")).toHaveCount(0);
  const camera = page.locator("#cameras");
  await camera.getByRole("button", { name: /Main Street.*Tap to load live cam/i }).click();
  await expect(camera.locator("iframe")).toHaveCount(1);
});

test("snow report region picker and map layers reduce persistent controls", async ({ page }) => {
  await page.goto("/snow-report");
  const region = page.getByRole("combobox", { name: "State or country" });
  await region.selectOption("CO");
  await expect(region).toHaveValue("CO");
  await page.goto("/map");
  await page.getByRole("button", { name: /^Layers/ }).click();
  const dialog = page.getByRole("dialog", { name: "Map layers" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Satellite", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Satellite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Layers.*satellite/ })).toBeFocused();
});

test("mobile dashboard reordering saves the new order and keeps it after finishing", async ({ page }) => {
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "fixture@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "test-signature"].join(".");
  const session = { access_token: token, refresh_token: "test-refresh-token", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user };
  const cookie = `sb-${project}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}; path=/; SameSite=Lax`;
  await page.addInitScript(value => { document.cookie = value; }, cookie);
  const resorts = ["First Mountain", "Second Mountain"].map((name, i) => ({ id: `mountain-${i}`, slug: `mountain-${i}`, name, state: "Colorado", region: "Rockies", is_active: true }));
  let saved = resorts.map((resort, i) => ({ id: resort.id, type: "resort", x: i * 3, y: 0, w: 3, h: 2 }));
  await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", async route => {
    const table = new URL(route.request().url()).pathname.split("/").pop();
    if (table === "dashboard_layouts") {
      if (route.request().method() === "POST") { saved = route.request().postDataJSON().config.widgets; await route.fulfill({ status: 201, json: {} }); }
      else await route.fulfill({ json: { user_id: user.id, config: { widgets: saved } } });
    } else if (table === "user_favorites") await route.fulfill({ json: resorts.map(resort => ({ user_id: user.id, item_id: resort.id, item_type: "resort" })) });
    else if (table === "resorts") await route.fulfill({ json: resorts });
    else await route.fulfill({ json: [] });
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "First Mountain", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Customize layout", exact: true }).click();
  await page.getByRole("button", { name: "Move down", exact: true }).first().click();
  await expect.poll(() => saved[0]?.id).toBe("mountain-1");
  await page.getByRole("button", { name: "Finish editing", exact: true }).click();
  const names = page.locator('section h3').filter({ hasText: /Mountain/ });
  await expect(names).toHaveText(["Second Mountain", "First Mountain"]);
});
