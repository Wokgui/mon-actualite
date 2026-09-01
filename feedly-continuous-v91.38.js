(() => {
'use strict';
const CACHE='news-live-cache', SETTINGS='news-settings', KEYWORDS='news-keywords', GREY='news-grey-after-scroll-v9138-v1';
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const esc=v=>clean(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uniq=values=>{const out=[],seen=new Set();for(const raw of Array.isArray(values)?values:[]){const v=clean(raw),k=norm(v);if(!v||!k||seen.has(k))continue;seen.add(k);out.push(v)}return out};
const articles=()=>{const c=read(CACHE,{});return Array.isArray(c.articles)?c.articles:[]};
const settings=()=>{const s=read(SETTINGS,{});return s&&typeof s==='object'?s:{}};
const activeView=()=>document.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset?.view||'';
const mode=()=>document.querySelector('.brief-mode-tab.active[data-brief-mode]')?.dataset?.briefMode||'';

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
'ia':['ia','intelligence artificielle','openai','chatgpt','gemini','anthropic']};
const terms=t=>uniq([norm(t),...(ALIASES[norm(t)]||[])].map(norm));
const articleText=a=>norm([a.title,a.summary,a.detail,a.category,a.source,...(a.tags||[]),...(a.matches||[])].filter(Boolean).join(' '));
const has=(text,term)=>term.length<=3&&!term.includes(' ')?(` ${text} `).includes(` ${term} `):text.includes(term);
const matches=(a,t)=>norm(a.category)===norm(t)||terms(t).some(term=>has(articleText(a),term));
const watchTopics=()=>uniq(settings().briefWatchTopics||[]);

function dayDelta(v){const d=new Date(v),n=new Date();if(Number.isNaN(d.getTime()))return 999;return Math.round((new Date(n.getFullYear(),n.getMonth(),n.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000)}
function fullDay(v){const d=new Date(v);if(Number.isNaN(d.getTime()))return'';const x=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(d);return x.charAt(0).toUpperCase()+x.slice(1)}
function dayLabel(v){const d=dayDelta(v);if(d===0)return'Aujourd’hui';if(d===1)return'Hier';if(d===2)return'Avant-hier';return fullDay(v)}
function dayKey(v){const d=new Date(v);return Number.isNaN(d.getTime())?'unknown':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function clock(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(d)}
function image(a){const r=clean(a.visual?.url||a.image||a.quickVisualUrl);if(r&&!/^data:image\/svg\+xml/i.test(r))return r;const p=new URLSearchParams({v:'19',url:clean(a.url).slice(0,1900),image:clean(a.image).slice(0,1900),title:clean(a.title).slice(0,280),category:clean(a.category).slice(0,70),source:clean(a.source).slice(0,100)});return`/api/article-thumbnail?${p}`}
function row(a,i=0){return `<article class="article-card runtime-row" data-article="${esc(a.id)}" tabindex="0"><img class="article-image original-article-image stable-visual" src="${esc(image(a))}" alt="" width="400" height="224" loading="${i<12?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer" ${i<8?'fetchpriority="high"':''}><div class="article-body"><h2>${esc(a.title)}</h2><div class="meta"><span class="source">${esc(a.source||'Source')}</span><span>${esc(clock(a.publishedAt))}</span></div></div></article>`}

/* One final Brief renderer. feedly-runtime creates the structural view; this
   MutationObserver finalizes it in the same microtask, before the browser paints.
   There are no delayed bursts, focus rerenders or 350/700 ms second passes. */
const major=/guerre|attaque|cessez-le-feu|élection|gouvernement|président|premier ministre|attentat|catastrophe|séisme|inondation|incendie|crise|accord|sommet|justice|condamn|budget|déficit|croissance|inflation|chômage|épidémie|climat|diplomatie|nucléaire|réforme|retraite/i;
const low=/football|match|mercato|tennis|formule 1|promotion|bon plan|soldes|réduction|console|jeu vidéo|gta|people|célébrité|télé-réalité/i;
const editorial=new Set(['Politique','International','Europe','Économie','Société','Santé','Environnement','Science']);
const impact=a=>Number(a.score||0)+(editorial.has(a.category)?65:0)+(major.test(`${a.title||''} ${a.summary||''}`)?80:0)+Math.max(0,(a.sources?.length||1)-1)*25-(low.test(`${a.title||''} ${a.summary||''}`)?180:0);
function historyDays(){const fb=read('news-feedback',{}),map=new Map();for(const a of articles()){const d=dayDelta(a.publishedAt);if(d<1||d>8||fb[a.id]==='not')continue;const k=dayKey(a.publishedAt);if(!map.has(k))map.set(k,[]);map.get(k).push(a)}return[...map.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7).map(([k,v])=>({k,v:v.sort((a,b)=>impact(b)-impact(a)).slice(0,5)}))}
function finalizeEssential(){
 if(activeView()!=='brief'||mode()!=='essential')return;
 const rt=document.querySelector('.runtime-brief-content'),j=rt?.querySelector('.journal-section');if(!rt||!j)return;
 let d=j.querySelector('.brief-day-v9138');const today=fullDay(new Date());
 if(!d){d=document.createElement('div');d.className='brief-day-v9138';j.prepend(d)}if(d.textContent!==today)d.textContent=today;
 const title=j.querySelector('.brief-section-title');if(title&&title.textContent!=='Les 5 événements majeurs')title.textContent='Les 5 événements majeurs';
 j.querySelectorAll(':scope>.muted-note,.brief-scope').forEach(n=>n.remove());
 const days=historyDays(),sig=days.map(x=>`${x.k}:${x.v.map(a=>a.id).join(',')}`).join('|');let old=rt.querySelector('.brief-history-v9138');
 if(old?.dataset.sig===sig)return;
 const next=document.createElement('section');next.className='brief-history-v9138';next.dataset.sig=sig;next.innerHTML=days.map((x,di)=>`<section class="brief-history-day-v9138"><div class="brief-history-date-v9138">${esc(dayLabel(x.v[0]?.publishedAt))}${dayDelta(x.v[0]?.publishedAt)<=2?` · ${esc(fullDay(x.v[0]?.publishedAt))}`:''}</div><div class="feed">${x.v.map((a,i)=>row(a,di*10+i)).join('')}</div></section>`).join('');
 if(old)old.replaceWith(next);else j.after(next);
}
function renderWatches(){
 if(activeView()!=='brief'||mode()!=='watches')return;
 const rt=document.querySelector('.runtime-brief-content');if(!rt)return;
 const topics=watchTopics(),fb=read('news-feedback',{}),all=articles().filter(a=>fb[a.id]!=='not').sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,220);
 const order=[],map=new Map();for(const a of all){const k=dayKey(a.publishedAt);if(!map.has(k)){map.set(k,[]);order.push(k)}map.get(k).push(a)}
 const days=order.slice(0,9),sig=`${topics.map(norm).join('|')}::${days.map(k=>`${k}:${map.get(k).map(a=>a.id).join(',')}`).join('|')}`;
 if(rt.dataset.feedlyWatchSigV9138===sig&&rt.querySelector('.watch-layout-v9138'))return;
 const groups=days.map((k,gi)=>{const dayArticles=map.get(k)||[],watched=topics.length?dayArticles.filter(a=>topics.some(t=>matches(a,t))):[],sample=dayArticles[0];const w=watched.length?`<div class="feed watch-filtered-feed-v9138">${watched.slice(0,30).map((a,i)=>row(a,gi*40+i)).join('')}</div>`:'<p class="watch-empty-day-v9138">Aucune nouvelle de vos veilles ce jour-là.</p>';const allMarkup=`<div class="feed watch-all-feed-v9138" hidden>${dayArticles.map((a,i)=>row(a,gi*40+i)).join('')}</div>`;return `<section class="watch-day-v9138"><h3>${esc(dayLabel(sample?.publishedAt))}</h3>${w}<button type="button" class="watch-all-band-v9138" data-watch-all-toggle><span>Toute l’actualité</span><small>${dayArticles.length} article${dayArticles.length>1?'s':''}</small></button>${allMarkup}</section>`}).join('');
 rt.innerHTML=`<section class="watches-by-day-v9138 watch-layout-v9138"><div class="watches-head-v9138"><strong>Mes veilles</strong><button type="button" class="watch-edit-button-v9138" data-watch-edit-open>Modifier veilles</button></div>${groups||'<p class="muted-note">Aucune actualité récente.</p>'}</section>`;rt.dataset.feedlyWatchSigV9138=sig;
}
function finalizeBrief(){if(activeView()!=='brief')return;if(mode()==='watches')renderWatches();else if(mode()==='essential')finalizeEssential();prepareImages();bindCards();syncGrey();icon()}
let finalizing=false;
const app=document.getElementById('app');
if(app)new MutationObserver(()=>{if(finalizing)return;finalizing=true;queueMicrotask(()=>{try{finalizeBrief();if(activeView()==='home'){bindCards();syncGrey();icon()}}finally{finalizing=false}})}).observe(app,{childList:true,subtree:true});

/* Same read/grey semantics on Home and Brief, with no DOM rebuilding. */
const grey=new Set(read(GREY,[]).map(String)),observed=new WeakSet();let down=false,lastY=scrollY,scrollScheduled=false;
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.intersectionRatio>=.55)e.target.dataset.greyEligibleV9138='1'}),{threshold:[.55]});
function cards(){if(!['home','brief'].includes(activeView()))return[];return[...document.querySelectorAll('.page .feed .article-card[data-article]')]}
function bindCards(){for(const c of cards()){if(observed.has(c))continue;observed.add(c);io.observe(c)}}
function syncGrey(){for(const c of cards()){const id=String(c.dataset.article||'');c.classList.toggle('read-passed-v9138',Boolean(id&&grey.has(id)))}}
function markPassed(){if(!down||document.querySelector('.quick-summary-backdrop'))return;let changed=false;for(const c of cards()){if(c.dataset.greyEligibleV9138!=='1'||c.classList.contains('read-passed-v9138'))continue;const r=c.getBoundingClientRect();if(r.top<0&&r.bottom<=Math.max(20,innerHeight*.05)){const id=String(c.dataset.article||'');if(id){grey.add(id);c.classList.add('read-passed-v9138');changed=true}}}if(changed)write(GREY,[...grey].slice(-1600))}
function resetGrey(){grey.clear();write(GREY,[]);document.querySelectorAll('.article-card.read-passed-v9138').forEach(c=>c.classList.remove('read-passed-v9138'));document.querySelectorAll('[data-grey-eligible-v9138]').forEach(c=>delete c.dataset.greyEligibleV9138);down=false;lastY=scrollY}
function icon(){let b=document.querySelector('.top-reset-icon-v9138');if(!b){b=document.createElement('button');b.type='button';b.className='top-reset-icon-v9138';b.textContent='↻';b.title='Réinitialiser';b.setAttribute('aria-label','Réinitialiser les articles parcourus');document.body.appendChild(b)}b.hidden=!['home','brief'].includes(activeView())||!!document.querySelector('.quick-summary-backdrop,.personalization-sheet,.watch-editor-backdrop-v9138')}
window.addEventListener('scroll',()=>{const y=scrollY;down=y>lastY+1?true:y<lastY-1?false:down;lastY=y;if(scrollScheduled)return;scrollScheduled=true;requestAnimationFrame(()=>{scrollScheduled=false;bindCards();markPassed();prepareImages()})},{passive:true});

/* Watch editor. */
function updateTopic(value,remove=false){value=clean(value);if(!value)return;const k=norm(value),s=settings(),current=uniq(s.briefWatchTopics||[]);s.briefWatchTopics=remove?current.filter(x=>norm(x)!==k):uniq([...current,value]);write(SETTINGS,s);const keys=uniq(read(KEYWORDS,[]));write(KEYWORDS,remove?keys.filter(x=>norm(x)!==k):uniq([...keys,value]))}
function editorMarkup(){const topics=watchTopics();return `<div class="watch-editor-form-v9138"><input class="text-input" data-watch-editor-input maxlength="80" autocomplete="off" placeholder="Ex. fusion nucléaire, Alzheimer, Quest 4…"><button type="button" class="small-primary-btn" data-watch-editor-add>Ajouter</button></div><div class="watch-editor-list-v9138">${topics.length?topics.map(t=>`<div class="watch-editor-item-v9138"><span>${esc(t)}</span><button type="button" data-watch-editor-remove="${esc(t)}" aria-label="Supprimer ${esc(t)}">×</button></div>`).join(''):'<p class="muted-note">Aucune veille définie.</p>'}</div>`}
function openEditor(){document.querySelector('.watch-editor-backdrop-v9138')?.remove();const b=document.createElement('div');b.className='watch-editor-backdrop-v9138';b.innerHTML=`<section class="watch-editor-sheet-v9138" role="dialog" aria-modal="true"><header><div><span>Mes veilles</span><h2>Modifier veilles</h2></div><button type="button" data-watch-editor-close aria-label="Fermer">×</button></header><p>Ajoutez ou retirez ici les sujets suivis.</p><div data-watch-editor-body>${editorMarkup()}</div></section>`;document.body.appendChild(b);icon();setTimeout(()=>b.querySelector('[data-watch-editor-input]')?.focus(),0)}
function refreshEditor(){const b=document.querySelector('[data-watch-editor-body]');if(b)b.innerHTML=editorMarkup()}
document.addEventListener('click',e=>{
 const reset=e.target.closest?.('.top-reset-icon-v9138');if(reset){e.preventDefault();e.stopImmediatePropagation();resetGrey();return}
 const open=e.target.closest?.('[data-watch-edit-open]');if(open){e.preventDefault();e.stopImmediatePropagation();openEditor();return}
 const close=e.target.closest?.('[data-watch-editor-close]');if(close||e.target.classList?.contains('watch-editor-backdrop-v9138')){e.preventDefault();document.querySelector('.watch-editor-backdrop-v9138')?.remove();icon();return}
 const add=e.target.closest?.('[data-watch-editor-add]');if(add){e.preventDefault();const input=document.querySelector('[data-watch-editor-input]');updateTopic(input?.value||'');if(input)input.value='';refreshEditor();renderWatches();return}
 const rem=e.target.closest?.('[data-watch-editor-remove]');if(rem){e.preventDefault();updateTopic(rem.dataset.watchEditorRemove||'',true);refreshEditor();renderWatches();return}
 const toggle=e.target.closest?.('[data-watch-all-toggle]');if(toggle){e.preventDefault();const day=toggle.closest('.watch-day-v9138'),filtered=day?.querySelector('.watch-filtered-feed-v9138'),empty=day?.querySelector('.watch-empty-day-v9138'),all=day?.querySelector('.watch-all-feed-v9138'),opening=Boolean(all?.hidden);if(all)all.hidden=!opening;if(filtered)filtered.hidden=opening;if(empty)empty.hidden=opening;toggle.classList.toggle('open',opening);toggle.querySelector('span').textContent=opening?'Mes veilles seulement':'Toute l’actualité';prepareImages();return}
 if(e.target.closest?.('[data-view="home"],[data-view="brief"],[data-brief-mode]'))queueMicrotask(()=>{finalizeBrief();bindCards();syncGrey();icon();prepareImages()});
},true);

/* Images: make the first screen eager/high-priority immediately. */
function prepareImages(){const imgs=[...document.querySelectorAll('.article-card:not([hidden]) img.article-image')];let high=0;for(const img of imgs){const r=img.getBoundingClientRect();if(r.bottom<-300||r.top>innerHeight*3)continue;img.loading='eager';img.decoding='async';if('fetchPriority'in img)img.fetchPriority=high<10?'high':'auto';high++;if(img.complete&&img.naturalWidth>8)img.decode?.().catch(()=>{})}}

const style=document.createElement('style');style.textContent=`
.article-card.read-passed-v9138{opacity:.5!important;filter:saturate(.55)!important;transition:none!important}.article-card.read-passed-v9138 h2,.article-card.read-passed-v9138 .meta{color:#918c96!important}.article-card.read-passed-v9138 img{filter:grayscale(.35) saturate(.65)!important}
.top-reset-icon-v9138{position:fixed;z-index:1100;top:max(2px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:30px;height:28px;padding:0;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#6d55d8;font-size:22px;font-weight:800;line-height:28px;text-align:center}.top-reset-icon-v9138[hidden]{display:none!important}
.journal-section>.muted-note,.brief-scope{display:none!important}.journal-section .brief-section-title{text-align:center!important;font-size:18px!important;margin:2px 0 14px!important}.journal-section .brief-day-v9138{text-align:center!important;margin:0 0 5px!important;color:#756d7e!important;font-size:11px!important;font-weight:800!important;text-transform:capitalize!important}.brief-history-v9138{margin-top:20px}.brief-history-day-v9138{margin-top:22px}.brief-history-date-v9138{text-align:center;margin:0 0 10px;color:#5f5869;font-size:13px;font-weight:900}.brief-history-day-v9138 .feed{display:grid;gap:10px}
.watch-edit-button-v9138{border:0;border-radius:999px;padding:9px 13px;background:#eee9ff;color:#5d48c9;font-size:11px;font-weight:850}.watch-day-v9138{margin-top:18px}.watch-day-v9138>h3{margin:0 0 9px;font-size:15px;color:#4f4956;font-weight:900}.watch-all-band-v9138{width:100%;margin:11px 0 4px;padding:12px 14px;border:1px solid #e2ddec;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:space-between;color:#5d48c9;font-weight:850;text-align:left}.watch-all-band-v9138 small{color:#8b8591;font-size:10px}.watch-all-band-v9138.open{background:#f1edff}.watch-empty-day-v9138{margin:8px 0 10px;color:#918b96;font-size:11px}
.watch-editor-backdrop-v9138{position:fixed;inset:0;z-index:10050;background:rgba(28,23,39,.28);display:flex;align-items:flex-end;justify-content:center;padding:16px}.watch-editor-sheet-v9138{width:min(680px,100%);max-height:82vh;overflow:auto;border-radius:24px 24px 18px 18px;background:#faf9fd;padding:18px;box-shadow:0 18px 60px rgba(40,30,70,.24)}.watch-editor-sheet-v9138 header{display:flex;justify-content:space-between;gap:12px}.watch-editor-sheet-v9138 header>button{width:40px;height:40px;border:0;border-radius:14px;background:#eeeaf3;font-size:24px}.watch-editor-form-v9138{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.watch-editor-list-v9138{display:grid;gap:7px;margin-top:12px}.watch-editor-item-v9138{display:grid;grid-template-columns:minmax(0,1fr) 36px;align-items:center;gap:8px;padding:6px 6px 6px 12px;border:1px solid #e5e1ea;border-radius:13px;background:#fff}.watch-editor-item-v9138 button{width:34px;height:34px;border:0;border-radius:10px;background:#f1eef5;font-size:20px}
`;document.head.appendChild(style);
queueMicrotask(()=>{finalizeBrief();bindCards();syncGrey();icon();prepareImages()});
})();