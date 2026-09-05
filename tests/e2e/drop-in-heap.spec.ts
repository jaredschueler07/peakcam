import { expect, test } from "@playwright/test";

/**
 * Zero-allocation frame path guard (P11 Task 8).
 *
 * Chromium must be launched with `--js-flags=--expose-gc` so `window.gc()` is
 * available (see the `chromium-heap` project in playwright.config.ts). After a
 * warm-up play window and two forced GCs, heap growth over a second 10s active
 * play window must stay under 2 MB — retained growth means a per-frame leak.
 */

const V2_URL = "/resorts/heavenly/drop-in";
const HEAP_GROWTH_BUDGET_BYTES = 2 * 1024 * 1024;
const PLAY_MS = 10_000;

test.use({
  launchOptions: {
    args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
  },
});

declare global {
  interface Performance {
    memory?: { usedJSHeapSize: number };
  }
  interface Window {
    gc?: () => void;
  }
}

/** Hold descent inputs the same way `drop-in.spec.ts` exercises the keyboard path. */
async function holdActivePlay(
  page: import("@playwright/test").Page,
  durationMs: number,
): Promise<void> {
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(durationMs);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowDown");
}

async function forceGc(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    if (typeof window.gc !== "function") {
      throw new Error("window.gc is unavailable — launch Chromium with --js-flags=--expose-gc");
    }
    window.gc();
    window.gc();
  });
}

async function usedHeap(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const memory = performance.memory;
    if (!memory || typeof memory.usedJSHeapSize !== "number") {
      throw new Error("performance.memory.usedJSHeapSize unavailable");
    }
    return memory.usedJSHeapSize;
  });
}

test("active play retains under 2 MB of JS heap over 10s after GC", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(V2_URL);
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running'] canvas[data-testid='drop-in-canvas']")).toBeVisible();

  // Warm-up: let the first-frame terrain/post-processing settle, then sample.
  await holdActivePlay(page, PLAY_MS);
  await forceGc(page);
  const baseline = await usedHeap(page);

  await holdActivePlay(page, PLAY_MS);
  await forceGc(page);
  const after = await usedHeap(page);

  const growth = after - baseline;
  console.log(
    `drop-in heap baseline=${baseline} after=${after} growth=${growth} budget=${HEAP_GROWTH_BUDGET_BYTES}`,
  );
  expect(growth, `heap grew ${growth} bytes (budget ${HEAP_GROWTH_BUDGET_BYTES})`).toBeLessThan(
    HEAP_GROWTH_BUDGET_BYTES,
  );
});
