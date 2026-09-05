import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:false});
const results=[];
await fs.mkdir(new URL('./shots/',import.meta.url),{recursive:true});
try {
 for(const mobile of [false,true]) for(const slug of ['breckenridge','heavenly','ski-portillo']) {
  const gfx=mobile?'webgl':'webgpu',rung=mobile?1:4;
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1365,height:900},hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:3113/resorts/${slug}/drop-in?gfx=${gfx}&weather=1&e2edebug=1`);
  await page.getByRole('button',{name:'Start descent'}).click();
  await page.locator('[data-drop-in-state="running"]').waitFor({timeout:60000});
  await page.evaluate(r=>window.__dropInDebug.setQuality(r),rung);
  await page.waitForTimeout(5000);
  await page.evaluate(r=>window.__dropInDebug.setQuality(r),rung);
  await page.waitForTimeout(25000);
  const snapshot=await page.evaluate(()=>{const s=window.__dropInDebug.snapshot();delete s.runs;delete s.lifts;return s;});
  assert.equal(snapshot.backend,gfx,'actual backend must match the requested backend');
  assert.equal(snapshot.performance.rung,rung);
  assert.deepEqual(errors,[]);
  const info=snapshot.performance.rendererInfo;
  assert.ok(info.frameDrawCalls>0&&info.frameDrawCalls<(mobile?80:150),'whole-frame draw budget');
  assert.ok(info.frameTriangles>0&&info.frameTriangles<(mobile?150000:400000),'whole-frame triangle budget');
  if(gfx==='webgpu') assert.ok(info.memory.texturesSize>0&&info.memory.texturesSize<128000000,'desktop texture-byte budget');
  let hudLayout;
  if(mobile) {
   const stats=await page.getByTestId('run-statistics').boundingBox();
   const tuck=await page.getByRole('button',{name:'Tuck',exact:true}).boundingBox();
   const prompt=page.getByTestId('junction-prompt');
   const junction=await prompt.isVisible()?await prompt.boundingBox():null;
   assert.ok(stats&&tuck);
   assert.ok(stats.y+stats.height<tuck.y,'statistics must clear touch controls');
   assert.ok(stats.x>=0&&stats.x+stats.width<=390,'statistics must fit the viewport');
   if(junction)assert.ok(junction.y+junction.height<stats.y,'junction must clear statistics');
   hudLayout={stats,tuck,junction};
  }
  await page.screenshot({path:new URL(`./shots/storm-${slug}-${gfx}-rung${rung}.png`,import.meta.url).pathname});
  results.push({slug,gfx,rung,mobileEmulation:mobile,deviceScaleFactor:mobile?2:1,browserVersion:browser.version(),snapshot,errors,hudLayout});
  console.log(JSON.stringify(results.at(-1)));
  await context.close();
 }
} finally {await browser.close();await fs.writeFile(new URL('./gpu-storm-results.json',import.meta.url),JSON.stringify(results,null,2));}
