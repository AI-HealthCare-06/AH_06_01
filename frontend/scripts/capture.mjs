import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];page.on('pageerror', e=>errors.push(e.message));
await fs.mkdir('test-results/screenshots',{recursive:true});
for(const route of ['home','quests','dashboard','shop','login','profile','dinosaur','first-result','quests/walk','reward','buff','risk','withered','me']){
  await page.goto(`http://127.0.0.1:5173/${route}`);
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode().catch(()=>{}))));
  await page.screenshot({path:`test-results/screenshots/${route.replace('/','-')}.png`,fullPage:true});
  console.log(JSON.stringify({route,height:await page.locator('.mobile-screen').evaluate(e=>e.getBoundingClientRect().height),broken:await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.naturalWidth).map(i=>i.src))}));
}
console.log(JSON.stringify({errors}));await browser.close();
