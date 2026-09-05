import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
await fs.mkdir(new URL('./shots/',import.meta.url),{recursive:true});
const browser=await chromium.launch({headless:false});
try {
 const context=await browser.newContext({viewport:{width:1365,height:900}}),page=await context.newPage(),cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:10e6/8,uploadThroughput:1e6/8,connectionType:'cellular4g'});
 const requests=[],errors=[]; page.on('request',r=>{if(r.url().includes('/game/terrain/'))requests.push(r.url())}); page.on('pageerror',e=>errors.push(e.message));
 const started=Date.now(); await page.goto('http://127.0.0.1:3113/resorts/breckenridge/drop-in');
 await page.getByRole('button',{name:'Start descent'}).waitFor(); const posterMs=Date.now()-started;
 await page.getByRole('button',{name:'Start descent'}).click(); const clickedMs=Date.now()-started;
 await page.locator('[data-drop-in-state="running"]').waitFor({timeout:60000}); const readyMs=Date.now()-started;
 const backend=await page.locator('[data-drop-in-gfx]').getAttribute('data-drop-in-gfx').catch(()=>null);
 const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>({name:e.name,startTime:e.startTime,duration:e.duration,responseEnd:e.responseEnd,encodedBodySize:e.encodedBodySize,transferSize:e.transferSize,initiatorType:e.initiatorType})));
 await page.waitForTimeout(750); await page.screenshot({path:new URL('./shots/no-query-cold-4g.png',import.meta.url).pathname});
 const result={browserVersion:browser.version(),profile:{downloadMbps:10,uploadMbps:1,latencyMs:100,cacheDisabled:true},posterMs,clickedMs,readyMs,backend,requests,resources,errors};
 await fs.writeFile(new URL('./cold-4g.json',import.meta.url),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally {await browser.close()}
