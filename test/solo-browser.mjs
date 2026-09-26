// Isolated browser verification: fake model, scratch records, scheduler off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { scratch, startOffice, ROOT } from './helpers.mjs';
import { install } from '../scripts/install-solo.mjs';
import { loadRoster } from '../roster.mjs';
const tmp=scratch('solo-ui');let office,browser;
try{
 install(tmp.brain,loadRoster().agents);
 office=await startOffice({brain:tmp.brain,data:tmp.data});
 try{browser=await chromium.launch()}catch{browser=await chromium.launch({channel:'chrome'})}
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(office.base+'/solo/advanced');await page.waitForFunction(()=>document.querySelectorAll('#catalog article').length===40);
 assert.equal(await page.locator('#scheduled').textContent(),'0');
 await page.locator('#category').selectOption('retainers');assert.equal(await page.locator('#catalog article').count(),8);
 await page.locator('#search').fill('renewal');assert.equal(await page.locator('#catalog article').count(),1);
 await page.getByRole('button',{name:'Enable schedule',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#scheduled').textContent==='1');
 await page.getByRole('button',{name:'Pause enabled solo schedules',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#scheduled').textContent==='0');
 await page.locator('#context').fill('Check the supplied contract. Do not assume its notice period.');
 await page.getByRole('button',{name:'Prepare now',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Queued:'));
 const tasks=await office.tasks();assert.equal(tasks.length,1);assert.equal(tasks[0].goal,'solo-renewals');assert.equal(tasks[0].needsOk,false);assert.match(tasks[0].text,/Do not assume its notice period/);
 await page.locator('#search').fill('');await page.locator('#category').selectOption('');
 const output=path.join(ROOT,'output','solo-verification');fs.mkdirSync(output,{recursive:true});
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.join(output,'mobile.png'),fullPage:false});
 assert.deepEqual(errors,[]);
 console.log('PASS: 40 workflows, retainer filter, search, persisted schedule controls, real task submission, mobile layout, no page errors.');
 console.log('Screenshots: '+output);
}finally{await browser?.close();await office?.stop();tmp.cleanup()}
