import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
let playwright;try{playwright=await import('playwright');}catch{playwright=await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');}
const output=process.argv[2]||'test-results/brief-ready-text',baseline=process.env.BRIEF_BASELINE==='1';await mkdir(output,{recursive:true});
const articles=Array.from({length:6},(_,i)=>({id:'ready-'+i,url:'https://example.test/ready/'+i,title:'Une découverte scientifique pratique dans un domaine différent '+i,source:'Source '+i,category:'Science',summary:'Une innovation vérifiée.',publishedAt:new Date(Date.now()-i*3600000).toISOString()}));
const history=[...articles,...[1,2].map((day)=>({...articles[0],id:'day-'+day,url:'https://example.test/day/'+day,publishedAt:new Date(Date.now()-day*86400000).toISOString()}))];
const png=await readFile(new URL('../assets/science-energie.png',import.meta.url));
const browser=await playwright.chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
const results=[],errors=[];
try{
for(const scenario of ['three-days','one-day','error',...(baseline?[]:['saved-essential'])]){
const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'});
if(process.env.AI_APK_ASSETS)await context.route('https://mon-actualite.vercel.app/assets/**',route=>route.fulfill({path:process.env.AI_APK_ASSETS+'/'+decodeURIComponent(new URL(route.request().url()).pathname.slice(8))}));
await context.addInitScript(({articles,scenario})=>{
if(scenario==='saved-essential'){sessionStorage.setItem('news-active-view-v9204','brief');sessionStorage.setItem('news-active-brief-mode-v9846','essential');}
localStorage.setItem('news-cache-language-v98','fr');localStorage.setItem('news-live-cache',JSON.stringify({articles,fetchedAt:new Date().toISOString()}));
if(!localStorage.getItem('news-settings'))localStorage.setItem('news-settings',JSON.stringify({hideReadAtOpen:false,briefEssentialCategories:['Science'],watchTopics:[],textSize:100,titleSize:100}));
localStorage.setItem('news-watch-rules-v1',JSON.stringify([{query:'découverte',exclude:'',enabled:true}]));
localStorage.setItem('news-brief-ai-settings-v1',JSON.stringify({mode:'groq-auto',autoAtOpen:false,prompt:'Science'}));
localStorage.setItem('news-brief-ai-results-v1',JSON.stringify({provider:'groq',summary:'Science : Une découverte vérifiée.',cards:[{title:'Science',summary:'Une découverte vérifiée.',article:articles[0]}],sources:articles,generatedAt:new Date().toISOString()}));
window.__partialBrief=[];setInterval(()=>{const root=document.querySelector('[data-stable-brief-content]');if(!root)return;const busy=root.getAttribute('aria-busy')==='true'||root.classList.contains('brief-waiting-three-days');if(!busy)return;const visible=[...root.querySelectorAll('img')].filter(node=>{const r=node.getBoundingClientRect();return getComputedStyle(node).visibility==='visible'&&r.width&&r.height;}).length;window.__partialBrief.push(visible);},16);
},{articles,scenario});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
let finishHistory,historyRequests=0;const gate=new Promise(resolve=>finishHistory=resolve);
await page.route('**/api/news**',async route=>{if(new URL(route.request().url()).searchParams.get('brief')==='3days'){historyRequests++;await gate;if(scenario==='error')return route.fulfill({status:503,body:'unavailable'});return route.fulfill({json:{articles:scenario==='one-day'?articles:history,fetchedAt:new Date().toISOString()}});}return route.fulfill({json:{articles,fetchedAt:new Date().toISOString()}});});
await page.route('**/api/article-photo-fast**',route=>route.fulfill({body:png,contentType:'image/png',headers:{'X-Thumbnail-Status':'publisher-metadata'}}));
await page.route('**/version.json**',route=>route.fulfill({json:{version:'98',codeRelease:'98.53'}}));
await page.goto(process.env.AI_BASE_URL||'http://127.0.0.1:4173/?nativePreview=1',{waitUntil:'domcontentloaded'});
if(scenario==='saved-essential'){
await page.waitForSelector('[data-stable-brief-content][aria-busy="true"]');assert.equal(await page.locator('[data-stable-brief-content] img').count(),0);await page.screenshot({path:output+'/saved-essential-initial.png'});
await page.locator('.bottom-nav [data-view="home"]').click();
}
await page.waitForFunction(()=>document.querySelectorAll('[data-stable-home-feed] img.image-ready-v98').length===6);
const homeSize=await page.locator('[data-stable-home-feed] h2').first().evaluate(node=>getComputedStyle(node).fontSize);
// Switch through the existing tabs while the history request is still pending.
if(baseline)await page.locator('.bottom-nav [data-view="brief"]').evaluate(node=>{node.dataset.briefPrefetchReplay='1';node.click();});else await page.locator('.bottom-nav [data-view="brief"]').click();
await page.locator('[data-brief-mode="essential"]').click();await page.waitForTimeout(100);
const loading=await page.locator('[data-stable-brief-content]').evaluate(root=>({images:root.querySelectorAll('img').length,cards:root.querySelectorAll('[data-article]').length,text:root.textContent,busy:root.getAttribute('aria-busy'),height:root.getBoundingClientRect().height,visiblePhotos:[...root.querySelectorAll('img')].filter(node=>getComputedStyle(node).visibility==='visible'&&node.getBoundingClientRect().width>0).length}));
await page.screenshot({path:output+'/'+scenario+'-loading.png'});
finishHistory();
if(!baseline)await page.waitForFunction(()=>document.querySelector('[data-stable-brief-content]')?.getAttribute('aria-busy')==='false');else await page.waitForTimeout(150);
const fonts={home:homeSize,essential:await page.locator('[data-stable-brief-content] h2').first().evaluate(node=>getComputedStyle(node).fontSize)};
await page.screenshot({path:output+'/'+scenario+'-ready.png'});
await page.locator('[data-brief-mode="watches"]').click();fonts.watch=await page.locator('.watch-day-v9138 h2').first().evaluate(node=>getComputedStyle(node).fontSize);
await page.locator('[data-brief-mode="ai"]').click();fonts.aiTitle=await page.locator('.ai-result-v9840 h2').first().evaluate(node=>getComputedStyle(node).fontSize);assert.equal(await page.locator('.ai-news-summary-v9840').count(),0);fonts.aiSummary=await page.locator('.ai-card-summary-v9840 p').first().evaluate(node=>getComputedStyle(node).fontSize);
await page.screenshot({path:output+'/'+scenario+'-ia.png'});
const observed=await page.evaluate(()=>window.__partialBrief),metrics={scenario,loading,fonts,historyRequests,partialFrames:observed.length,leakedPhotos:Math.max(0,...observed)};results.push(metrics);
if(!baseline){assert.equal(loading.images,0);assert.equal(loading.cards,0);assert.match(loading.text,/Chargement de L’essentiel/);assert.equal(loading.busy,'true');assert.ok(loading.height<100,'loading message immediately below tabs');assert.equal(metrics.leakedPhotos,0);assert.equal(historyRequests,1);assert.ok(Object.entries(fonts).every(([key,font])=>key==='aiTitle'?Math.abs(parseFloat(font)-parseFloat(homeSize)*.96)<.01:font===homeSize),JSON.stringify(fonts));}
// Persist the common minimum and maximum; all views retain the same scale after reload.
if(!baseline&&scenario==='three-days')for(const size of [100,175]){
await page.locator('.bottom-nav [data-view="settings"]').click();const section=page.locator('.settings-accordion-v9185').filter({has:page.locator('[data-ui-range="textSize"]')});if(!await section.evaluate(node=>node.open))await section.locator('summary').click();assert.equal(await page.locator('[data-ui-range="textSize"]').getAttribute('min'),'100');
await page.locator('[data-ui-range="textSize"]').evaluate((input,size)=>{input.value=size;input.dispatchEvent(new Event('input',{bubbles:true}));},size);
const samples=[];await page.locator('.bottom-nav [data-view="home"]').click();samples.push(await page.locator('[data-stable-home-feed] h2').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)));
await page.locator('.bottom-nav [data-view="brief"]').click();for(const mode of ['essential','watches','ai']){await page.locator('[data-brief-mode="'+mode+'"]').click();samples.push(await page.locator('[data-stable-brief-content] h2').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)));}samples.push(await page.locator('.ai-card-summary-v9840 p').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)));assert.ok(samples.every((value,index)=>Math.abs(value-11.5*size/100*(index===3?.96:1))<.01),JSON.stringify(samples));
await page.reload();await page.waitForSelector('.ai-card-summary-v9840 p');assert.equal(await page.locator('.ai-card-summary-v9840 p').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),11.5*size/100);await page.setViewportSize({width:320,height:915});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:412,height:915});
}
await context.close();
}
await writeFile(output+'/report.json',JSON.stringify({baseline,results,errors},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({pass:!baseline,baseline,results,errors}));
}finally{await browser.close();}
