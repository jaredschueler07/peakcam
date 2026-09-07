import { expect, test } from "@playwright/test";
import type { DropInDebugApi } from "../../lib/game/runtime/e2e-debug";

test("snow selection reaches the real solver, and snowboard ollies and grabs respond to hold/release", async ({ page }) => {
  for (const surface of ["powder", "packed", "ice", "slush"]) {
    await page.goto("/resorts/heavenly/drop-in?gfx=webgl&e2edebug=1");
    await page.getByLabel("Rider mode").selectOption("snowboarder");
    await page.getByLabel("Snowboard stance").selectOption("goofy");
    await page.getByLabel("Snow surface").selectOption(surface);
    await page.getByRole("button", { name: /start descent/i }).click();
    await page.waitForFunction(() => Boolean((window as typeof window & { __dropInDebug: DropInDebugApi }).__dropInDebug), { timeout: 90000 });
    const config = await page.evaluate(() => (window as typeof window & { __dropInDebug: DropInDebugApi }).__dropInDebug!.snapshot());
    expect(config).toMatchObject({ surface, riderMode: "snowboarder", stance: "goofy", ranked: false });
    const pose = await page.evaluate(() => {
      const api = (window as typeof window & { __dropInDebug: DropInDebugApi }).__dropInDebug!;
      api.selectRun(0);
      api.stepTicks(48, { jumpHeld: true });
      const charged = api.snapshot();
      api.stepTicks(1);
      const popped = api.snapshot();
      api.stepTicks(12, { jumpHeld: true, steer: .4 });
      const grabbed = api.snapshot();
      api.stepTicks(1);
      return { charged, popped, grabbed, released: api.snapshot() };
    });
    expect(pose.charged).toMatchObject({ jumpCharge: .4 });
    expect(pose.popped).toMatchObject({ onGround: false, jumpCharge: 0 });
    expect(pose.grabbed).toMatchObject({ grabbing: true });
    expect(pose.released).toMatchObject({ grabbing: false });
  }
});
