import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:false});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3114/',{timeout:90000});
 const cards=page.getByTestId('resort-card');await cards.first().waitFor({timeout:60000});
 await cards.first().scrollIntoViewIfNeeded();await page.waitForTimeout(3500);
 await page.screenshot({path:'.superpowers/resort-cards/desktop.png'});
 console.log(JSON.stringify({cards:await cards.count(),first:await cards.first().innerText(),errors}));
 await cards.first().getByRole('button',{name:'Live look',exact:true}).click();
 await page.getByRole('dialog').waitFor();await page.waitForTimeout(2500);
 await page.screenshot({path:'.superpowers/resort-cards/dialog-desktop.png'});
 console.log(JSON.stringify({dialog:await page.getByRole('dialog').innerText(),errors}));
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await cards.first().scrollIntoViewIfNeeded();await page.evaluate(()=>{const card=document.querySelector('[data-resort-slug=vail]');window.scrollBy(0,card.getBoundingClientRect().top-230)});await page.waitForTimeout(1000);
 await page.screenshot({path:'.superpowers/resort-cards/mobile.png'});
 await cards.first().getByRole('button',{name:'Live look',exact:true}).click();await page.waitForTimeout(1500);
 await page.screenshot({path:'.superpowers/resort-cards/dialog-mobile.png'});
} finally {await browser.close()}
