(() => {
'use strict';
const LIVE='news-live-cache', QUICK='news-article-summaries-v8', AI='news-verified-ai-summaries-v9138';
const inflight=new Map(), warmed=new Set();let scheduled=false;
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const good=v=>clean(v).length>=55&&!/résumé (?:détaillé )?momentanément indisponible|résumé indisponible|en cours de préparation/i.test(clean(v));
const articles=()=>{const c=read(LIVE,{});return Array.isArray(c.articles)?c.articles:[]};
const byId=id=>articles().find(a=>String(a.id||'')===String(id||''))||null;
function prepareImages(){scheduled=false;const imgs=[...document.querySelectorAll('.article-card:not([hidden]) img.article-image')];let rank=0;for(const img of imgs){const r=img.getBoundingClientRect();if(r.bottom<-300||r.top>innerHeight*3.2)continue;img.loading='eager';img.decoding='async';if('fetchPriority'in img)img.fetchPriority=rank<12?'high':'auto';rank++;const src=img.currentSrc||img.src;if(src&&!warmed.has(src)){warmed.add(src);const pre=new Image();pre.decoding='async';pre.src=src}}}
function scheduleImages(){if(scheduled)return;scheduled=true;requestAnimationFrame(prepareImages)}
function cached(a){const k=`article:${a.id}`;const x=read(AI,{})[k]||read(QUICK,{})[k];return good(x?.summary)}
function save(a,summary,data={}){if(!a?.id||!good(summary))return;const k=`article:${a.id}`,item={summary:clean(summary),ai:Boolean(data.ai||data.grounded),unavailable:false,savedAt:Date.now()};const q=read(QUICK,{});q[k]=item;write(QUICK,Object.fromEntries(Object.entries(q).slice(-180)));if(data.ai===true){const c=read(AI,{});c[k]={summary:item.summary,savedAt:item.savedAt};write(AI,Object.fromEntries(Object.entries(c).slice(-180)))}}
function prefetchSummary(a){if(!a?.id||!a.url||cached(a))return;const id=String(a.id);if(inflight.has(id))return;const body=JSON.stringify({mode:'article',article:{url:a.url,title:clean(a.title),summary:clean(a.summary),source:clean(a.source)}});const job=fetch('/api/article-summary-groq?v=17&intent=touch',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body}).then(r=>r.ok?r.json():null).then(d=>{const s=clean(d?.summary||'');if(d&&!d.unavailable&&good(s))save(a,s,d)}).catch(()=>{}).finally(()=>inflight.delete(id));inflight.set(id,job)}
// No background AI queue. Network and main-thread time remain available for UI
// and thumbnails; summary generation starts at pointerdown, before the article
// sheet click handler runs.
document.addEventListener('pointerdown',e=>{const card=e.target.closest?.('.article-card[data-article]');if(card)prefetchSummary(byId(card.dataset.article));if(e.target.closest?.('[data-view],[data-brief-mode]'))scheduleImages()},{capture:true,passive:true});
window.addEventListener('scroll',scheduleImages,{passive:true});window.addEventListener('resize',scheduleImages,{passive:true});
const app=document.getElementById('app');if(app)new MutationObserver(scheduleImages).observe(app,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleImages,{once:true});else scheduleImages();
})();