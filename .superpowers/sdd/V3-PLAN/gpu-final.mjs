import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const results=[];
const out=new URL('./shots/',import.meta.url);const browser=await chromium.launch({headless:false});
await fs.mkdir(out,{recursive:true});
try {
for(const gfx of (process.env.GFXS??'webgl,webgpu').split(','))for(const slug of ['breckenridge','heavenly','ski-portillo']){
 const page=await browser.newPage({viewport:{width:1365,height:900}}),errors=[],warnings=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&/shader|pipeline|render|texture/i.test(m.text()))warnings.push(m.text())});
 const load=Date.now();await page.goto(`http://127.0.0.1:3113/resorts/${slug}/drop-in?gfx=${gfx}&weather=0&e2ecanvas&e2edebug=1`);
 await page.getByRole('button',{name:'Start descent'}).click();await page.locator('[data-drop-in-state="running"]').waitFor();
 const readyMs=Date.now()-load,start=Date.now();await page.evaluate(gfx=>window.__dropInDebug.setQuality(gfx==='webgpu'?4:3),gfx);
 for(const ms of [750,5000,30000]){await page.waitForTimeout(Math.max(0,ms-(Date.now()-start)));await page.screenshot({path:new URL(`final-${slug}-${gfx}-${ms}.png`,out).pathname});if(ms===5000)await page.evaluate(gfx=>window.__dropInDebug.setQuality(gfx==='webgpu'?4:3),gfx);}
 const snapshot=await page.evaluate(()=>{const s=window.__dropInDebug.snapshot();delete s.runs;delete s.lifts;return s});
 const result={slug,gfx,readyMs,snapshot,errors,warnings};results.push(result);
 await fs.writeFile(new URL('./gpu-clear-results.json',import.meta.url),JSON.stringify(results,null,2));
 console.log(JSON.stringify(result));
 assert.equal(snapshot.backend,gfx);assert.deepEqual(errors,[]);
 const info=snapshot.performance.rendererInfo;
 assert.ok(info.frameDrawCalls>0&&info.frameDrawCalls<150);
 assert.ok(info.frameTriangles>0&&info.frameTriangles<400000);
 if(gfx==='webgpu') assert.ok(info.memory.texturesSize>0&&info.memory.texturesSize<128000000);
 if(slug==='breckenridge'&&gfx==='webgpu'){
  await page.evaluate(()=>window.__dropInDebug.setQuality(1));await page.waitForTimeout(1500);await page.screenshot({path:new URL('thermal-breckenridge-1.png',out).pathname});
  await page.evaluate(()=>window.__dropInDebug.setQuality(4));await page.waitForTimeout(1500);await page.screenshot({path:new URL('thermal-breckenridge-4.png',out).pathname});
 }
 await page.close();
}
} finally {await browser.close();}
