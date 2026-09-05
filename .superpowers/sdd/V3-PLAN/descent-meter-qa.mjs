import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const out = new URL('./shots/', import.meta.url);
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:false});
const results=[];
try {
  for (const [name, width, height, gfx] of [['desktop',1365,900,'webgpu'],['phone',390,844,'webgl'],['small-phone',320,740,'webgl']]) {
    const page=await browser.newPage({viewport:{width,height},hasTouch:width<600});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:3113/resorts/breckenridge/drop-in?gfx=${gfx}`);
    await page.getByRole('button',{name:'Start descent'}).click();
    await page.locator('[data-drop-in-state="running"]').waitFor();
    const meter=page.getByRole('progressbar',{name:/ descent$/});
    await meter.waitFor();
    const before=Number(await meter.getAttribute('aria-valuenow'));
    assert.ok(before<=5,`fresh run starts near the top: ${before}`);
    await page.keyboard.down('ArrowUp');await page.waitForTimeout(5000);await page.keyboard.up('ArrowUp');
    const after=Number(await meter.getAttribute('aria-valuenow'));
    assert.ok(after>before,`descent advances: ${before} -> ${after}`);
    assert.ok(after<=100);
    const remaining=await meter.getAttribute('aria-valuetext');
    assert.match(remaining,/vertical feet to the bottom of Horseshoe Bowl/);
    const bounds=await page.getByTestId('descent-progress').boundingBox();
    const stats=await page.getByTestId('run-statistics').boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
    assert.ok(bounds.y+bounds.height<stats.y);
    if(width<600){const tuck=await page.getByRole('button',{name:'Tuck',exact:true}).boundingBox();assert.ok(stats.y+stats.height<tuck.y);}
    const junction=page.getByTestId('junction-prompt');
    if(await junction.isVisible()){const j=await junction.boundingBox();assert.ok(j.y+j.height<bounds.y);}
    await page.screenshot({path:new URL(`descent-meter-${name}.png`,out).pathname});
    // Restart through the real UI input; the meter must return toward zero.
    await page.keyboard.press('r');
    await page.waitForFunction(()=>Number(document.querySelector('[role=progressbar][aria-label$=" descent"]')?.getAttribute('aria-valuenow'))<=5);
    assert.equal(errors.length,0);
    results.push({name,gfx,before,after,remaining,bounds,errors});
    await page.close();
  }
} finally {await browser.close(); await fs.writeFile(new URL('./descent-meter-results.json',import.meta.url),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results));
