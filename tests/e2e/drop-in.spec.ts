import { expect, test } from "@playwright/test";
import { GHOST_SAMPLE_HZ } from "../../lib/game/replay/recorder";

const V2_URL = "/resorts/heavenly/drop-in?engine=v2";

/**
 * Every drop-in URL goes through here so the backend is pinned per project rather than copied into
 * each spec. The default (headless) project must use WebGL: headless Chromium serves a SwiftShader
 * WebGPU adapter that renders the canvas black, so the pixel-reading specs would fail on the
 * harness rather than the code. `chromium-webgpu` is the headed project that exercises the
 * production default on real hardware.
 */
function dropInUrl(path: string): string {
  const gfx = test.info().project.name === "chromium-webgpu" ? "webgpu" : "webgl";
  return path + (path.includes("?") ? "&" : "?") + "gfx=" + gfx;
}

/**
 * Mean/stdev luminance of the centre quarter of the game canvas.
 *
 * The renderer runs with `preserveDrawingBuffer: false`, so a WebGL drawing
 * buffer only holds pixels between the draw call and the next composite. The
 * previous implementation went `toDataURL()` → `new Image()` → `await decode()`
 * → `drawImage`, and every one of those awaits crosses a frame boundary: by the
 * time it sampled, the buffer had been cleared and it read all-zeros. That is
 * why this spec failed while the scene rendered perfectly on screen.
 *
 * The copy must therefore be synchronous and inside a rAF callback. The game
 * re-registers its own rAF each frame, so a callback registered here is queued
 * behind the one that draws: it runs after that frame's draw and before the
 * composite that discards it — the one window where the pixels exist.
 */
async function canvasLuminance(page: import("@playwright/test").Page) {
  return page.locator("canvas[data-testid='drop-in-canvas']").evaluate(
    (canvas: HTMLCanvasElement) =>
      new Promise<{ mean: number; stdev: number }>((resolve, reject) => {
        requestAnimationFrame(() => {
          try {
            const width = Math.floor(canvas.width * 0.5);
            const height = Math.floor(canvas.height * 0.5);
            const scratch = document.createElement("canvas");
            scratch.width = width;
            scratch.height = height;
            const context = scratch.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("2D canvas unavailable");
            // Straight from the live canvas — no encode/decode round-trip.
            context.drawImage(
              canvas,
              canvas.width * 0.25, canvas.height * 0.25, width, height,
              0, 0, width, height,
            );
            const pixels = context.getImageData(0, 0, width, height).data;
            let sum = 0, sumSquares = 0, count = 0;
            for (let index = 0; index < pixels.length; index += 4) {
              const luminance =
                pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
              sum += luminance; sumSquares += luminance * luminance; count += 1;
            }
            const mean = sum / count;
            resolve({ mean, stdev: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) });
          } catch (reason) {
            reject(reason instanceof Error ? reason : new Error(String(reason)));
          }
        });
      }),
  );
}

test("v2 renders a keyboard start control without an iframe", async ({ page }) => {
  await page.goto(dropInUrl(V2_URL));
  await expect(page.getByRole("button", { name: /start descent/i })).toBeVisible();
  const stamp = page.getByTestId("drop-in-conditions-stamp");
  await expect(stamp).toBeVisible();
  // `snow_reports.conditions` is "tag1,tag2||narrative"; the poster used to
  // print it raw, so Heavenly read "BLUEBIRD||EXPECT CLEAR BLUEBIRD SKIES".
  await expect(stamp).not.toContainText("||");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("the running game reports the backend this project exists to exercise", async ({ page }) => {
  // Without this the matrix is theatre: a WebGPU device-init failure falls back to WebGL silently,
  // so the headed project would pass while testing the same renderer as the default one.
  // `data-drop-in-gfx` is set from the runtime that actually initialised, not from navigator.gpu.
  const expected = test.info().project.name === "chromium-webgpu" ? "webgpu" : "webgl";
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(page.locator(`[data-drop-in-gfx='${expected}']`)).toHaveCount(1);
});

test("the start poster offers the three run modes, defaulting to Free Ski", async ({ page }) => {
  await page.goto(dropInUrl(V2_URL));
  const modes = page.getByTestId("drop-in-mode-select");
  await expect(modes).toBeVisible();
  await expect(modes.getByRole("radio", { name: /free ski/i })).toHaveAttribute("aria-checked", "true");
  await expect(modes.getByRole("radio", { name: /time trial/i })).toHaveAttribute("aria-checked", "false");
  await expect(modes.getByRole("radio", { name: /daily line/i })).toHaveAttribute("aria-checked", "false");
  // The Daily Line card names its course. Deliberately no date beside it: only
  // the seed rotates daily, and a date here read as a rotating trail.
  await expect(page.getByTestId("daily-line-course")).toHaveText("Gunbarrel");
  await expect(page.getByTestId("daily-line-course")).not.toContainText(/\d{4}-\d{2}-\d{2}/);
});

test("Free Ski starts a run without ever calling the sessions API", async ({ page }) => {
  let sessionCalls = 0;
  await page.route("**/api/drop-in/sessions", (route) => { sessionCalls += 1; return route.abort(); });
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("radio", { name: /free ski/i }).click();
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(page.locator("[data-drop-in-session='local']")).toHaveCount(1);
  expect(sessionCalls).toBe(0);
});

test("phys=v2 boots, advances the HUD, and stays out of a crash loop", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(dropInUrl(`${V2_URL}&phys=v2`));
  await page.getByRole("button", { name: /start descent/i }).click();

  const shell = page.locator("[data-drop-in-state='running'][data-drop-in-physics='v2']");
  await expect(shell).toBeVisible();
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => {
    const value = await page.getByTestId("drop-in-speedometer").locator("span").first().textContent();
    return Number(value);
  }).toBeGreaterThan(0);
  await page.keyboard.up("ArrowUp");

  await page.waitForTimeout(750);
  await expect(shell).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a ticketed competitive run starts and reports itself submittable", async ({ page }) => {
  await page.route("**/api/drop-in/sessions", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ticket: "hdr.payload.sig",
        seed: 987654321,
        resortSlug: body.resortSlug,
        mode: body.mode,
        trailId: body.trailId,
        surface: body.surface,
        physicsModel: body.physicsModel,
        physicsVersion: 1,
        courseVersion: 1,
        tickHz: 10,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    });
  });
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("radio", { name: /daily line/i }).click();
  await expect(page.locator("[data-drop-in-session='ticketed']")).toHaveCount(1);
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(page.locator("[data-drop-in-session='ticketed'][data-drop-in-mode='score_attack']")).toHaveCount(1);
  await expect(page.getByTestId("drop-in-session-notice")).toHaveCount(0);
});

test("a run started before its ticket arrives stays offline, and never claims to be ticketed", async ({ page }) => {
  // Regression: the run is seeded from profile.seed because no ticket existed
  // at start, so a ticket landing mid-run cannot make it submittable. Reporting
  // "ticketed" here would advertise a run the server must reject.
  //
  // The ordering is enforced, not timed. The response is held open until the
  // run is already going, then released explicitly. A sleep-based version could
  // pass for the wrong reason — if the delay outlasted the wait, the assertion
  // would see "offline" merely because the ticket never arrived, and the guard
  // would have stopped guarding without failing.
  let releaseTicket!: () => void;
  const ticketHeld = new Promise<void>((resolve) => { releaseTicket = resolve; });
  let sawRequest!: () => void;
  const ticketRequested = new Promise<void>((resolve) => { sawRequest = resolve; });

  await page.route("**/api/drop-in/sessions", async (route) => {
    sawRequest();
    await ticketHeld;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ticket: "late.arrival.sig",
        seed: 987654321,
        resortSlug: "heavenly",
        mode: "time_trial",
        trailId: "gunbarrel",
        surface: "packed",
        physicsModel: "v1",
        physicsVersion: 1,
        courseVersion: 1,
        tickHz: 10,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    });
  });

  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("radio", { name: /time trial/i }).click();
  await ticketRequested;
  const shell = page.locator("[data-drop-in-state]");
  await expect(shell).toHaveAttribute("data-drop-in-session", "pending");

  // Start while the ticket is still held: this run is seeded locally. The
  // request is genuinely still in flight here, so "pending" is the honest
  // state — what matters is that it is not yet, and never becomes, "ticketed".
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(shell).toHaveAttribute("data-drop-in-session", "pending");

  releaseTicket();

  // Waiting on the *shell's* ticket state proves the response was received and
  // processed — the positive signal a bare "still offline" assertion lacks,
  // since that is already true and would pass before the ticket landed.
  await expect(shell).toHaveAttribute("data-drop-in-ticket", "ready");
  await expect(shell).toHaveAttribute("data-drop-in-session", "offline");
});

test("a failed session request degrades to offline play instead of blocking the run", async ({ page }) => {
  await page.route("**/api/drop-in/sessions", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "nope" }) }));
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("radio", { name: /time trial/i }).click();
  await expect(page.getByTestId("drop-in-session-notice")).toContainText(/playing offline/i);
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(page.locator("[data-drop-in-session='offline'][data-drop-in-mode='time_trial']")).toHaveCount(1);
});

test("the HUD audio toggle reflects and changes its pressed state", async ({ page }) => {
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("button", { name: /start descent/i }).click();
  const audio = page.getByRole("button", { name: /mute audio/i });
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await audio.click();
  await expect(page.getByRole("button", { name: /unmute audio/i })).toHaveAttribute("aria-pressed", "false");
});

test("[gate] play → submit → board: a finished run posts and appears on the leaderboard", async ({ page }) => {
  test.setTimeout(120_000);

  const TICKET_SEED = 4242;
  const RUN_ID = "11111111-2222-3333-4444-555555555555";
  const NICKNAME = "GateBot";
  let submittedBody: Record<string, unknown> | null = null;

  await page.route("**/api/drop-in/sessions", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ticket: "gate.ticket.sig",
        seed: TICKET_SEED,
        resortSlug: "ski-portillo",
        mode: "time_trial",
        trailId: "roca-jack",
        surface: "packed",
        physicsModel: "v1",
        physicsVersion: 1,
        courseVersion: 1,
        tickHz: 10,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    }));

  await page.route("**/api/drop-in/runs", (route) => {
    submittedBody = JSON.parse(route.request().postData() ?? "{}");
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        runId: RUN_ID,
        accepted: true,
        timeMs: 42_000,
        score: 2864,
        mode: "time_trial",
        trailId: "roca-jack",
        physicsVersion: 1,
        courseVersion: 1,
        displayName: NICKNAME,
      }),
    });
  });

  await page.route("**/api/drop-in/leaderboard**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        resortSlug: "ski-portillo",
        mode: "time_trial",
        trailId: "roca-jack",
        physicsVersion: 1,
        courseVersion: 1,
        rows: [{
          id: RUN_ID,
          rank: 1,
          mode: "time_trial",
          trailId: "roca-jack",
          timeMs: 42_000,
          score: 2864,
          physicsVersion: 1,
          courseVersion: 1,
          displayName: NICKNAME,
          isSelf: true,
          hasGhost: true,
          finishedAt: new Date().toISOString(),
        }],
      }),
    }));

  // ?e2espawn=-40 starts the descent 40 m before the finish (negative counts
  // back from the end, so no course length is hardcoded here). A hands-off run
  // from the top cannot reach the finish gate — it leaves the run corridor and
  // courseProgress stalls — but from here it crosses the line under real
  // physics, producing real recorder samples. Nothing about the finish is
  // faked, and the resulting ghost is refused by the server validator's
  // start-zone and minimum-distance checks.
  await page.goto(dropInUrl("/resorts/ski-portillo/drop-in?engine=v2&e2espawn=-40"));
  await page.getByRole("radio", { name: /time trial/i }).click();

  const shell = page.locator("[data-drop-in-state]");
  await expect(shell).toHaveAttribute("data-drop-in-session", "ticketed");
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(shell).toHaveAttribute("data-drop-in-session", "ticketed");

  // Ski hands-off to the natural finish. Headless runs at roughly a third of
  // realtime, so this budget is wall-clock, not sim-clock.
  await expect(page.getByTestId("drop-in-results")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("drop-in-submit-card")).toBeVisible();

  await page.locator("#drop-in-nickname").fill(NICKNAME);
  await page.getByTestId("drop-in-submit").click();

  await expect(page.getByTestId("drop-in-submit-result")).toBeVisible();
  await expect(page.getByTestId("drop-in-leaderboard")).toBeVisible();
  await expect(page.getByTestId("drop-in-placement")).toContainText(/you placed/i);
  await expect(page.getByTestId("drop-in-leaderboard")).toContainText(NICKNAME);

  // Guard against a vacuous pass: the submission has to carry the ticket the
  // run was seeded from AND a real recorded ghost, or this would only be
  // asserting that mocked routes return what they were told to.
  expect(submittedBody).not.toBeNull();
  const body = submittedBody as unknown as Record<string, unknown>;
  expect(body.ticket).toBe("gate.ticket.sig");
  expect(typeof body.ghost).toBe("string");
  expect((body.ghost as string).length).toBeGreaterThan(64);
  // NB: the client reads this from the ghost header (GHOST_SAMPLE_HZ = 30), not
  // from the ticket — the sessions route advertises tickHz: 10. See the note to
  // the lead; asserting the constant rather than a literal so this spec tracks
  // whichever value the recorder actually writes.
  expect(body.tickHz).toBe(GHOST_SAMPLE_HZ);
  // The ghost's duration comes from its own keyframe span, so a non-zero time
  // means the recorder actually captured the descent.
  expect(body.timeMs as number).toBeGreaterThan(0);
});

test("the default engine remains the v1 iframe", async ({ page }) => {
  await page.goto("/resorts/heavenly/drop-in");
  await expect(page.locator("iframe[title*='Drop In']")).toHaveCount(1);
});

test("an unsupported resort shows not-found and never mounts the game", async ({ page }) => {
  // KNOWN ISSUE (pre-existing, site-wide, tracked for Phase 10 hardening):
  // notFound() pages currently stream with HTTP 200 (soft-404) — confirmed on
  // production /resorts/<bad-slug> too, so it is not a v2 regression. Assert
  // on behavior until the status bug is fixed, then tighten to toBe(404).
  const response = await page.goto("/resorts/not-a-resort/drop-in?engine=v2");
  expect([200, 404]).toContain(response?.status() ?? 0);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /start descent/i })).toHaveCount(0);
});

test("keyboard-only start reaches a running canvas with a ticking HUD", async ({ page }) => {
  await page.goto(dropInUrl(V2_URL));
  const heightfieldRequest = page.waitForRequest((request) =>
    request.url().endsWith("/game/terrain/heavenly.height.u16.br"));
  // Enter may land before hydration attaches the poster's key listener —
  // keep pressing until the shell reacts. Still exercises keyboard-only start.
  await expect
    .poll(async () => {
      await page.keyboard.press("Enter");
      return page.locator("[data-drop-in-state]").getAttribute("data-drop-in-state");
    })
    .not.toBe("poster");
  await expect(page.locator("[data-drop-in-state='running'] canvas[data-testid='drop-in-canvas']")).toBeVisible();
  await heightfieldRequest;
  const first = await page.getByText(/\d+\.\d+s/).first().textContent();
  await expect.poll(async () => page.getByText(/\d+\.\d+s/).first().textContent()).not.toBe(first);
});

/**
 * Per-resort brightness ceilings, and one shared contrast floor.
 *
 * A washout is high mean AND low stdev — losing structure, not merely being
 * bright — so `stdev` is the real detector and the mean cap is the secondary
 * one. Both are per-resort because the resorts genuinely differ at this sample
 * point, and a floor calibrated on one of them fails the others: a single
 * stdev>28 rule rejects healthy Portillo (27.6) and Breckenridge (25.2) frames
 * while only Heavenly (33.7) clears it.
 *
 * All six numbers are EMPIRICAL, measured on a healthy build (see each line)
 * and set with headroom — they are not design targets. A real washout collapses
 * stdev toward single digits, far below even the loosest floor here.
 * Re-measure before tightening; do not tune these to make a red test green.
 *
 * RE-MEASURED after the P11 Task 6 CSM fixes (5 runs, default project, WebGL):
 * portillo 186.1-187.0 / 26.8-28.6 · breckenridge 186.7-189.3 / 21.6-24.9 ·
 * heavenly 208.7-209.3 / 33.8-34.4. Every value is within ~1 of the figures
 * below, so no threshold moved: the CSM change is WebGPU-only (`Renderer` keeps
 * the untouched `CsmShadows` on WebGL), and this project pins `?gfx=webgl`.
 *
 * Note for whoever touches these next: breckenridge's stdev is BIMODAL across
 * runs (~24.9 or ~21.6 depending on which frame the 750ms wait lands on), and
 * the low mode clears the floor by only 0.6. That is the flakiest budget here.
 */
const LUMINANCE_BUDGETS = [
  // measured mean / stdev at this sample point: 186.6 / 27.6
  { slug: "ski-portillo", maxMean: 195, minStdev: 23 },
  // 186.1 / 25.2 — the flattest-looking of the three, and the binding case
  { slug: "breckenridge", maxMean: 195, minStdev: 21 },
  // 207.7-208.2 / 33.7 — brightest, but also the most structured
  { slug: "heavenly", maxMean: 215, minStdev: 29 },
] as const;

for (const { slug, maxMean, minStdev } of LUMINANCE_BUDGETS) {
  test(`gameplay canvas retains terrain contrast and does not wash toward white (${slug})`, async ({ page }) => {
    // ?e2ecanvas keeps the WebGL drawing buffer readable; without it the sample
    // below reads all-zeros regardless of what is on screen.
    await page.goto(dropInUrl(`/resorts/${slug}/drop-in?engine=v2&e2ecanvas`));
    await page.getByRole("button", { name: /start descent/i }).click();
    await expect(page.locator("[data-drop-in-state='running'] canvas[data-testid='drop-in-canvas']")).toBeVisible();
    await page.waitForTimeout(750);
    const luminance = await canvasLuminance(page);
    console.log(`${slug} canvas luminance mean=${luminance.mean.toFixed(2)} stdev=${luminance.stdev.toFixed(2)}`);
    expect(luminance.stdev).toBeGreaterThan(minStdev);
    expect(luminance.mean).toBeLessThan(maxMean);
  });
}

test("trail switch cycles to a named real OSM run", async ({ page }) => {
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
  await expect(page.getByText("Gunbarrel", { exact: true })).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.getByText("Ridge Run", { exact: true })).toBeVisible();
});

test("the speedometer is stacked below the Conditions button", async ({ page }) => {
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();

  const conditionsBox = await page.getByRole("link", { name: /conditions/i }).boundingBox();
  const speedometerBox = await page.getByTestId("drop-in-speedometer").boundingBox();
  expect(conditionsBox).not.toBeNull();
  expect(speedometerBox).not.toBeNull();
  expect(speedometerBox!.y).toBeGreaterThanOrEqual(conditionsBox!.y + conditionsBox!.height);
});

test("pointer-lock rejection never blocks play", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "requestPointerLock", {
      configurable: true,
      value: () => Promise.reject(new DOMException("forced", "NotAllowedError")),
    });
  });
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("button", { name: /start descent/i }).click();
  const canvas = page.locator("[data-drop-in-state='running'] canvas[data-testid='drop-in-canvas']");
  await expect(canvas).toBeVisible();
  await canvas.dblclick({ force: true });
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(150);
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("[data-drop-in-state='running']")).toBeVisible();
});

test("navigation cleanly unmounts the runtime without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // /_vercel/* analytics scripts only exist on Vercel infrastructure; their
    // 404s when serving a production build locally are environmental noise.
    if (message.location().url.includes("/_vercel/")) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(dropInUrl(V2_URL));
  await page.getByRole("button", { name: /start descent/i }).click();
  await expect(page.locator("[data-drop-in-state='running'] canvas[data-testid='drop-in-canvas']")).toBeVisible();
  await page.goto("/resorts/heavenly");
  await expect(page.locator("[data-drop-in-state]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
