/** Run serially against the built app: node .superpowers/sdd/V3-PLAN/lift-browser-qa.mjs
 * BASE_URL defaults to http://127.0.0.1:3113. This file does not start a server.
 * Deliberately opt-in Free Ski only; never creates/submits competitive recordings.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3113';
const out = new URL('./shots/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const results = [], captured = new Set();
const expected = { breckenridge: 34, heavenly: 23, 'ski-portillo': 15 };
const browser = await chromium.launch({ headless: false });
try {
  for (const [slug, expectedCount] of Object.entries(expected)) {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${base}/resorts/${slug}/drop-in?gfx=webgl&e2ecanvas&e2edebug=1`, { timeout: 60000 });
      await page.getByRole('radio', { name: /Free Ski/i }).click();
      await page.getByRole('button', { name: 'Start descent' }).click();
      await page.locator('[data-drop-in-state="running"][data-drop-in-mode="free_ski"]').waitFor({ timeout: 60000 });
      await page.waitForFunction(() => Boolean(window.__dropInDebug));
      await page.evaluate(() => window.__dropInDebug.setQuality(3));
      const initial = await page.evaluate(() => window.__dropInDebug.snapshot());
      assert.equal(initial.backend, 'webgl'); assert.equal(initial.ranked, false);
      const lifts = initial.lifts.filter(l => l.complete !== false && l.stations?.length === 2);
      assert.equal(lifts.length, expectedCount, `${slug}: genuine complete inventory changed`);
      // Small bounded batches let the browser process messages between accelerated renders.
      const step = async count => {
        while (count > 0) {
          const batch = Math.min(count, 6000);
          await page.evaluate(n => window.__dropInDebug.stepTicks(n), batch);
          count -= batch;
        }
      };
      for (const lift of lifts) {
        await page.evaluate(index => { window.__dropInDebug.spawnAtLift(index); window.__dropInDebug.stepTicks(1); }, lift.index);
        let state = await page.evaluate(() => window.__dropInDebug.snapshot());
        assert.equal(state.liftIndex, lift.index, `${slug}/${lift.name}: normal core boarding failed`);
        const perTick = state.liftProgress;
        assert.ok(perTick > 0 && perTick < 1, 'ride must have a finite positive duration');
        const kind = /gondola|cable_car/.test(lift.type) ? 'gondola' : /platter/.test(lift.type) ? 'platter' : /chair/.test(lift.type) ? 'chair' : null;
        if (kind && !captured.has(kind)) {
          await step(Math.max(1, Math.floor((0.5 - state.liftProgress) / perTick)));
          await page.evaluate(() => window.__dropInDebug.resume());
          await page.waitForTimeout(2000); // settle the camera after accelerated traversal
          await page.screenshot({ path: new URL(`lift-${kind}-${slug}-midpoint.png`, out).pathname });
          await step(1); // re-pause before exact remaining-distance calculation
          state = await page.evaluate(() => window.__dropInDebug.snapshot());
          assert.equal(state.liftIndex, lift.index);
          assert.ok(state.liftProgress > 0.45 && state.liftProgress < 0.65);
          captured.add(kind);
        }
        // Stop one tick before estimated arrival, then detect the unload itself.
        await step(Math.max(0, Math.floor((1 - state.liftProgress) / perTick) - 1));
        state = await page.evaluate(() => window.__dropInDebug.snapshot());
        for (let tick = 0; state.liftIndex >= 0 && tick < 4; tick++) {
          await step(1); state = await page.evaluate(() => window.__dropInDebug.snapshot());
        }
        assert.equal(state.liftIndex, -1, `${slug}/${lift.name}: did not unload`);
        assert.equal(state.onGround, true);
        assert.equal(state.liftProgress, 1);
        const terminal = lift.stations.reduce((a, b) => a.y > b.y ? a : b);
        const endpointErrorM = Math.hypot(state.pos.x - terminal.x, state.pos.z - terminal.z);
        assert.ok(endpointErrorM < 0.1, `${slug}/${lift.name}: unload ${endpointErrorM}m from genuine upper terminal`);
        const result = { slug, id: lift.id, name: lift.name, type: lift.type, rideSeconds: 1 / perTick / 120, endpointErrorM, pos: state.pos };
        results.push(result); console.log(JSON.stringify(result));
      }
      assert.deepEqual(errors, [], `${slug}: browser errors`);
    } finally { await page.close(); }
  }
  assert.equal(results.length, 72); assert.deepEqual([...captured].sort(), ['chair', 'gondola', 'platter']);
  await fs.writeFile(new URL('./lift-browser-results.json', import.meta.url), JSON.stringify({ passed: results.length, captures: [...captured], results }, null, 2));
} finally { await browser.close(); }
