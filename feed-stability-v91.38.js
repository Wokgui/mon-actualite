(() => {
'use strict';
const LIVE='news-live-cache', QUICK='news-article-summaries-v8';
const inflight=new Map(), warmedImages=new Set(), warmedSummaries=new Set();
let idleTimer=0,lastInteraction=Date.now(),summaryActive=0;
const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
const fastNetwork=!connection?.saveData&&!/slow-2g|2g|3g/i.test(String(connection?.effectiveType||''));
const memory=Number(navigator.deviceMemory||4);
const SUMMARY_CONCURRENCY=fastNetwork&&memory>=4?2:1;
const SUMMARY_BATCH=fastNetwork?8:4;
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const good=v=>clean(v).length>=55&&!/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(clean(v));
const articles=()=>{const c=read(LIVE,{});return Array.isArray(c.articles)?c.articles:[]};
const byId=id=>articles().find(a=>String(a.id||'')===String(id||''))||null;
function cached(a){if(!a?.id)return false;const x=read(QUICK,{})[`article:${a.id}`];return Boolean(x?.summary&&!x?.unavailable&&good(x.summary))}
function save(a,summary,data={}){if(!a?.id||!good(summary))return;const k=`article:${a.id}`,q=read(QUICK,{});q[k]={summary:clean(summary),ai:Boolean(data.ai||data.grounded),unavailable:false,savedAt:Date.now()};write(QUICK,Object.fromEntries(Object.entries(q).slice(-220)))}

/* Images first. The single renderer announces complete/append-only commits, so
   image priority is set immediately without observing every DOM mutation. */
function prepareImages(){
 const imgs=[...document.querySelectorAll('.article-card:not([hidden]) img.article-image,.brief-point:not([hidden]) img.brief-thumb')];let rank=0;
 for(const img of imgs){const r=img.getBoundingClientRect();if(r.bottom<-400||r.top>innerHeight*3.5)continue;img.loading='eager';img.decoding='async';if('fetchPriority'in img)img.fetchPriority=rank<12?'high':'auto';rank++;
  const src=img.currentSrc||img.src;if(src&&!warmedImages.has(src)){warmedImages.add(src);const pre=new Image();pre.decoding='async';pre.fetchPriority=rank<10?'high':'auto';pre.src=src;}
 }
}

async function fetchSummary(a){
 if(!a?.id||!a.url||cached(a)||inflight.has(String(a.id)))return;
 const id=String(a.id);warmedSummaries.add(id);
 const body=JSON.stringify({mode:'article',article:{url:a.url,title:clean(a.title),summary:clean(a.summary),source:clean(a.source)}});
 summaryActive++;
 const job=fetch('/api/article-summary-groq?v=17&intent=idle-prefetch',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body})
  .then(r=>r.ok?r.json():null).then(d=>{const s=clean(d?.summary||'');if(d&&!d.unavailable&&good(s))save(a,s,d)}).catch(()=>{})
  .finally(()=>{summaryActive=Math.max(0,summaryActive-1);inflight.delete(id);scheduleIdleSummaries(180)});
 inflight.set(id,job);return job;
}
function visibleCandidates(){
 const map=new Map(articles().map(a=>[String(a.id||''),a]));
 return [...document.querySelectorAll('.article-card[data-article]:not([hidden])')]
  .map(card=>({a:map.get(String(card.dataset.article||'')),r:card.getBoundingClientRect()}))
  .filter(x=>x.a&&x.r.bottom>-200&&x.r.top<innerHeight*3.2&&!cached(x.a)&&!warmedSummaries.has(String(x.a.id)))
  .sort((x,y)=>Math.abs(x.r.top)-Math.abs(y.r.top)).slice(0,SUMMARY_BATCH).map(x=>x.a);
}
function firstImagesReady(){const imgs=[...document.querySelectorAll('.article-card:not([hidden]) img.article-image')].slice(0,8);return !imgs.length||imgs.filter(img=>img.complete&&img.naturalWidth>8).length>=Math.min(4,imgs.length)}
function runIdleSummaries(){
 idleTimer=0;if(document.hidden||document.querySelector('.quick-summary-backdrop')||Date.now()-lastInteraction<500||!firstImagesReady())return scheduleIdleSummaries(300);
 const queue=visibleCandidates();for(const a of queue){if(summaryActive>=SUMMARY_CONCURRENCY)break;fetchSummary(a)}
}
function scheduleIdleSummaries(delay=650){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{const ric=window.requestIdleCallback||((cb)=>setTimeout(()=>cb({timeRemaining:()=>25,didTimeout:false}),0));ric(runIdleSummaries,{timeout:900})},delay)}
/* pointerdown gives a non-cached article a head start before the click opens it. */
document.addEventListener('pointerdown',e=>{lastInteraction=Date.now();const card=e.target.closest?.('.article-card[data-article]');if(card)fetchSummary(byId(card.dataset.article));}, {capture:true,passive:true});
window.addEventListener('scroll',()=>{lastInteraction=Date.now();prepareImages();scheduleIdleSummaries(800)},{passive:true});
window.addEventListener('resize',()=>{prepareImages();scheduleIdleSummaries(700)},{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){prepareImages();scheduleIdleSummaries(500)}});
 window.addEventListener('news:stable-render',()=>{prepareImages();scheduleIdleSummaries(650)});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{prepareImages();scheduleIdleSummaries(550)},{once:true});else{prepareImages();scheduleIdleSummaries(550)}
})();
