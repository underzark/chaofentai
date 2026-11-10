// Optional portable-browser smoke test. Requires Playwright/Chromium; all routes are mocked. No server or paid API is used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {GIF_HTML} from '../worker/gif-studio.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:900}});let posts=0,prepares=0,enabled=false,history=[],lastPrepared,submitResolve=null;
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cost={amount:null,note:'Unknown GIF cost'},request={prompt:'Cat blinks',model:'gpt-image-2.6-sunburst',frame_count:9,frame_duration_ms:200,n:1,size:'auto',quality:'auto',background:'auto',moderation:'auto'};
const completed={id:'done',idempotency_key:'gif-done',state:'completed',request,cost,created_at:Date.now(),outputs:[{asset_id:'one',download:'/fake.gif',width:16,height:16,bytes:148,frame_count:2,duration_ms:400}]};
const waiting={...completed,id:'waiting',idempotency_key:'gif-waiting',state:'submission_unknown',outputs:[]};
await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')throw Error('External request forbidden');const p=u.pathname;let data;
 if(p==='/gif')return route.fulfill({contentType:'text/html',body:GIF_HTML});
 if(p==='/fake.gif')return route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64')});
 if(p==='/api/gif/options')data={enabled,blocker:null};
 else if(p==='/api/gif/history')data={items:history,count:history.length,storage:{bytes:148},notice:'Synthetic history'};
 else if(p==='/api/gif/prepare'){prepares++;lastPrepared=route.request().postDataJSON();data={approval_id:'q',idempotency_key:'gif-q',quote_hash:'hash',confirmation_text:'confirm',expires_at:Date.now()+100000,summary:{request:lastPrepared,playback_fps:1000/lastPrepared.frame_duration_ms,loop_duration_ms:lastPrepared.frame_count*lastPrepared.frame_duration_ms}};}
 else if(p==='/api/gif/submit'){posts++;assert.deepEqual(route.request().postDataJSON(),{approval_id:'q',quote_hash:'hash',approved:true});await new Promise(r=>submitResolve=r);data={...completed,id:'q',idempotency_key:'gif-q'};history=[data];}
 else if(p.startsWith('/api/gif/jobs/'))data=history.find(j=>j.idempotency_key===p.slice(14))||waiting;
 else throw Error('Unexpected preview request '+p);
 return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
await page.goto('http://127.0.0.1:43824/gif');await page.waitForFunction(()=>document.getElementById('availability').textContent.includes('尚未启用'));assert.equal(await page.locator('#prepare').isDisabled(),true);enabled=true;await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('prepare').disabled);
await page.locator('#prompt').fill('A kitten blinks. Seamless loop.');assert.match(await page.locator('#timing').textContent(),/5 FPS.*1.80/);await page.locator('#speed').selectOption('50');assert.match(await page.locator('#timing').textContent(),/20 FPS.*0.45/);await page.locator('#frames').fill('12');await page.locator('#size').selectOption('custom');await page.locator('#width').fill('512');await page.locator('#height').fill('256');
await page.locator('#prepare').click();await page.locator('#confirm').waitFor({state:'visible'});assert.match(await page.locator('#summary').textContent(),/512x256/);await page.locator('#cancel').click();assert.equal(posts,0);assert.equal(prepares,1);
await page.locator('#prepare').click();await page.locator('#confirm').waitFor({state:'visible'});await page.keyboard.press('Escape');assert.equal(posts,0);await page.waitForFunction(()=>!document.getElementById('prepare').disabled);
await page.locator('#prepare').click();await page.locator('#approve').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('正在生成'));assert.equal(await page.locator('#prepare').isDisabled(),true);assert.equal(posts,1);submitResolve();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('GIF 已完成'));assert.equal(await page.locator('#results img').count(),1);assert.equal(await page.locator('#results a').getAttribute('download'),'chaofentai-one.gif');
history=[waiting,completed];await page.locator('#refresh').click();await page.locator('.job button').first().click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('提交结果未知'));assert.equal(await page.locator('#results img').count(),0);assert.equal(await page.locator('#empty').isVisible(),true);await page.locator('.job button').nth(1).click();assert.equal(await page.locator('#results img').count(),1);
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/chaofentai-gif-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/chaofentai-gif-desktop.png',fullPage:true});assert.deepEqual(errors,[]);await browser.close();console.log('PASS GIF browser: disabled gate, FPS/duration/custom-size controls, full quote, Cancel/Escape zero POST, double-click lock, exact approved payload, GIF save, history clears stale preview, mobile fit, no JS errors. Real API calls: 0.');
