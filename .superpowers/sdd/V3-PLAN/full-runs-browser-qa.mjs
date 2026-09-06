/**
 * Opt-in real-browser matrix. NO browser starts unless --run is present.
 * From repo root: node --import tsx .superpowers/sdd/V3-PLAN/full-runs-browser-qa.mjs --run
 * BASE_URL=http://localhost:3100 QA_FILTER=heavenly/time_trial/webgpu/touch
 * Uses MOCK session issuance for shell contracts; never submits fake tokens to the server.
 * Genuine handler201/tamper evidence lives in replay-inputs.test.ts, separately.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(root, 'package.json'));
const selected = [['breckenridge', 1], ['heavenly', 2], ['ski-portillo', 2]];
const matrix = selected.flatMap(([slug, runIndex]) => ['free_ski', 'time_trial', 'score_attack'].flatMap(mode => ['webgl', 'webgpu'].flatMap(backend => ['keyboard', 'touch'].map(input => ({ slug, runIndex, mode, backend, input, id: `${slug}/${mode}/${backend}/${input}` }))))).filter(row => !process.env.QA_FILTER || row.id.includes(process.env.QA_FILTER));
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ dryRun: true, browserLaunched: false, cases: matrix.map(row => row.id), invocation: 'node --import tsx .superpowers/sdd/V3-PLAN/full-runs-browser-qa.mjs --run' }, null, 2));
  process.exit(0);
}
const { chromium } = require('@playwright/test');
const { rankedTerrain } = require(resolve(root, 'lib/game/server/ranked-terrain.ts'));
const { pointAtArcLength } = require(resolve(root, 'lib/game/terrain/real-course.ts'));
const { PHYSICS_VERSION, COURSE_VERSION } = require(resolve(root, 'lib/game/config/versions.ts'));
const base = process.env.BASE_URL ?? 'http://localhost:3100';
const output = resolve(root, '.superpowers/sdd/V3-PLAN/browser-full-runs-results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? 'chrome', headless: false });
const results = [];
try {
  for (const row of matrix) {
    const context = await browser.newContext({ viewport: row.input === 'touch' ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: row.input === 'touch', isMobile: row.input === 'touch', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [], requested = [], performanceSamples = [], started = Date.now();
    let last, sessionCalls = 0, writeAttempts = 0;
    const run = rankedTerrain(row.slug).realRuns[row.runIndex];
    const label = row.id.replaceAll('/', '-');
    page.on('pageerror', error => errors.push(error.message));
    // No deployed writes. Mocking issuance does not constitute an authenticated leaderboard test.
    await page.route('**/api/drop-in/runs', route => { writeAttempts++; return route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"QA mock tickets must not be submitted"}' }); });
    await page.route('**/api/drop-in/leaderboard?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resortSlug: row.slug, mode: row.mode === 'free_ski' ? 'time_trial' : row.mode, trailId: run.id, physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, rows: [] }) }));
    await page.route('**/api/drop-in/sessions', async route => {
      sessionCalls++;
      const body = route.request().postDataJSON(); requested.push(body);
      assert.equal(body.resortSlug, row.slug);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
        ticket: 'qa.mock.not-a-real-signature', seed: 123, resortSlug: row.slug, mode: body.mode,
        // Pin a canonical short run in the Daily response; the shell must consume the returned ID.
        trailId: body.mode === 'score_attack' ? run.id : body.trailId,
        surface: 'packed', physicsModel: 'v2', physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, tickHz: 30,
        conditionsDate: body.mode === 'time_trial' ? 'fixed-v2' : '2026-09-05',
        environment: { powderDepthCm: 0, windSpeedMps: 0, morningIce: false, visibilityM: 20000, northSign: row.slug === 'ski-portillo' ? 1 : -1 },
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
      }) });
    });
    try {
      await page.goto(`${base}/resorts/${row.slug}/drop-in?gfx=${row.backend}&e2edebug=1`, { waitUntil: 'domcontentloaded' });
      const modeLabel = row.mode === 'free_ski' ? /free (ski|ride)/i : row.mode === 'time_trial' ? /time trial/i : /daily line/i;
      await page.getByRole('radio', { name: modeLabel }).click();
      if (row.mode !== 'score_attack') await page.getByRole('combobox', { name: 'Named run' }).selectOption(run.id);
      if (row.mode !== 'free_ski') {
        await page.locator('[data-drop-in-session="ticketed"]').waitFor({ timeout: 15000 });
        await page.waitForFunction(id => document.querySelector('select[aria-label="Named run"]')?.value === id, run.id);
      }
      await page.getByRole('button', { name: /start descent/i }).click();
      await page.locator('[data-drop-in-state="running"]').waitFor({ timeout: 90000 });
      const snapshot = () => page.evaluate(() => window.__dropInDebug.snapshot());
      last = await snapshot();
      assert.equal(last.backend, row.backend, 'silent backend fallback is a failed matrix case');
      assert.equal(last.selectedTrail, row.runIndex, 'shell must consume the requested/signed canonical run');
      assert.equal(last.debugMutated, false);
      assert.ok(last.time < 2 && last.courseProgress < 30, 'must observe an actual top start, not a debug spawn');
      assert.equal(last.ranked, row.mode !== 'free_ski');
      const initial = last;
      const canvas = page.getByTestId('drop-in-canvas');
      let cdp, touchOrigin, tuckPoint, steering = 0;
      if (row.input === 'keyboard') {
        // Focus canvas, not the start button, whose keyboard guard intentionally ignores gameplay.
        await canvas.click({ position: { x: 80, y: 120 } });
        await page.keyboard.down('w');
      } else {
        cdp = await context.newCDPSession(page);
        const box = await canvas.boundingBox(); assert.ok(box);
        touchOrigin = { x: Math.round(box.x + Math.min(100, box.width * 0.25)), y: Math.round(box.y + box.height * 0.62), id: 1, radiusX: 2, radiusY: 2, force: 1 };
        const tuck = await page.getByRole('button', { name: 'Tuck', exact: true }).boundingBox(); assert.ok(tuck, 'actual touch controls must be visible');
        tuckPoint = { x: Math.round(tuck.x + tuck.width / 2), y: Math.round(tuck.y + tuck.height / 2), id: 2, radiusX: 2, radiusY: 2, force: 1 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchOrigin] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchOrigin, tuckPoint] });
      }
      const driveStarted = Date.now();
      let lastPerformanceAt = 0;
      while (Date.now() - driveStarted < 120000) {
        last = await snapshot();
        assert.equal(last.debugMutated, false, 'no debug movement/step/quality API is used by this script');
        if (Date.now() - lastPerformanceAt >= 1000 && last.performance.p50FrameMs > 0) { performanceSamples.push({ time: last.time, ...last.performance }); lastPerformanceAt = Date.now(); }
        if (last.finished) break;
        assert.equal(last.paused, false, 'unexpected pause stops the case instead of bypassing UI');
        const target = pointAtArcLength(run.points, last.courseProgress + 30);
        const heading = Math.atan2(target.x - last.pos.x, target.z - last.pos.z);
        const angle = Math.atan2(Math.sin(heading - last.yaw), Math.cos(heading - last.yaw));
        // Positive world yaw is screen-left in the chase view.
        if (row.input === 'keyboard') {
          const desired = Math.abs(angle) < 0.02 ? 0 : -Math.sign(angle);
          if (desired !== steering) {
            if (steering) await page.keyboard.up(steering < 0 ? 'a' : 'd');
            if (desired) await page.keyboard.down(desired < 0 ? 'a' : 'd');
            steering = desired;
          }
        } else {
          const analog = Math.abs(angle) < 0.02 ? 0 : -Math.sign(angle);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchOrigin, x: Math.round(touchOrigin.x + analog * 64) }, tuckPoint] });
        }
        await page.waitForTimeout(25);
      }
      if (row.input === 'keyboard') { await page.keyboard.up('w'); await page.keyboard.up('a'); await page.keyboard.up('d'); }
      else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(last.finished, true, `controller never reached ${run.name} finish`);
      assert.ok(last.courseProgress >= run.lengthM - 40);
      assert.equal(writeAttempts, 0);
      if (row.mode === 'free_ski') assert.equal(sessionCalls, 0);
      else assert.ok(sessionCalls > 0);
      assert.deepEqual(errors, []);
      await page.getByRole('dialog').waitFor({ timeout: 5000 });
      await page.screenshot({ path: resolve(output, `${label}.png`) });
      results.push({ ...row, accepted: true, mockSession: row.mode !== 'free_ski', authenticatedSubmissionTested: false, initial, final: last, performanceSamples, wallMs: Date.now() - started, sessionCalls, errors });
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${label}-failed.png`) }).catch(() => {});
      results.push({ ...row, accepted: false, error: String(error), last, errors, requested, wallMs: Date.now() - started });
    } finally {
      await context.close();
      await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally { await browser.close(); }
if (results.some(result => !result.accepted)) process.exitCode = 1;
