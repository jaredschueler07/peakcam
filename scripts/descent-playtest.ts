/**
 * scripts/descent-playtest.ts
 * ───────────────────────────
 * Scripted playtest of the Descent engine in headless Chromium: loads a
 * resort, starts a run, drives the rider with real held keys, and writes
 * screenshots plus a JSON summary (speed trace, tricks, crashes, frame
 * timings) to an output directory. A dev server must already be running.
 *
 *   npx tsx scripts/descent-playtest.ts --slug breckenridge --out /tmp/playtest --scenario carve
 *
 * Scenarios: menu (screens only), straight, carve, jump, autopilot (follows the
 * line with the sim's own bot via window.__descent), lift.
 */

import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const slug = args.get("slug") ?? "breckenridge";
const out = args.get("out") ?? "/tmp/descent-playtest";
const scenario = args.get("scenario") ?? "carve";
const base = args.get("base") ?? "http://localhost:3000";
const course = Number(args.get("course") ?? "0");
const mobile = args.get("mobile") === "1";
mkdirSync(out, { recursive: true });

interface Diag { fps: number; timings: Record<string, number>; info: { calls: number; triangles: number }; quality: number }

async function hud(page: Page) {
  return page.evaluate(() => (window as unknown as { __descent: { hud: { getState(): unknown } } }).__descent.hud.getState()) as Promise<Record<string, unknown>>;
}
async function diag(page: Page): Promise<Diag> {
  return page.evaluate(() => (window as unknown as { __descent: { diagnostics: Diag } }).__descent.diagnostics);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage(mobile
    ? { viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });

  await page.goto(`${base}/resorts/${slug}/drop-in`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-descent-phase="menu"]', { timeout: 90_000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __descent?: unknown }).__descent), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, "01-menu");
  if (course > 0) {
    await page.evaluate((i) => (window as unknown as { __descent: { setCourse(i: number): void } }).__descent.setCourse(i), course);
    await page.waitForTimeout(500);
  }
  const summary: Record<string, unknown> = { slug, scenario, errors, course };

  if (scenario === "menu") {
    await page.getByRole("button", { name: /trail map/i }).click();
    await page.waitForTimeout(600);
    await shot(page, "02-trail-map");
    await page.getByRole("button", { name: /controls/i }).click();
    await page.waitForTimeout(400);
    await shot(page, "03-controls");
    await page.getByRole("button", { name: /settings/i }).click();
    await page.waitForTimeout(400);
    await shot(page, "04-settings");
    await page.getByRole("button", { name: /ski now/i }).click();
    await page.waitForTimeout(400);
    await shot(page, "05-ski-now");
    summary.diag = await diag(page);
    writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
    await browser.close();
    return;
  }

  await page.getByRole("button", { name: /ski now/i }).click();
  await page.waitForTimeout(300);
  if (scenario === "ranked") {
    await page.getByRole("radio", { name: /time trial/i }).click();
    await page.waitForTimeout(1500);
    await shot(page, "02-ranked-panel");
  }
  await page.getByRole("button", { name: /drop in/i }).last().click();
  await page.waitForSelector('[data-descent-phase="countdown"]', { timeout: 10_000 });
  await shot(page, "02-countdown");
  await page.waitForSelector('[data-descent-phase="riding"]', { timeout: 60_000 });
  await page.waitForTimeout(200);

  const trace: Array<{ t: number; speed: number; style: number; progress: number; airborne: boolean; crashed: boolean; fps: number; frame: number }> = [];
  const events: string[] = [];
  const t0 = Date.now();
  const sample = async (label?: string) => {
    const h = await hud(page);
    const d = await diag(page);
    trace.push({ t: (Date.now() - t0) / 1000, speed: h.speedKmh as number, style: h.style as number, progress: h.progress as number, airborne: h.airborne as boolean, crashed: h.crashed as boolean, fps: Math.round(d.fps), frame: Math.round(d.timings.frame ?? 0) });
    if (label) events.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${label} speed=${h.speedKmh} style=${h.style} progress=${(h.progress as number).toFixed(2)} trail=${h.trailName}`);
  };

  const hold = async (keys: string[], ms: number, label?: string) => {
    for (const k of keys) await page.keyboard.down(k);
    const end = Date.now() + ms;
    while (Date.now() < end) { await page.waitForTimeout(Math.min(500, end - Date.now())); await sample(); }
    for (const k of keys) await page.keyboard.up(k);
    if (label) await sample(label);
  };

  if (scenario === "straight") {
    await hold(["KeyW"], 6000, "tuck 6s");
    await shot(page, "03-tuck");
    await hold(["KeyW"], 6000, "tuck 12s");
    await shot(page, "04-tuck");
    await hold([], 4000, "glide");
    await shot(page, "05-glide");
    await hold(["KeyS"], 3000, "brake");
    await shot(page, "06-brake");
  } else if (scenario === "carve") {
    await hold(["KeyW"], 4000, "tuck");
    await shot(page, "03-tuck");
    await hold(["KeyD"], 1500, "right");
    await shot(page, "04-right");
    await hold(["KeyA"], 1800, "left");
    await shot(page, "05-left");
    await hold(["KeyD"], 1500, "right2");
    await shot(page, "06-right2");
    await hold(["KeyW"], 3000, "tuck2");
    await shot(page, "07-tuck2");
    await page.keyboard.press("KeyC");
    await hold([], 1200, "cam far");
    await shot(page, "08-cam-far");
    await page.keyboard.press("KeyC");
    await hold([], 1200, "cam high");
    await shot(page, "09-cam-high");
    await page.keyboard.press("KeyC");
    await hold([], 1200, "cam helmet");
    await shot(page, "10-cam-helmet");
    await page.keyboard.press("KeyC");
    await page.keyboard.press("KeyV");
    await hold(["KeyS", "KeyA"], 2000, "smear");
    await shot(page, "11-smear-hint");
  } else if (scenario === "jump") {
    await hold(["KeyW"], 5000, "tuck");
    await page.keyboard.down("Space");
    await hold([], 500);
    await page.keyboard.up("Space");
    await sample("pop");
    await hold([], 250);
    await shot(page, "03-air");
    await hold(["KeyJ"], 400, "mute grab");
    await shot(page, "04-grab");
    await hold([], 1500, "land");
    await shot(page, "05-landed");
    await hold(["KeyW"], 3000, "tuck2");
    await page.keyboard.down("Space");
    await hold([], 500);
    await page.keyboard.up("Space");
    await hold(["KeyA"], 900, "spin left");
    await shot(page, "06-spin");
    await hold([], 2000, "after spin");
    await shot(page, "07-after-spin");
  } else if (scenario === "autopilot" || scenario === "ranked") {
    // Drive with the sim's own bot for a full line, sampling as we go.
    await page.evaluate(() => (window as unknown as { __descent: { setAutopilot(on: boolean): void } }).__descent.setAutopilot(true));
    let finished = false;
    for (let i = 0; i < 360 && !finished; i++) {
      await page.waitForTimeout(500);
      await sample();
      if (i % 20 === 0) await shot(page, `auto-${String(i).padStart(3, "0")}`);
      finished = await page.evaluate(() => document.querySelector("[data-descent-results]") !== null);
    }
    events.push(finished ? "finished" : "did not finish");
    await page.waitForTimeout(800);
    await shot(page, "auto-end");
    if (scenario === "ranked") {
      const text = await page.evaluate(() => document.querySelector("[data-descent-results]")?.textContent ?? "");
      events.push(`results: ${text.slice(0, 400)}`);
    }
  } else if (scenario === "touch") {
    await shot(page, "03-touch-hud");
    // Drive with the on-screen controls: press tuck for a while, then steer with the pad.
    const tuck = page.getByRole("button", { name: /tuck/i });
    await tuck.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(3000);
    await sample("touch tuck");
    await tuck.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
    await shot(page, "04-touch-tuck");
  }

  summary.trace = trace;
  summary.events = events;
  summary.diag = await diag(page);
  summary.hud = await hud(page);
  writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ events, errors: errors.slice(0, 10), diag: summary.diag, last: trace.at(-1) }, null, 2));
  await browser.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
