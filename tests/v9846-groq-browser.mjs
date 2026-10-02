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
let generations=0,discoveryRequests=0,briefLayout,settingsLayout;
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
      const result={summary:'Cette semaine a été riche en innovations : plusieurs nouveautés pratiques ou théoriques méritent d’être suivies.\n\nVR : un nouveau casque apporte des améliorations pratiques pour la réalité virtuelle [Source](A1).\n\nautomobile : les innovations automobiles ouvrent de nouvelles perspectives.\n\nscience : une découverte théorique reste à confirmer. <img src=x onerror=alert(1)>',cards:request.articles?.slice(0,3).map(article=>({sourceId:article.sourceId,title:'Analyse '+article.title,summary:'lancements spatiaux\ndes innovations ouvrent de nouvelles perspectives pour les recherches pratiques et théoriques.\nUtilité : suivre les évolutions et leurs conséquences concrètes.\nStatut : expérimental, selon les extraits fournis.\nSource : Informations répétées\nDétails à supprimer sous source.'}))||[]};
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
  await page.route('**/version.json**',route=>route.fulfill({json:{version:'98',codeRelease:'98.51'}}));
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
  const typography=await page.locator('.ai-settings-v9847').evaluate(root=>{
    const reference=getComputedStyle(root.querySelector('.settings-field-title')).fontSize;
    return {reference,sizes:[...root.querySelectorAll('p,strong,label,textarea,input,button,a')].map(node=>getComputedStyle(node).fontSize),service:getComputedStyle(root.querySelector('.settings-field-title')).textAlign,prompt:getComputedStyle(root.querySelector('textarea')).textAlign,labels:[...root.querySelectorAll('.ai-field-v9840>strong')].map(node=>getComputedStyle(node).textAlign)};
  });
  assert.ok(typography.sizes.every(size=>size===typography.reference),JSON.stringify(typography));
  assert.equal(typography.service,'center');assert.equal(typography.prompt,'justify');assert.ok(typography.labels.every(value=>value==='center'));
  const scales=await page.locator('.ai-settings-v9847').evaluate(root=>{
    const html=document.documentElement,original=html.style.getPropertyValue('--interface-text-scale'),results=[];
    for(const scale of [.85,1,1.5]){
      html.style.setProperty('--interface-text-scale',String(scale));
      const reference=getComputedStyle(root.querySelector('.settings-field-title')).fontSize;
      results.push({scale,reference,equal:[...root.querySelectorAll('p,strong,label,textarea,input,button,a')].every(node=>getComputedStyle(node).fontSize===reference)});
    }
    html.style.setProperty('--interface-text-scale',original);return results;
  });
  assert.ok(scales.every(result=>result.equal));assert.notEqual(scales[0].reference,scales[2].reference,'interface size preference retained');
  const openSection=async selector=>{
    const section=page.locator('.settings-accordion-v9185').filter({has:page.locator(selector).first()});
    if(!await section.evaluate(node=>node.open)) await section.locator('summary').click();
    return section;
  };
  const language=page.locator('.settings-accordion-v9185').first();
  if(await language.evaluate(node=>node.open)) await language.locator('summary').click();
  const languageHeaders=[];
  for(const width of [320,412]){
    await page.setViewportSize({width,height:915});
    for(const scale of [.85,1,1.5]){
      const measured=await page.evaluate(scale=>{
        const html=document.documentElement,original=html.style.getPropertyValue('--interface-text-scale');html.style.setProperty('--interface-text-scale',String(scale));
        const headings=[...document.querySelectorAll('.settings-accordion-v9185>summary')].slice(0,2).map(node=>{
          const rect=node.getBoundingClientRect(),style=getComputedStyle(node),arrow=getComputedStyle(node,'::after');return {height:rect.height,minHeight:style.minHeight,paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,lineHeight:style.lineHeight,right:arrow.right,centerRatio:parseFloat(arrow.top)/rect.height,transform:arrow.transform,font:arrow.fontSize};
        });html.style.setProperty('--interface-text-scale',original);return headings;
      },scale);
      const {height:firstHeight,...firstMetrics}=measured[0],{height:secondHeight,...secondMetrics}=measured[1];
      assert.deepEqual(firstMetrics,secondMetrics,JSON.stringify({width,scale,measured}));
      // Equal single-line headings; longer labels may wrap at narrow widths or large accessible text sizes.
      if(width===412&&scale<=1) assert.equal(firstHeight,secondHeight);
      assert.equal(firstMetrics.centerRatio,.5);languageHeaders.push({width,scale,measured});
    }
  }
  await openSection('[data-ui-range="textSize"]');await openSection('[data-brief-essential]');
  assert.ok(await page.locator('.preference-range>strong,.settings-accordion-content-v9185>.settings-field-title').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).textAlign==='center')));
  await openSection('[data-source-follow]');await openSection('[data-add-source]');await openSection('[data-add-watch-rule]');
  const keywordsSection=await openSection('[data-add-keyword]');
  assert.equal(await keywordsSection.locator('h3').count(),0,'duplicate À éviter heading removed');
  assert.equal(await keywordsSection.locator('#blocked-keyword-input').getAttribute('placeholder'),'À éviter');
  await openSection('[data-setting-toggle="autoRefresh"]');
  await openSection('[data-check-update]');
  assert.equal(await page.locator('.app-version-badge').evaluate(node=>getComputedStyle(node).color),'rgb(255, 255, 255)');
  if(native) assert.equal(await page.locator('.ai-field-v9840:has([data-ai-key])>strong').textContent(),'Ta clé Groq');
  const actions=await page.locator('.settings-page-v9185').evaluate(root=>{
    const selectors=['[data-source-follow]','[data-source-block]','[data-add-source]','.opml-button-v9186','[data-add-watch-rule]','.ai-account-v9840>a.secondary-btn','[data-ai-save-key]','[data-ai-disconnect]','[data-ai-generate]','[data-ai-open-brief]','[data-check-update]'];
    return selectors.flatMap(selector=>{const node=root.querySelector(selector);if(!node)return[];
      const style=getComputedStyle(node),rect=node.getBoundingClientRect(),parent=node.parentElement.getBoundingClientRect();
      return [{selector,color:style.color,background:style.backgroundColor,width:rect.width,parentWidth:parent.width,height:rect.height,padding:style.padding,disabled:!!node.disabled,centerOffset:rect.x+rect.width/2-parent.x-parent.width/2}];
    });
  });
  for(const action of actions){
    assert.equal(action.color,'rgb(255, 255, 255)',JSON.stringify(action));
    assert.equal(action.background,action.selector==='[data-source-block]'?'rgb(167, 68, 80)':'rgb(116, 97, 232)',JSON.stringify(action));
    if(!action.selector.startsWith('[data-source-')){assert.ok(action.width<action.parentWidth,JSON.stringify(action));assert.ok(action.height>=44);}
    if(action.selector==='.opml-button-v9186') assert.ok(Math.abs(action.centerOffset)<=1,JSON.stringify(action));
  }
  await openSection('[data-accent]');
  const actionColors=[];
  for(const color of ['#1262df','#ffcc00','#ffffff']){
    await page.locator('[data-accent]').evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},color);
    const checked=await page.evaluate(()=>{
      const root=document.documentElement,ink=getComputedStyle(root).getPropertyValue('--app-accent-ink').trim(),button=document.querySelector('[data-add-source]'),danger=document.querySelector('[data-source-block]');
      return {ink,color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor,danger:getComputedStyle(danger).color};
    });
    assert.equal(checked.color,checked.ink==='#ffffff'?'rgb(255, 255, 255)':'rgb(0, 0, 0)');assert.equal(checked.danger,'rgb(255, 255, 255)');
    actionColors.push({color,...checked});
  }
  await page.locator('[data-reset-accent]').click();
  for(const [name,selector] of [['sources','[data-source-follow]'],['ajouter-source','[data-add-source]'],['curseurs','[data-ui-range="textSize"]'],['essentiel','[data-brief-essential]'],['veille','[data-add-watch-rule]'],['ia','[data-ai-prompt]'],['fonctionnement','[data-setting-toggle="autoRefresh"]'],['version','[data-check-update]']]){
    await page.locator('.settings-accordion-v9185').filter({has:page.locator(selector).first()}).screenshot({path:output+'/reglages-'+name+'.png'});
  }
  const switches=await page.locator('.function-settings-v9186 .switch').evaluateAll(nodes=>nodes.map(node=>{
    const rect=node.getBoundingClientRect(),hit=getComputedStyle(node,'::before');return {width:rect.width,height:rect.height,hitWidth:hit.width,hitHeight:hit.height};
  }));
  assert.ok(switches.length===2&&switches.every(value=>value.width===38&&value.height===22&&value.hitWidth==='44px'&&value.hitHeight==='44px'));
  const originalAutoRefresh=await page.locator('[data-setting-toggle="autoRefresh"]').getAttribute('aria-checked');
  await page.locator('[data-setting-toggle="autoRefresh"]').click();
  assert.notEqual(await page.locator('[data-setting-toggle="autoRefresh"]').getAttribute('aria-checked'),originalAutoRefresh);
  await page.locator('[data-setting-toggle="autoRefresh"]').click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:output+'/reglages-actions.png',fullPage:true});
  settingsLayout={languageHeaders,actions,actionColors,switches};
  if(!native){
    assert.equal(await page.locator('[data-ai-key]').count(),0);assert.match(await page.locator('[data-ai-account]').textContent(),/APK Android/);
    assert.equal(generations,0);assert.equal(discoveryRequests,0);
    await page.locator('.bottom-nav [data-view="brief"]').click();
    for(const mode of ['watches','ai']){
      await page.locator('[data-brief-mode="'+mode+'"]').click();
      const note=page.locator('.brief-preferences-note-v9849');
      assert.equal(await note.textContent(),'Réglez vos préférences dans l’onglet Réglages');
      const empty=await note.evaluate(node=>{
        const header=document.querySelector('.page-masthead-v9186').getBoundingClientRect(),tabs=document.querySelector('.brief-mode-tabs').getBoundingClientRect(),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
        return {above:tabs.top-header.bottom,below:rect.top-tabs.bottom,color:style.color,align:style.textAlign};
      });
      assert.ok(Math.abs(empty.above-empty.below)<1,JSON.stringify(empty));assert.equal(empty.color,'rgb(0, 0, 0)');assert.equal(empty.align,'center');
    }
    assert.equal(await page.locator('.ai-empty-v9840').count(),0);
    assert.equal(await page.locator('.ai-result-v9840').count(),0);
    await page.screenshot({path:output+'/brief-ia-vide.png',fullPage:true});
  }else{
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('news-brief-ai-results-v1')||'null')?.provider==='groq');
    assert.equal(generations,1);assert.equal(discoveryRequests,1);
    await page.locator('[data-ai-open-brief]').click(); await page.waitForSelector('.ai-result-v9840');
    assert.equal(await page.locator('.brief-mode-tab').count(),3);
    assert.equal(await page.locator('.ai-result-v9840').count(),3);
    assert.equal(await page.locator('.ai-news-summary-v9840 img').count(),0);
    await page.waitForFunction(()=>document.querySelectorAll('.ai-result-v9840 img.image-ready-v98').length===3);
    const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem('news-brief-ai-results-v1')));
    const expected=cache.cards.slice().sort((a,b)=>Date.parse(b.article.publishedAt)-Date.parse(a.article.publishedAt)).map(card=>card.article.id);
    assert.deepEqual(await page.locator('.ai-result-v9840 article').evaluateAll(nodes=>nodes.map(node=>node.dataset.article)),expected);
    assert.equal(await page.locator('.ai-summary-paragraph-v9847').count(),4);
    assert.equal(await page.locator('.ai-news-summary-v9840 h3').count(),0);
    assert.equal(await page.locator('.ai-summary-paragraph-v9847').first().evaluate(node=>getComputedStyle(node).textAlign),'justify');
    assert.ok(!(await page.locator('.ai-brief-v9840').textContent()).includes('Synthèse actualisée'));
    assert.ok(!(await page.locator('.ai-brief-v9840').textContent()).includes('Dernière synthèse conservée'));
    const layout=await page.locator('.ai-brief-v9840').evaluate(root=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      const header=rect('.ai-brief-page-v9848>.page-masthead-v9186'),tabs=rect('.brief-mode-tabs'),summary=rect('.ai-news-summary-v9840');
      return {headerGap:tabs.top-header.bottom,contentGap:summary.top-tabs.bottom,preferencesCount:document.querySelectorAll('.brief-preferences-note-v9849').length,footers:root.querySelectorAll('footer').length,
        headings:[...root.querySelectorAll('.ai-card-title-v9849')].map(node=>({align:getComputedStyle(node).textAlign,weight:getComputedStyle(node).fontWeight,font:parseFloat(getComputedStyle(node).fontSize),bodyFont:parseFloat(getComputedStyle(node.parentElement.querySelector('.ai-card-summary-v9840')).fontSize),beforePreview:node.getBoundingClientRect().bottom<=node.nextElementSibling.getBoundingClientRect().top})),
        dates:[...root.querySelectorAll('.ai-publication-v9848')].map(node=>({inHeader:!!node.closest('.article-card'),toRight:node.getBoundingClientRect().left>=node.previousElementSibling.getBoundingClientRect().right,text:node.textContent})),
        bodies:[...root.querySelectorAll('.ai-card-summary-v9840')].map(node=>node.textContent),
        borders:[...root.querySelectorAll('.ai-result-v9840')].slice(1).map(node=>({width:getComputedStyle(node).borderTopWidth,color:getComputedStyle(node).borderTopColor})),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(layout.footers,0);assert.equal(layout.preferencesCount,0);assert.ok(Math.abs(layout.headerGap-layout.contentGap)<1,JSON.stringify(layout));assert.equal(layout.headerGap,14);
    assert.ok(layout.headings.length===3&&layout.headings.every(value=>value.align==='center'&&Number(value.weight)>=700&&value.beforePreview&&value.font>value.bodyFont));
    assert.ok(await page.locator('.ai-summary-paragraph-v9847').evaluateAll(nodes=>nodes.every(node=>{const clone=node.cloneNode(true);clone.querySelector('strong')?.remove();return /^[\p{Lu}]/u.test(clone.textContent.trim());})),'each category paragraph starts with a capital');
    assert.ok(await page.locator('.ai-card-summary-v9840 p').evaluateAll(nodes=>nodes.every(node=>/^[\p{Lu}]/u.test(node.textContent.trim()))),'card prose starts with capitals');
    assert.ok(layout.dates.length===3&&layout.dates.every(value=>value.inHeader&&value.toRight&&/\d{2}\/\d{2}\/\d{4}/.test(value.text)));
    assert.ok(layout.bodies.every(value=>!/(Utilité|Statut|Source|Détails à supprimer)/.test(value)&&value.includes('Suivre les évolutions')&&value.includes('Expérimental')));
    assert.ok(!(await page.locator('.ai-brief-v9840').textContent()).includes('Synthèse de tes sujets'));
    assert.equal(await page.getByText('Lire la source originale',{exact:true}).count(),0);
    assert.ok(layout.borders.every(border=>border.width==='2px'&&border.color==='rgb(17, 17, 17)'));assert.equal(layout.overflow,false);
    briefLayout=layout;
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    const bottomGap=await page.evaluate(()=>document.querySelector('.bottom-nav').getBoundingClientRect().top-document.querySelector('.ai-result-v9840:last-child .ai-card-summary-v9840>:last-child').getBoundingClientRect().bottom);
    assert.ok(bottomGap>=8&&bottomGap<=20,'last article stays above the navigation without excess space: '+bottomGap);
    briefLayout.bottomGap=bottomGap;
    await page.setViewportSize({width:320,height:915});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow on narrow phones');
    await page.evaluate(()=>document.documentElement.style.setProperty('--interface-text-scale','1.5'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'large text on a narrow phone stays within the viewport');
    await page.evaluate(()=>document.documentElement.style.removeProperty('--interface-text-scale'));
    await page.setViewportSize({width:412,height:915});
    assert.ok(cache.sources.some(article=>article.url==='https://example.test/discovered'),'discovery includes older relevant news');
    await page.evaluate(()=>window.scrollTo(0,0));
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
  // Watch instructions depend on actual visible articles, not merely on saved rules.
  const generationsBeforeWatch=generations;
  await page.locator('.bottom-nav [data-view="brief"]').click();await page.locator('[data-brief-mode="watches"]').click();
  assert.equal(await page.locator('.brief-preferences-note-v9849').count(),1);
  await settings();await openSection('[data-add-watch-rule]');await page.locator('#watch-query-input').fill('NoMatchingTopic987654');await page.locator('[data-add-watch-rule]').click();
  await page.locator('.bottom-nav [data-view="brief"]').click();await page.locator('[data-brief-mode="watches"]').click();
  assert.equal(await page.locator('.brief-preferences-note-v9849').count(),1,'rules without matching articles remain empty');
  await settings();await openSection('[data-add-watch-rule]');await page.locator('[data-watch-rule-delete]').first().click();
  await page.locator('#watch-query-input').fill('VR');await page.locator('[data-add-watch-rule]').click();
  await page.locator('.bottom-nav [data-view="brief"]').click();await page.locator('[data-brief-mode="watches"]').click();
  assert.ok(await page.locator('.watch-filtered-feed-v9138 .article-card').count()>0);assert.equal(await page.locator('.brief-preferences-note-v9849').count(),0);
  const watchLayout=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(),header=r('.page-masthead-v9186'),tabs=r('.brief-mode-tabs'),content=r('.watch-day-v9138');return {headerGap:tabs.top-header.bottom,contentGap:content.top-tabs.bottom};});
  assert.equal(watchLayout.headerGap,14);assert.ok(Math.abs(watchLayout.contentGap-watchLayout.headerGap)<1,JSON.stringify(watchLayout));
  await page.screenshot({path:output+'/brief-veille-remplie.png',fullPage:true});
  await settings();await openSection('[data-add-watch-rule]');await page.locator('[data-watch-rule-delete]').first().click();
  await page.locator('.bottom-nav [data-view="brief"]').click();await page.locator('[data-brief-mode="watches"]').click();
  assert.equal(await page.locator('.brief-preferences-note-v9849').count(),1,'instruction returns when all matching rules are removed');
  assert.equal(generations,generationsBeforeWatch,'presentation/navigation does not regenerate IA');
  if(native){
    const prior=await page.evaluate(()=>localStorage.getItem('news-brief-ai-results-v1'));
    await page.evaluate(()=>{const key='news-brief-ai-results-v1',value=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...value,cards:[]}));const config=JSON.parse(localStorage.getItem('news-brief-ai-settings-v1'));localStorage.setItem('news-brief-ai-settings-v1',JSON.stringify({...config,autoAtOpen:false}));});
    await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-brief-mode="ai"]').click();await page.waitForSelector('.ai-news-summary-v9840');
    assert.equal(await page.locator('.ai-result-v9840').count(),0);assert.equal(await page.locator('.brief-preferences-note-v9849').count(),0,'summary without cards is still content');
    await page.evaluate(()=>localStorage.removeItem('news-brief-ai-results-v1'));await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('.brief-preferences-note-v9849');assert.equal(await page.locator('.ai-news-summary-v9840').count(),0);
    await page.evaluate(value=>localStorage.setItem('news-brief-ai-results-v1',value),prior);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.ai-result-v9840');
    assert.equal(await page.evaluate(()=>localStorage.getItem('news-brief-ai-results-v1')),prior,'rendering preserves the source cache');
    assert.equal(generations,generationsBeforeWatch,'restoring/capitalizing cached results does not consume Groq');
  }
  assert.deepEqual(await page.evaluate(()=>window.__OLD_AI),[]);assert.deepEqual(await page.evaluate(()=>window.__CHAT),[]);
  assert.deepEqual(errors,[]);
  await writeFile(output+'/report.json',JSON.stringify({nativeFixture:native,typography,scales,settingsLayout,briefLayout,generations,discoveryRequests,pageErrors:errors,photoRequests:photoRequests.length,note:'Browser/native bridge fixture, not a real Groq account or physical Android device'},null,2));
  console.log('PASS Groq mobile UI',JSON.stringify({native,generations,discoveryRequests,pageErrors:errors}));
}finally{await browser.close();}
