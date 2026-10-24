import { test, expect, type Page } from "@playwright/test";

const fixture = "http://127.0.0.1:3119";
const STORAGE_KEY = "peakcam:lineup-intent:v2";
const BRECKENRIDGE = "00000000-0000-4000-8000-000000000001";
const ARAPAHOE = "00000000-0000-4000-8000-000000000002";
const LOVELAND = "00000000-0000-4000-8000-000000000003";
const PEAK_8_CAM = "10000000-0000-4000-8000-000000000001";

/**
 * The fixture server disables every analytics/ad id in its environment. This
 * route is a second, independent guard: if a tag ever starts loading in a
 * test, the request is recorded and aborted instead of reaching a real
 * destination.
 */
const ANALYTICS_HOSTS = [
  "posthog.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "doubleclick.net",
  "connect.facebook.net",
  "facebook.com",
  "redditstatic.com",
  "reddit.com",
  "bat.bing.com",
];
let externalAnalytics: string[] = [];

test.beforeEach(async ({ context }) => {
  externalAnalytics = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (ANALYTICS_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      externalAnalytics.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await context.request.get(`${fixture}/_test/reset`);
});

async function favorites(page: Page) {
  return (await (await page.request.get(`${fixture}/_test/favorites`)).json()) as Array<{
    item_id: string;
    item_type: string;
  }>;
}

async function requests(page: Page) {
  return (await (await page.request.get(`${fixture}/_test/requests`)).json()) as Array<{ method: string; path: string }>;
}

async function failFavoriteWrites(page: Page, count: number) {
  await page.request.post(`${fixture}/_test/fail-favorite-writes`, { data: { count } });
}

async function signedInLayout(favorites: Array<{ item_id: string; item_type: string }>) {
  return favorites
    .map((favorite) => `${favorite.item_type}:${favorite.item_id}`)
    .sort();
}

/** Seed the one-shot guest record exactly as another tab/session would leave it. */
async function seedIntent(
  page: Page,
  intent: {
    id: string;
    items: string[];
    userId?: string | null;
    source?: string;
    createdAt?: number;
    claim?: { token: string; startedAt: number } | null;
  },
) {
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: STORAGE_KEY,
      value: {
        version: 2,
        id: intent.id,
        items: intent.items.map((item_id) => ({ item_type: "resort", item_id })),
        source: intent.source ?? "hub_lineup",
        created_at: intent.createdAt ?? Date.now(),
        user_id: intent.userId ?? null,
        claim: intent.claim ? { token: intent.claim.token, started_at: intent.claim.startedAt } : null,
      },
    },
  );
}

async function signIn(page: Page, next = "/ski-cams/colorado") {
  await page.goto(`/auth?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address", { exact: true }).fill("fixture@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Fixture-password-2026");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  // Wait for the real destination, not any h1 (the auth page has one too) —
  // navigating away mid-request aborts the fixture session fetch.
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/]/g, "\\/")}$`));
  await expect(page.getByRole("heading", { level: 1, name: /Colorado ski resort webcams/ })).toBeVisible();
}

async function signInFromModal(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog.getByLabel("Email address", { exact: true }).fill("fixture@example.invalid");
  await dialog.getByLabel("Password", { exact: true }).fill("Fixture-password-2026");
  await dialog.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
}

async function openChooser(page: Page) {
  await page.getByRole("button", { name: "Choose my mountains", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose your mountains" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function selectMountain(dialog: ReturnType<Page["getByRole"]>, name: string) {
  // The native checkbox is sr-only and the label is the visible target (this is
  // also what a pointer user clicks); keyboard users reach the input directly.
  await dialog.locator("label").filter({ hasText: name }).first().click();
  await expect(dialog.getByRole("checkbox", { name: new RegExp(name) })).toBeChecked();
}

async function stageTwoMountains(page: Page) {
  const chooser = await openChooser(page);
  await selectMountain(chooser, "Breckenridge");
  await selectMountain(chooser, "Arapahoe Basin");
  await expect(chooser.getByText("2 of 8 selected")).toBeVisible();
  await chooser.getByRole("button", { name: "Save my mountains", exact: true }).click();
  const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
  await expect(auth.getByRole("heading", { name: "Save your 2 mountains." })).toBeVisible();
  return auth;
}

test("the Colorado hub leads with the free-account lineup and real cams before the table", async ({ page }) => {
  await page.goto("/ski-cams/colorado");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Colorado");
  const account = page.getByRole("region", { name: "Your mountains. One quick morning check." });
  await expect(account).toBeVisible();
  await expect(account.getByText("Keep your favorite Colorado webcams and snow reports together in a free dashboard.")).toBeVisible();
  await expect(account.getByRole("button", { name: "Choose my mountains", exact: true })).toBeVisible();
  await expect(account.getByText("Free account. No credit card.")).toBeVisible();
  await expect(account.getByRole("link", { name: /Powder alerts don’t need an account/ })).toBeVisible();

  // Powder alerts stay account-free and accessible as the secondary action.
  await expect(page.getByText(/Free, no account, one email per storm day/)).toBeVisible();

  // The real featured-cam strip moved above the long resort table.
  const featured = page.getByRole("heading", { name: "Featured cams", exact: true });
  const table = page.getByRole("heading", { name: /All 9 Colorado resorts/ });
  await expect(featured).toBeVisible();
  await expect(table).toBeVisible();
  const order = await page.evaluate(() => {
    const headings = [...document.querySelectorAll("h2")];
    const cams = headings.find((heading) => heading.textContent?.trim() === "Featured cams");
    const all = headings.find((heading) => heading.textContent?.includes("All 9 Colorado"));
    return { cams: cams?.getBoundingClientRect().top ?? 0, table: all?.getBoundingClientRect().top ?? 0 };
  });
  expect(order.cams).toBeGreaterThan(0);
  expect(order.cams).toBeLessThan(order.table);

  // Real cam buttons exist, nothing autoplays.
  await expect(page.getByRole("button", { name: /Load the live .* cam at/ })).toHaveCount(3);
  await expect(page.locator("iframe")).toHaveCount(0);

  // No analytics/ad tag loaded or tried to reach a real host.
  expect(externalAnalytics).toEqual([]);
  const tags = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      posthogLoaded: Boolean((w.posthog as { __loaded?: boolean } | undefined)?.__loaded),
      gtag: typeof w.gtag,
      fbq: typeof w.fbq,
      rdt: typeof w.rdt,
    };
  });
  expect(tags).toEqual({ posthogLoaded: false, gtag: "undefined", fbq: "undefined", rdt: "undefined" });
});

test("guest lineup survives a returning sign-in and is written once, idempotently", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  const auth = await stageTwoMountains(page);

  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(stored).toBeTruthy();
  const intent = JSON.parse(stored!) as { id: string; items: Array<{ item_type: string; item_id: string }> };
  expect(intent.id).toBeTruthy();
  expect(intent.items.map((item) => item.item_id).sort()).toEqual([BRECKENRIDGE, ARAPAHOE].sort());
  expect(intent.items.every((item) => item.item_type === "resort")).toBe(true);

  // Returning-user path inside the same modal: the intent must survive and the
  // bridge must add only the missing favourites after the session exists.
  await signInFromModal(auth);

  const toast = page.getByTestId("lineup-saved-toast");
  await expect(toast).toContainText("Saved 2 mountains to your account.");
  await expect(toast.getByRole("link", { name: "Open My Peak →" })).toBeVisible();
  await expect.poll(async () => (await favorites(page)).length).toBe(2);
  expect(await signedInLayout(await favorites(page))).toEqual([`resort:${BRECKENRIDGE}`, `resort:${ARAPAHOE}`].sort());
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();

  // A replay (reload, or the same intent in a second tab) cannot double-add.
  await page.reload();
  await expect(page.getByTestId("lineup-saved-toast")).toHaveCount(0);
  expect((await favorites(page)).length).toBe(2);
});

test("blocked storage is reported as blocked, with an account fallback and no private-browsing remedy", async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) throw new DOMException("blocked", "SecurityError");
      return original.call(this, name, value);
    };
  }, STORAGE_KEY);

  await page.goto("/ski-cams/colorado");
  const chooser = await openChooser(page);
  await selectMountain(chooser, "Breckenridge");
  await chooser.getByRole("button", { name: "Save my mountains", exact: true }).click();

  const alert = chooser.getByRole("alert");
  await expect(alert).toContainText("isn’t letting PeakCam keep your selection between pages");
  await expect(alert).not.toContainText("private browsing");
  await expect(page.getByRole("dialog", { name: "Create a free PeakCam account" })).toHaveCount(0);
  const fallback = chooser.getByRole("button", { name: "Create a free account anyway →" });
  await expect(fallback).toBeVisible();
  await fallback.click();

  const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
  await expect(auth).toBeVisible();
  await expect(auth).toContainText("isn’t letting PeakCam keep your selection between pages");
  await expect(page.getByText(/We’ll keep this mountain ready/)).toHaveCount(0);
});

test("signed-in saves are idempotent, and changing the selection after a success restores the save state", async ({ page }) => {
  await signIn(page);
  await page.goto("/ski-cams/colorado");

  let chooser = await openChooser(page);
  await selectMountain(chooser, "Breckenridge");
  await selectMountain(chooser, "Arapahoe Basin");
  await chooser.getByRole("button", { name: "Save my mountains", exact: true }).click();
  await expect(chooser.getByTestId("lineup-saved-inline")).toContainText("Saved 2 mountains to your account.");
  const firstWrites = (await requests(page)).filter(
    (request) => request.method === "POST" && request.path === "/rest/v1/user_favorites",
  ).length;
  expect(firstWrites).toBe(2);
  expect((await favorites(page)).length).toBe(2);

  // Editing the selection must not leave the earlier success card on screen
  // with no way to save the new one.
  await chooser.locator("label").filter({ hasText: "Loveland Ski Area" }).first().click();
  await expect(chooser.getByTestId("lineup-saved-inline")).toHaveCount(0);
  await expect(chooser.getByRole("button", { name: "Save my mountains", exact: true })).toBeVisible();
  await chooser.getByRole("button", { name: "Save my mountains", exact: true }).click();
  await expect(chooser.getByTestId("lineup-saved-inline")).toContainText("Saved 1 mountain to your account.");
  expect((await favorites(page)).length).toBe(3);
  expect(await signedInLayout(await favorites(page))).toEqual(
    [`resort:${BRECKENRIDGE}`, `resort:${ARAPAHOE}`, `resort:${LOVELAND}`].sort(),
  );

  // A repeat of the same selection is a no-op.
  await chooser.getByRole("button", { name: "Done", exact: true }).click();
  chooser = await openChooser(page);
  await chooser.getByRole("button", { name: "Save my mountains", exact: true }).click();
  await expect(chooser.getByTestId("lineup-saved-inline")).toContainText("Those mountains are already in your favorites.");
  const secondWrites = (await requests(page)).filter(
    (request) => request.method === "POST" && request.path === "/rest/v1/user_favorites",
  ).length;
  expect(secondWrites).toBe(firstWrites + 1);
});

test("the chooser is bounded at eight: the ninth mountain cannot be selected", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  const chooser = await openChooser(page);
  const boxes = chooser.getByRole("checkbox");
  await expect(boxes).toHaveCount(9);

  for (let index = 0; index < 8; index += 1) {
    await chooser.locator("label").nth(index).click();
    await expect(boxes.nth(index)).toBeChecked();
  }
  await expect(chooser.getByText("8 of 8 selected")).toBeVisible();
  // The ninth row is present but its checkbox is genuinely disabled; there is
  // no click path to a ninth selection.
  await expect(boxes.nth(8)).toBeDisabled();
  await expect(chooser.locator("label").nth(8)).toHaveAttribute("class", /cursor-not-allowed/);
  await expect(boxes.nth(8)).not.toBeChecked();
  await expect(chooser.getByText("8 of 8 selected")).toBeVisible();
});

test("keyboard reaches the chooser and Escape restores focus", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  await page.getByRole("button", { name: "Choose my mountains", exact: true }).focus();
  await page.keyboard.press("Enter");
  const chooser = page.getByRole("dialog", { name: "Choose your mountains" });
  await expect(chooser).toBeVisible();

  const first = chooser.getByRole("checkbox").first();
  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).toBeChecked();

  await page.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose my mountains", exact: true })).toBeFocused();
});

test("an email-confirmation link opened in a new tab finishes the lineup", async ({ page, context }) => {
  await page.goto("/ski-cams/colorado");
  await stageTwoMountains(page);

  const tab = await context.newPage();
  await tab.goto("/auth/callback?token_hash=fresh-confirm&type=signup&next=%2Fski-cams%2Fcolorado");

  await expect(tab).toHaveURL(/\/ski-cams\/colorado$/);
  await expect.poll(async () => (await favoriteCount(tab))).toBe(2);
  // Supabase shares the authenticated session with the original tab. Either
  // tab may claim the pending selection first; assert the persisted result
  // and the claimant's success message, rather than assuming a tab wins.
  await expect.poll(async () => {
    const notices = await Promise.all([page, tab].map((current) =>
      current.getByTestId("lineup-saved-toast").allTextContents(),
    ));
    return notices.flat().some((text) => text.includes("Saved 2 mountains to your account."));
  }).toBe(true);
  await expect(page.getByRole("dialog", { name: "Create a free PeakCam account" })).toHaveCount(0);
  expect(await signedInLayout(await favorites(tab))).toEqual([`resort:${BRECKENRIDGE}`, `resort:${ARAPAHOE}`].sort());
  expect(await tab.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  await tab.close();
});

async function favoriteCount(page: Page) {
  return (await favorites(page)).length;
}

test("Google OAuth continuation completes the lineup and clears the pending intent", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  const auth = await stageTwoMountains(page);

  await auth.getByTestId("google-sign-in").click();
  await expect(page).toHaveURL(/\/ski-cams\/colorado$/);
  const toast = page.getByTestId("lineup-saved-toast");
  await expect(toast).toContainText("Saved 2 mountains to your account.");
  expect(await signedInLayout(await favorites(page))).toEqual([`resort:${BRECKENRIDGE}`, `resort:${ARAPAHOE}`].sort());
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test("a failed save keeps the selection recoverable; retry succeeds and a reload does not replay it", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  const auth = await stageTwoMountains(page);
  await failFavoriteWrites(page, 1);

  await signInFromModal(auth);
  const error = page.getByTestId("lineup-save-error");
  await expect(error).toContainText("still in this browser");
  // Provider/runtime detail stays in the client, never in visitor-facing copy.
  await expect(error).not.toContainText("The fixture was asked to fail this insert.");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeTruthy();
  expect((await favorites(page)).length).toBe(0);

  await error.getByRole("button", { name: "Try again" }).click();
  const toast = page.getByTestId("lineup-saved-toast");
  await expect(toast).toContainText("Saved 2 mountains to your account.");
  await expect.poll(async () => (await favorites(page)).length).toBe(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();

  await page.reload();
  await expect(page.getByTestId("lineup-saved-toast")).toHaveCount(0);
  expect((await favorites(page)).length).toBe(2);
});

test("another tab's fresh claim is reclaimed after its lease expires", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await page.goto("/ski-cams/colorado");
  const startedAt = await page.evaluate(() => Date.now());
  // A claim a different tab wrote 1 ms ago. It is still fresh, so this tab
  // must back off — then reclaim it once the 30 s lease runs out.
  await seedIntent(page, {
    id: "intent-foreign-lease-01",
    items: [BRECKENRIDGE],
    claim: { token: "other-tab-token-0001", startedAt },
  });

  await signIn(page);
  await expect.poll(async () => (await favorites(page)).length).toBe(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeTruthy();

  await page.clock.fastForward(32_000);
  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 1 mountain to your account.");
  expect(await signedInLayout(await favorites(page))).toEqual([`resort:${BRECKENRIDGE}`]);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test("a newer selection left during an in-flight save is processed after it settles", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  await seedIntent(page, { id: "intent-old-inflight-01", items: [BRECKENRIDGE] });

  let releaseFirst: (() => void) | undefined;
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markEntered: (() => void) | undefined;
  const firstEntered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let posts = 0;
  await page.route("**/rest/v1/user_favorites*", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      if (posts === 1) {
        markEntered?.();
        await firstRelease;
      }
    }
    await route.continue();
  });

  await signIn(page);
  await firstEntered;
  // The old write is still waiting; a newer selection replaces the shared
  // record with a different id and must survive the old success clear.
  await seedIntent(page, { id: "intent-new-inflight-02", items: [ARAPAHOE] });
  releaseFirst?.();

  await expect
    .poll(async () => signedInLayout(await favorites(page)))
    .toEqual([`resort:${BRECKENRIDGE}`, `resort:${ARAPAHOE}`].sort());
  await expect
    .poll(async () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBeNull();
  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 1 mountain to your account.");
});

test("a completed attempt does not block a new intent after sign-out and sign-in", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  await seedIntent(page, { id: "intent-first-cycle-01", items: [BRECKENRIDGE] });
  await signIn(page);
  const firstToast = page.getByTestId("lineup-saved-toast");
  await expect(firstToast).toContainText("Saved 1 mountain to your account.");
  expect(await signedInLayout(await favorites(page))).toEqual([`resort:${BRECKENRIDGE}`]);

  // Dismiss the fixed success toast first: at iPhone width it overlaps the
  // bottom of the open menu, where Sign out lives.
  await firstToast.getByRole("button", { name: "Dismiss saved-mountains message" }).click();
  await expect(firstToast).toHaveCount(0);

  // Sign out through the shared header, leave a new selection, then sign back
  // in as the same account without remounting the provider-level bridge.
  await page.evaluate(() => Reflect.set(window, "__lineupDocumentMarker", "same-document"));
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page.getByRole("button", { name: /^Sign out/ }).click();
  await expect(page.getByRole("link", { name: "Create free account", exact: true })).toBeVisible();

  await seedIntent(page, { id: "intent-second-cycle-02", items: [ARAPAHOE] });
  await page.getByRole("link", { name: "Create free account", exact: true }).click();
  await page.locator('[aria-label="Account options"]').getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill("fixture@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("Fixture-password-2026");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/ski-cams\/colorado$/);
  expect(await page.evaluate(() => Reflect.get(window, "__lineupDocumentMarker"))).toBe("same-document");
  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 1 mountain to your account.");
  await expect
    .poll(async () => signedInLayout(await favorites(page)))
    .toEqual([`resort:${BRECKENRIDGE}`, `resort:${ARAPAHOE}`].sort());
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test("an intent bound to another account shows an actionable mismatch and writes nothing", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  await seedIntent(page, {
    id: "intent-other-user-01",
    items: [BRECKENRIDGE],
    userId: "22222222-2222-4222-8222-222222222222",
  });
  await signIn(page);

  const error = page.getByTestId("lineup-save-error");
  await expect(error).toContainText("saved for a different account");
  await expect(error.getByRole("link", { name: "Switch account" })).toHaveAttribute("href", "/account");
  expect((await favorites(page)).length).toBe(0);
  expect(
    (await requests(page)).filter(
      (request) => request.method === "POST" && request.path === "/rest/v1/user_favorites",
    ),
  ).toEqual([]);
});

test("an expired intent is never replayed", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  await page.evaluate(
    ({ key, past }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          id: "intent-stale-0001",
          items: [{ item_type: "resort", item_id: "00000000-0000-4000-8000-000000000001" }],
          source: "hub_lineup",
          created_at: past,
          user_id: null,
          claim: null,
        }),
      );
    },
    { key: STORAGE_KEY, past: Date.now() - 31 * 24 * 60 * 60 * 1000 },
  );

  await signIn(page);
  await expect(page.getByTestId("lineup-saved-toast")).toHaveCount(0);
  await expect(page.getByTestId("lineup-save-error")).toHaveCount(0);
  expect((await favorites(page)).length).toBe(0);
  await expect
    .poll(async () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBeNull();
});

test("blocked storage on a returning sign-in is ignored without a phantom save", async ({ page }) => {
  await page.addInitScript((key) => {
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name: string) {
      if (name === key) throw new DOMException("blocked", "SecurityError");
      return originalGet.call(this, name);
    };
  }, STORAGE_KEY);

  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: /Colorado ski resort webcams/ })).toBeVisible();
  await expect(page.getByTestId("lineup-saved-toast")).toHaveCount(0);
  expect((await favorites(page)).length).toBe(0);
});

test("the resort hero save persists the clicked mountain, not a generic item", async ({ page }) => {
  await page.goto("/resorts/breckenridge");
  const save = page.getByRole("button", { name: "Save Breckenridge to your mountains" });
  await expect(save).toBeVisible();
  await save.click();

  const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
  await expect(auth.getByRole("heading", { name: "Save Breckenridge." })).toBeVisible();
  await expect(auth).toContainText("We’ll keep this mountain ready in this browser");
  await signInFromModal(auth);

  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 1 mountain to your account.");
  expect(await signedInLayout(await favorites(page))).toEqual([`resort:${BRECKENRIDGE}`]);
});

test("a clicked camera is saved as that camera after auth", async ({ page }) => {
  await page.goto("/resorts/breckenridge");
  const save = page.getByRole("button", { name: "Save Peak 8 Summit to your saved cameras" });
  await expect(save).toBeVisible();
  await save.click();

  const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
  await expect(auth.getByRole("heading", { name: "Save Peak 8 Summit." })).toBeVisible();
  await expect(auth).toContainText("We’ll keep this camera ready in this browser");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).source, STORAGE_KEY)).toBe("cam_save");
  await signInFromModal(auth);

  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 1 camera to your account.");
  expect(await signedInLayout(await favorites(page))).toEqual([`cam:${PEAK_8_CAM}`]);
});

test("a browse-card save persists that card's resort after auth", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-resort-slug="breckenridge"]').first();
  await card.getByRole("button", { name: "Add Breckenridge to favorites" }).click();

  const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
  await expect(auth.getByRole("heading", { name: "Save Breckenridge." })).toBeVisible();
  await signInFromModal(auth);

  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 1 mountain to your account.");
  expect(await signedInLayout(await favorites(page))).toEqual([`resort:${BRECKENRIDGE}`]);
});

test("an alert selection larger than eight is preserved in full, not truncated", async ({ page }) => {
  await page.goto("/ski-cams/colorado");
  await page.getByRole("button", { name: "Get Colorado powder alerts" }).click();
  const alertDialog = page.getByRole("dialog", { name: "Get powder alerts" });
  await expect(alertDialog.getByText("Alerts for 9 mountains")).toBeVisible();

  await alertDialog.getByLabel("Email address").fill("fixture@example.invalid");
  await alertDialog.getByRole("button", { name: "Activate alerts" }).click();
  await expect(alertDialog.getByRole("heading", { name: "You’re subscribed." })).toBeVisible();
  await alertDialog.getByRole("button", { name: "Create a free account to save them →" }).click();

  const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
  await expect(auth.getByRole("heading", { name: "Save your 9 mountains." })).toBeVisible();
  await expect(auth).toContainText("We’ll keep these 9 mountains ready in this browser");
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect((JSON.parse(stored!) as { items: unknown[] }).items).toHaveLength(9);

  await signInFromModal(auth);
  await expect(page.getByTestId("lineup-saved-toast")).toContainText("Saved 9 mountains to your account.");
  await expect.poll(async () => (await favorites(page)).length).toBe(9);
});

for (const width of [320, 768, 1024, 1440]) {
  test(`the chooser and auth modal fit at ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ski-cams/colorado");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const chooser = await openChooser(page);
    const chooserBox = await chooser.boundingBox();
    expect(chooserBox).not.toBeNull();
    expect(chooserBox!.x).toBeGreaterThanOrEqual(0);
    expect(chooserBox!.x + chooserBox!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await selectMountain(chooser, "Breckenridge");
    await chooser.getByRole("button", { name: "Save my mountains", exact: true }).click();

    const auth = page.getByRole("dialog", { name: "Create a free PeakCam account" });
    await expect(auth.getByRole("heading", { name: "Save Breckenridge." })).toBeVisible();
    const authBox = await auth.boundingBox();
    expect(authBox).not.toBeNull();
    expect(authBox!.x).toBeGreaterThanOrEqual(0);
    expect(authBox!.x + authBox!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
  });
}

for (const width of [320, 768, 1024, 1440]) {
  test(`shared header exposes both account entries without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ski-cams/colorado");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Signed out, "Create free account" is visible without opening the menu at
    // every width — including the 320px phone header beside the menu button.
    await expect(page.getByRole("link", { name: "Create free account", exact: true })).toHaveCount(1);

    if (width >= 1024) {
      await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    } else {
      // Sign-in stays in the menu, and opening it must not duplicate the
      // visible create-account entry.
      await page.getByRole("button", { name: "Toggle menu" }).click();
      await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Create free account", exact: true })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Escape");
    }

    // The primary entry opens signup mode; the secondary keeps sign-in mode.
    await page.goto("/ski-cams/colorado");
    await page.getByRole("link", { name: "Create free account", exact: true }).click();
    await expect(page).toHaveURL(/mode=signup/);
    await expect(
      page.locator('[aria-label="Account options"]').getByRole("button", { name: "Sign up", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.goto("/ski-cams/colorado");
    if (width < 1024) await page.getByRole("button", { name: "Toggle menu" }).click();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/auth(?:\?next=[^&]+)?$/);
    await expect(
      page.locator('[aria-label="Account options"]').getByRole("button", { name: "Sign in", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("at 320x700 the signup CTA is in the first screen and the long intro follows it", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/ski-cams/colorado");

  // The exact SEO H1 and the existing introduction both stay on the page.
  await expect(page.getByRole("heading", { level: 1, exact: true })).toHaveText(
    "Colorado ski resort webcams & snow report",
  );
  const intro = page.getByText(/Every Colorado resort PeakCam tracks/);
  await expect(intro).toContainText("Snow data refreshes every six hours.");

  const account = page.getByRole("region", { name: "Your mountains. One quick morning check." });
  const cta = account.getByRole("button", { name: "Choose my mountains", exact: true });
  const ctaBox = await cta.boundingBox();
  expect(ctaBox).not.toBeNull();
  // Real bounds, not just CSS visibility: the primary CTA must be inside the
  // 320x700 first screen with no scrolling.
  expect(ctaBox!.y).toBeGreaterThanOrEqual(0);
  expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(700);
  expect(ctaBox!.width).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // The long ranking introduction moved below the account benefit, not
  // between the H1 and the CTA.
  const accountBox = await account.boundingBox();
  const introBox = await intro.boundingBox();
  expect(accountBox).not.toBeNull();
  expect(introBox).not.toBeNull();
  expect(introBox!.y).toBeGreaterThan(accountBox!.y + accountBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The CTA remains keyboard reachable.
  await cta.focus();
  await page.keyboard.press("Space");
  const chooser = page.getByRole("dialog", { name: "Choose your mountains" });
  await expect(chooser).toBeVisible();
  const choices = chooser.locator("label");
  for (let index = 0; index < 8; index += 1) await choices.nth(index).click();
  const save = chooser.getByRole("button", { name: "Save my mountains", exact: true });
  await expect(save).toBeEnabled();
  const saveBox = await save.boundingBox();
  const chooserBox = await chooser.boundingBox();
  expect(saveBox).not.toBeNull();
  expect(chooserBox).not.toBeNull();
  expect(saveBox!.y).toBeGreaterThanOrEqual(chooserBox!.y);
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(chooserBox!.y + chooserBox!.height);
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(700);
  expect(await chooser.evaluate((dialog) => dialog.scrollTop)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose your mountains" })).toHaveCount(0);
  await expect(cta).toBeFocused();
});

test("the header still frees up space on a search-bearing page at 1024px", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: "Create free account", exact: true })).toBeVisible();
});
