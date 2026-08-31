(() => {
  'use strict';
  const RELEASE='91.38', LEGACY='91.37', CACHE='news-live-cache', SETTINGS='news-settings', KEYWORDS='news-keywords', HOME='news-home-topics-v9138', AI_CACHE='news-verified-ai-summaries-v9138';
  const HOME_CATS=new Set(['IA','Tech','Smartphones','VR','Automobile','Énergie']);
  const ALIASES={
    'recherche scientifique':['recherche','science','scientifique','laboratoire','etude','decouverte'],
    'innovations':['innovation','startup','brevet','recherche','nouvelle technologie'],
    'innovation':['innovation','startup','brevet','recherche','nouvelle technologie'],
    'progres humains':['progres','avancee','decouverte','qualite de vie','education','droits humains'],
    'medecine':['medecine','medical','sante','traitement','therapie','vaccin','chirurgie'],
    'espace':['espace','spatial','astronomie','nasa','esa','satellite','lune','mars'],
    'energie':['energie','electricite','nucleaire','solaire','eolien','batterie','hydrogene'],
    'environnement':['environnement','climat','biodiversite','pollution','ecologie'],
    'education':['education','ecole','universite','apprentissage','formation'],
    'vr':['vr','realite virtuelle','virtual reality','quest','steamvr'],
    'ia':['ia','intelligence artificielle','openai','chatgpt','gemini','anthropic']
  };
  let lastArticle='', scheduled=false;
  const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const esc=v=>clean(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uniq=a=>{const s=new Set(),r=[];for(const x of Array.isArray(a)?a:[]){const v=clean(x),k=norm(v);if(v&&k&&!s.has(k)){s.add(k);r.push(v)}}return r};
  const settings=()=>{const s=read(SETTINGS,{});return s&&typeof s==='object'?s:{}};
  const articles=()=>{const c=read(CACHE,{});return Array.isArray(c.articles)?c.articles:[]};
  const homeTopics=()=>{const x=read(HOME,null);if(Array.isArray(x))return uniq(x);const init=uniq(settings().interests||[]);write(HOME,init);return init};
  const watchTopics=()=>uniq(settings().briefWatchTopics||[]);
  const saveWatch=a=>{const s=settings();s.briefWatchTopics=uniq(a);write(SETTINGS,s)};
  const addKeyword=t=>write(KEYWORDS,uniq([...read(KEYWORDS,[]),t]));
  const keepKeyword=t=>{const k=norm(t);return homeTopics().some(x=>norm(x)===k)||watchTopics().some(x=>norm(x)===k)};
  const removeKeyword=t=>{if(keepKeyword(t))return;const k=norm(t);write(KEYWORDS,uniq(read(KEYWORDS,[]).filter(x=>norm(x)!==k)))};
  const reload=()=>setTimeout(()=>location.reload(),80);

  function setTopic(kind,value,remove=false){value=clean(value);if(!value)return;const k=norm(value);if(kind==='home'){
    let h=homeTopics();h=remove?h.filter(x=>norm(x)!==k):uniq([...h,value]);write(HOME,h);
    const s=settings(), interests=Array.isArray(s.interests)?s.interests:[];
    if(remove)s.interests=interests.filter(x=>norm(x)!==k);else if(HOME_CATS.has(value))s.interests=uniq([...interests,value]);write(SETTINGS,s);
    if(!remove&&!HOME_CATS.has(value))addKeyword(value);
  }else{
    const w=watchTopics();saveWatch(remove?w.filter(x=>norm(x)!==k):uniq([...w,value]));if(!remove)addKeyword(value);
  }
  if(remove)removeKeyword(value);reload();}

  function editor(kind,topics){const home=kind==='home', ph=home?'Ex. robotique, Allemagne, voitures électriques…':'Ex. fusion nucléaire, Alzheimer, Quest 4…';return `<div class="direct-topic-editor-v9138"><div class="direct-topic-form-v9138"><input class="text-input" data-direct-topic-input="${kind}" maxlength="80" autocomplete="off" placeholder="${esc(ph)}"><button type="button" class="small-primary-btn" data-direct-topic-add="${kind}">${home?'Ajouter à l’accueil':'Ajouter à mes veilles'}</button></div>${topics.length?`<div class="direct-topic-list-v9138">${topics.map(t=>`<div class="direct-topic-item-v9138"><span>${esc(t)}</span><button type="button" data-direct-topic-remove="${kind}" data-topic="${esc(t)}">×</button></div>`).join('')}</div>`:'<p class="direct-topic-empty-v9138">Aucun sujet ajouté.</p>'}</div>`}

  function patchSheet(){const sh=document.querySelector('.personalization-sheet');if(!sh)return;for(const sec of sh.querySelectorAll('.personalize-section')){const title=clean(sec.querySelector('h3')?.textContent);const kind=/^Accueil$/i.test(title)?'home':/Mes veilles/i.test(title)?'watches':'';if(!kind)continue;const topics=kind==='home'?homeTopics():watchTopics(), sig=topics.map(norm).join('|');if(sec.dataset.directV9138===sig&&sec.querySelector('.direct-topic-editor-v9138'))continue;sec.querySelectorAll(':scope > .personalize-chips,:scope > .personalize-add,:scope > .direct-topic-editor-v9138').forEach(n=>n.remove());sec.insertAdjacentHTML('beforeend',editor(kind,topics));sec.dataset.directV9138=sig;const p=sec.querySelector(':scope > p');if(p)p.textContent=kind==='home'?'Tapez librement les sujets que vous voulez faire remonter sur la page principale.':'Tapez librement les sujets que vous voulez suivre. Les résultats sont classés par jour.'}}

  const articleText=a=>norm([a.title,a.summary,a.detail,a.category,a.source,...(a.tags||[]),...(a.matches||[])].filter(Boolean).join(' '));
  const terms=t=>uniq([norm(t),...(ALIASES[norm(t)]||[])].map(norm));
  const has=(text,t)=>t.length<=3&&!t.includes(' ')?(` ${text} `).includes(` ${t} `):text.includes(t);
  const matches=(a,t)=>norm(a.category)===norm(t)||terms(t).some(x=>has(articleText(a),x));
  const matched=(a,ts)=>ts.filter(t=>matches(a,t));

  function reorderHome(){if(!document.querySelector('.nav-item.active[data-view="home"]'))return;const feed=document.querySelector('.page .feed'), ts=homeTopics();if(!feed||!ts.length)return;const map=new Map(articles().map(a=>[String(a.id),a])), cards=[...feed.querySelectorAll(':scope > .article-card[data-article]')];if(cards.length<2)return;const before=cards.map(c=>c.dataset.article).join(','), sig=ts.map(norm).join('|')+'|'+before;if(feed.dataset.directOrderV9138===sig)return;const ordered=cards.map((card,i)=>({card,i,n:matched(map.get(String(card.dataset.article))||{},ts).length})).sort((a,b)=>b.n-a.n||a.i-b.i);feed.prepend(...ordered.map(x=>x.card));feed.dataset.directOrderV9138=ts.map(norm).join('|')+'|'+ordered.map(x=>x.card.dataset.article).join(',')}

  const dayKey=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'unknown':`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`};
  function dayLabel(v){const d=new Date(v);if(Number.isNaN(d.getTime()))return'Date inconnue';const n=new Date(),today=new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime(),t=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();if(t===today)return'Aujourd’hui';if(t===today-86400000)return'Hier';const x=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(d);return x[0].toUpperCase()+x.slice(1)}
  function todayLabel(){const x=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(new Date());return x[0].toUpperCase()+x.slice(1)}
  const time=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(d)};
  function image(a){const raw=clean(a.visual?.url||a.image||a.quickVisualUrl);if(raw&&!/^data:image\/svg\+xml/i.test(raw))return raw;const p=new URLSearchParams({v:'19',url:clean(a.url).slice(0,1900),image:clean(a.image).slice(0,1900),title:clean(a.title).slice(0,280),category:clean(a.category).slice(0,70),source:clean(a.source).slice(0,100)});return`/api/article-thumbnail?${p}`}
  function row(a,ts,i){const m=matched(a,ts).slice(0,3);return `<article class="article-card runtime-row watch-row-v9138" data-article="${esc(a.id)}" tabindex="0"><img class="article-image original-article-image stable-visual" src="${esc(image(a))}" alt="" width="400" height="224" loading="${i<4?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer"><div class="article-body"><h2>${esc(a.title)}</h2><div class="meta"><span class="source">${esc(a.source||'Source')}</span><span>${esc(time(a.publishedAt))}</span></div>${m.length?`<small class="watch-matches-v9138">${m.map(esc).join(' · ')}</small>`:''}</div></article>`}

  function watchesByDay(){if(!document.querySelector('.brief-mode-tab.active[data-brief-mode="watches"]'))return;const rt=document.querySelector('.runtime-brief-content');if(!rt)return;const ts=watchTopics(), fb=read('news-feedback',{}), items=articles().filter(a=>fb[a.id]!=='not'&&ts.some(t=>matches(a,t))).sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,80), sig=ts.map(norm).join('|')+'|'+items.map(a=>a.id).join('|');if(rt.dataset.watchDaysV9138===sig&&rt.querySelector('.watches-by-day-v9138'))return;const groups=[], map=new Map();for(const a of items){const k=dayKey(a.publishedAt);let g=map.get(k);if(!g){g={label:dayLabel(a.publishedAt),items:[]};map.set(k,g);groups.push(g)}g.items.push(a)}rt.innerHTML=`<section class="watches-by-day-v9138"><div class="watches-head-v9138"><strong>Mes veilles</strong><span>Classées par jour</span></div>${editor('watches',ts)}${groups.length?groups.map((g,gi)=>`<section class="watch-day-v9138"><h3>${esc(g.label)}</h3><div class="feed">${g.items.map((a,i)=>row(a,ts,gi*10+i)).join('')}</div></section>`).join(''):'<p class="muted-note">Aucun article récent ne correspond encore à vos veilles.</p>'}</section>`;rt.dataset.watchDaysV9138=sig}

  function fullBrief(){if(!document.querySelector('.nav-item.active[data-view="brief"]'))return;document.querySelectorAll('.brief-diff-v80').forEach(n=>n.remove());document.querySelectorAll('.brief-points').forEach(n=>n.hidden=false);document.querySelectorAll('.brief-points > .brief-point').forEach(n=>n.hidden=false);if(!document.querySelector('.brief-mode-tab.active[data-brief-mode="essential"]'))return;const rt=document.querySelector('.runtime-brief-content');if(!rt)return;for(const child of rt.children)if(!child.classList.contains('brief-smart-v87'))child.hidden=false;const journal=rt.querySelector('.journal-section');if(journal&&!journal.querySelector('.brief-day-v9138'))journal.insertAdjacentHTML('afterbegin',`<div class="brief-day-v9138">${esc(todayLabel())}</div>`)}

  function autoNews(){const b=document.querySelector('[data-apply-news-v80]');if(!b||b.dataset.autoV9138)return;b.dataset.autoV9138='1';setTimeout(()=>{if(b.isConnected)b.click()},0)}

  function goodSummary(v){const t=clean(v);return t.length>=55&&!/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(t)}
  function modalArticle(m){if(lastArticle){const a=articles().find(x=>String(x.id)===lastArticle);if(a)return a}const title=norm(m.querySelector('.quick-summary-head h2')?.textContent),source=norm(m.querySelector('.quick-summary-meta span')?.textContent);return articles().find(a=>{const t=norm(a.title),s=norm(a.source);return title&&(t.includes(title)||title.includes(t))&&(!source||s===source)})}
  function status(m,text,cls=''){let s=m.querySelector('.quick-summary-status-v9138');const box=m.querySelector('[data-quick-summary-text]');if(!s&&box){s=document.createElement('div');box.before(s)}if(s){s.className=`quick-summary-status-v9138 ${cls}`;s.textContent=text}}
  function directAi(a){return new Promise(resolve=>{try{const x=new XMLHttpRequest();x.open('POST','/api/article-summary-groq?v=18&intent=foreground',true);x.setRequestHeader('Content-Type','application/json');x.timeout=22000;x.onload=()=>{try{resolve(x.status>=200&&x.status<300?JSON.parse(x.responseText):null)}catch{resolve(null)}};x.onerror=x.ontimeout=()=>resolve(null);x.send(JSON.stringify({mode:'article',article:{url:a.url,title:clean(a.title),summary:clean(a.summary),source:clean(a.source)}}))}catch{resolve(null)}})}
  async function fixModal(m){if(m.dataset.aiFixV9138)return;m.dataset.aiFixV9138='1';const a=modalArticle(m);if(!a)return;const key=`article:${a.id}`, cached=read(AI_CACHE,{})[key], box=m.querySelector('[data-quick-summary-text]');if(cached?.summary&&goodSummary(cached.summary)){if(box)box.textContent=clean(cached.summary);status(m,'Résumé IA','ai');return}status(m,'Résumé IA en préparation…','loading');const data=await directAi(a);if(!m.isConnected)return;const sum=clean(data?.summary);if(data?.ai===true&&!data?.unavailable&&goodSummary(sum)){const c=read(AI_CACHE,{});c[key]={summary:sum,savedAt:Date.now()};write(AI_CACHE,Object.fromEntries(Object.entries(c).slice(-180)));if(box)box.textContent=sum;status(m,'Résumé IA','ai')}else status(m,goodSummary(box?.textContent)?'Extrait de la source · résumé IA indisponible':'Résumé IA indisponible','source')}

  function versionUi(){document.documentElement.dataset.codeRelease=RELEASE;const s=document.querySelector('.app-version-section');if(s){const title=s.querySelector('.app-version-row strong'),rel=s.querySelector('.app-version-row span:not(.app-version-badge)'),badge=s.querySelector('.app-version-badge');if(title)title.textContent=`Mon actualité · version ${RELEASE}`;if(rel)rel.textContent='Publication du 31 août 2026';if(badge)badge.textContent=`v${RELEASE}`;s.dataset.codeRelease=RELEASE}const toast=document.getElementById('toast');if(toast&&/Version\s+91\.37\s+à jour/i.test(toast.textContent||''))toast.textContent=`Version ${RELEASE} à jour`}
  function releaseCompat(){const up=window.fetch.bind(window);window.fetch=async function(input,init){const r=await up(input,init);try{const raw=typeof input==='string'?input:input?.url||'',u=new URL(raw,location.href);if(r?.ok&&u.origin===location.origin&&u.pathname==='/version.json'&&u.searchParams.has('release-check')){const d=await r.clone().json();if(clean(d?.codeRelease)===RELEASE){d.codeRelease=LEGACY;const h=new Headers(r.headers);h.delete('content-length');h.delete('content-encoding');h.set('Content-Type','application/json; charset=utf-8');return new Response(JSON.stringify(d),{status:r.status,statusText:r.statusText,headers:h})}}}catch{}return r}}

  function enhance(){scheduled=false;autoNews();patchSheet();reorderHome();fullBrief();watchesByDay();versionUi();const m=document.querySelector('.quick-summary-backdrop');if(m)fixModal(m)}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(enhance)}

  const st=document.createElement('style');st.id='ui-summary-fixes-v9138';st.textContent=`
    .hero-header p,.new-info-banner-v80,.brief-smart-v87,.brief-diff-v80,.verification-note-v83.single{display:none!important}
    .article-card.new-since-visit-v79:not(.essential-v77)::after{content:none!important;display:none!important}
    .article-card.essential-v77{border-color:rgba(232,227,244,.8)!important;background:var(--card,rgba(255,255,255,.97))!important;box-shadow:var(--shadow,0 10px 30px rgba(74,60,119,.07))!important}.article-card.essential-v77 .article-body{background:transparent!important}
    .quick-summary-text{border-color:#e8e5ec!important;background:#fff!important}.quick-summary-status-v9138{margin:5px 2px 7px;color:#716b78;font-size:11px;font-weight:800;line-height:1.3}.quick-summary-status-v9138.ai{color:#5644bd}.quick-summary-status-v9138.source{color:#817a88;font-weight:700}
    .direct-topic-editor-v9138{margin-top:12px}.direct-topic-form-v9138{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.direct-topic-form-v9138 .small-primary-btn{min-height:44px;white-space:nowrap}.direct-topic-list-v9138{display:grid;gap:7px;margin-top:10px}.direct-topic-item-v9138{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:center;min-height:42px;padding:5px 5px 5px 11px;border:1px solid #e7e3ec;border-radius:12px;background:#fff}.direct-topic-item-v9138 span{font-size:12px;font-weight:700;overflow-wrap:anywhere}.direct-topic-item-v9138 button{width:34px;height:34px;border:0;border-radius:10px;background:#f1eef5;color:#625b6b;font-size:20px}.direct-topic-empty-v9138{margin:9px 2px 0!important;color:#8a8492!important;font-size:11px!important}
    .brief-day-v9138{margin:2px 0 12px;color:#6f6878;font-size:12px;font-weight:800;text-transform:capitalize}.watches-head-v9138{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:2px 0 8px}.watches-head-v9138 strong{font-size:18px}.watches-head-v9138 span{color:#8a8493;font-size:11px;font-weight:700}.watch-day-v9138{margin-top:20px}.watch-day-v9138>h3{margin:0 0 9px;color:#5f5868;font-size:13px;font-weight:850;text-transform:capitalize}.watch-day-v9138 .feed{display:grid;gap:10px}.watch-matches-v9138{display:block;margin-top:5px;color:#837b8c;font-size:9.5px;font-weight:700;line-height:1.25}
    @media(max-width:380px){.direct-topic-form-v9138{grid-template-columns:1fr}.direct-topic-form-v9138 .small-primary-btn{width:100%}}
  `;document.head.appendChild(st);
  releaseCompat();
  document.addEventListener('click',e=>{const card=e.target.closest?.('[data-article]');if(card?.dataset.article)lastArticle=String(card.dataset.article);const add=e.target.closest?.('[data-direct-topic-add]');if(add){e.preventDefault();e.stopImmediatePropagation();const k=add.dataset.directTopicAdd,input=document.querySelector(`[data-direct-topic-input="${k}"]`);setTopic(k,input?.value||'');return}const rem=e.target.closest?.('[data-direct-topic-remove]');if(rem){e.preventDefault();e.stopImmediatePropagation();setTopic(rem.dataset.directTopicRemove,rem.dataset.topic||'',true)}},true);
  document.addEventListener('keydown',e=>{const input=e.target.closest?.('[data-direct-topic-input]');if(input&&e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();setTopic(input.dataset.directTopicInput,input.value||'')}},true);
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});setTimeout(schedule,0);setTimeout(schedule,250);
})();
