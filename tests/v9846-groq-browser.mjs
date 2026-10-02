import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
let playwright;
try { playwright=await import('playwright'); } catch { playwright=await import('file:///C:/Users/Wokgui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'); }
const output=process.argv[2]||'test-results/groq', native=process.env.GROQ_NATIVE_FIXTURE!=='0';
await mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
const sources=Array.from({length:8},(_,i)=>({id:'groq-source-'+i,url:'https://example.test/news/'+i,title:'Innovation VR voiture '+i,summary:'Extrait vérifié '+i,publishedAt:new Date(Date.now()-i*3600000).toISOString(),category:i%3===0?'VR':i%3===1?'Automobile':'Science',source:'Source '+i,image:''}));
const discovered={...sources[0],id:'discovered-week-old',url:'https://example.test/discovered',title:'Innovation scientifique de la semaine',publishedAt:new Date(Date.now()-5*86400000).toISOString(),category:'Science'};
const png=await readFile(new URL('../assets/icon-192.png',import.meta.url)), errors=[],photoRequests=[];
let generations=0,discoveryRequests=0;
try {
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  if(process.env.AI_APK_ASSETS) await context.route('https://mon-actualite.vercel.app/assets/**',route=>{
    const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice('/assets/'.length));
    return relative.split('/').includes('..')?route.abort():route.fulfill({path:process.env.AI_APK_ASSETS+'/'+relative});
  });
  await context.exposeFunction('__recordGeneration',()=>{generations++;});
  await context.addInitScript(({sources,native})=>{
    localStorage.setItem('news-cache-language-v98','fr');
    localStorage.setItem('news-live-cache',JSON.stringify({articles:sources,fetchedAt:new Date().toISOString(),stats:{}}));
    if(!localStorage.getItem('news-brief-ai-settings-v1')) localStorage.setItem('news-brief-ai-settings-v1',JSON.stringify({provider:'chatgpt',mode:'manual-chat',prompt:'Innovations pratiques, VR et voitures',autoAtOpen:false}));
    window.__OLD_AI=[]; window.__CHAT=[]; window.__GROQ=[]; window.__GROQ_ERROR='';window.__GROQ_DELAY=150;
    window.MonActualiteAI={postMessage(request){window.__OLD_AI.push(request);}};
    window.MonActualiteChat={postMessage(request){window.__CHAT.push(request);}};
    if(native) window.MonActualiteGroq={postMessage(text){
      const request=JSON.parse(text);window.__GROQ.push({...request,key:request.key?'REDACTED':undefined});
      let configured=sessionStorage.getItem('__groqConfigured')!=='false';
      if(request.action==='configure'){configured=true;sessionStorage.setItem('__groqConfigured','true');}
      if(request.action==='disconnect'){configured=false;sessionStorage.setItem('__groqConfigured','false');}
      if(request.action==='generate') void window.__recordGeneration();
      const error=request.action==='generate'?window.__GROQ_ERROR:'';
      const result={summary:'Synthèse de la semaine [Source](A1). <img src=x onerror=alert(1)>',cards:request.articles?.slice(0,3).map(article=>({sourceId:article.sourceId,title:'Analyse '+article.title,summary:'Synthèse factuelle'}))||[]};
      const data=request.action==='generate'?{result,model:'openai/gpt-oss-120b',credentialVersion:'key-1'}:{configured,credentialVersion:'key-1'};
      setTimeout(()=>window.MonActualiteGroq.onmessage?.({data:JSON.stringify({id:request.id,ok:!error,error,data})}),request.action==='generate'?window.__GROQ_DELAY:10);
    }};
  },{sources,native});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/news**',route=>{
    const isBrief=new URL(route.request().url()).searchParams.get('brief')==='1';
    if(isBrief){discoveryRequests++;const payload=route.request().postDataJSON();assert.ok(payload.keywords.every(topic=>topic.endsWith('when:7d')&&topic.length<=70));}
    return route.fulfill({json:{articles:isBrief?[...sources,discovered]:sources,fetchedAt:new Date().toISOString(),stats:{}}});
  });
  await page.route('**/api/article-photo-fast**',route=>{photoRequests.push(route.request().url());return route.fulfill({body:png,contentType:'image/png',headers:{'X-Thumbnail-Status':'feed'}});});
  await page.route('**/version.json**',route=>route.fulfill({json:{version:'98',codeRelease:'98.46'}}));
  await page.goto(process.env.AI_BASE_URL||'http://127.0.0.1:4173/?nativePreview=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('[data-stable-home-feed] img.image-ready-v98').length>=8);
  const homeBefore=await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards=>cards.map(card=>({id:card.dataset.article,src:card.querySelector('img').src})));
  const settings=async()=>{
    await page.locator('.bottom-nav [data-view="settings"]').click();
    const section=page.locator('.settings-accordion-v9185').filter({has:page.locator('summary:text-is("IA")')});
    if(!await section.evaluate(node=>node.open)) await section.locator('summary').click();
  };
  await settings(); await page.waitForFunction(()=>document.querySelector('[data-ai-account]')?.textContent.includes('Groq'));
  assert.equal(await page.locator('[data-ai-response],[data-ai-copy-open],[data-ai-provider],[data-ai-import]').count(),0);
  assert.equal(await page.locator('[data-ai-prompt]').inputValue(),'Innovations pratiques, VR et voitures');
  assert.equal(await page.locator('[data-ai-auto]').isChecked(),true);
  if(!native){
    assert.equal(await page.locator('[data-ai-key]').count(),0);assert.match(await page.locator('[data-ai-account]').textContent(),/APK Android/);
    assert.equal(generations,0);assert.equal(discoveryRequests,0);
  }else{
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('news-brief-ai-results-v1')||'null')?.provider==='groq');
    assert.equal(generations,1);assert.equal(discoveryRequests,1);
    await page.locator('[data-ai-open-brief]').click(); await page.waitForSelector('.ai-result-v9840');
    assert.equal(await page.locator('.brief-mode-tab').count(),3);
    assert.equal(await page.locator('.ai-result-v9840').count(),3);
    assert.equal(await page.locator('.ai-news-summary-v9840 img').count(),0);
    await page.waitForFunction(()=>document.querySelectorAll('.ai-result-v9840 img.image-ready-v98').length===3);
    const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('news-brief-ai-results-v1')));
    assert.ok(cache.sources.some(article=>article.url==='https://example.test/discovered'),'discovery includes older relevant news');
    await page.screenshot({path:output+'/brief-ia-automatique.png',fullPage:true});
    await page.locator('.bottom-nav [data-view="home"]').click();
    assert.deepEqual(await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards=>cards.map(card=>({id:card.dataset.article,src:card.querySelector('img').src}))),homeBefore,'same-document Home photos stay locked after Brief discovery');
    await settings();await page.locator('[data-ai-open-brief]').click();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('.ai-result-v9840'); await page.waitForTimeout(600);
    assert.equal(generations,1,'same 12h cache reused on reopen');
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(200);assert.equal(generations,1,'foreground signals do not duplicate calls');
    await settings(); await page.locator('[data-ai-prompt]').fill('Les innovations en VR et les nouvelles voitures, en un paragraphe.');
    await page.locator('[data-ai-generate]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('news-brief-ai-results-v1'))?.prompt.startsWith('Les innovations'));
    assert.equal(generations,2,'first click after prompt edit works');
    const last=await page.evaluate(()=>localStorage.getItem('news-brief-ai-results-v1'));
    await page.evaluate(()=>{window.__GROQ_ERROR='Limite gratuite Groq atteinte.';});
    await page.locator('[data-ai-generate]').click();await page.waitForSelector('.ai-error-v9840');
    assert.equal(await page.evaluate(()=>localStorage.getItem('news-brief-ai-results-v1')),last,'provider error retains last result');
    await page.reload({waitUntil:'domcontentloaded'});await settings();await page.waitForSelector('[data-ai-prompt]');await page.waitForTimeout(600);
    assert.equal(generations,3,'error does not trigger automatic retry');
    await page.locator('[data-ai-disconnect]').click();await page.waitForFunction(()=>document.querySelector('[data-ai-account]')?.textContent.includes('Crée une clé'));
    await page.locator('[data-ai-key]').fill('gsk_abcdefghijklmnopqrstuv');await page.locator('[data-ai-save-key]').click();
    await page.waitForFunction(()=>document.querySelector('[data-ai-account]')?.textContent.includes('Une clé est enregistrée'));
    assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage})) ).includes('gsk_'),'key absent from JS storage');
    await page.waitForTimeout(400);
    await page.screenshot({path:output+'/reglages-groq.png',fullPage:true});
    await page.locator('.bottom-nav [data-view="home"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-stable-home-feed] img.image-ready-v98').length>=8);
    // Blob URLs are document-scoped and legitimately change after a reload.
    assert.deepEqual(await page.locator('[data-stable-home-feed] .article-card').evaluateAll(cards=>cards.map(card=>card.dataset.article)),homeBefore.map(card=>card.id),'Brief discovery does not mutate Home identity or order');
  }
  assert.deepEqual(await page.evaluate(()=>window.__OLD_AI),[]);assert.deepEqual(await page.evaluate(()=>window.__CHAT),[]);
  assert.deepEqual(errors,[]);
  await writeFile(output+'/report.json',JSON.stringify({nativeFixture:native,generations,discoveryRequests,pageErrors:errors,photoRequests:photoRequests.length,note:'Browser/native bridge fixture, not a real Groq account or physical Android device'},null,2));
  console.log('PASS Groq mobile UI',JSON.stringify({native,generations,discoveryRequests,pageErrors:errors}));
}finally{await browser.close();}
