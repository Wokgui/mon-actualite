(() => {
'use strict';
const CACHE='news-live-cache';
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}},clean=v=>String(v??'').replace(/\s+/g,' ').trim(),esc=v=>clean(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const brief=()=>!!document.querySelector('.nav-item.active[data-view="brief"]'),essential=()=>!!document.querySelector('.brief-mode-tab.active[data-brief-mode="essential"]'),watch=()=>!!document.querySelector('.brief-mode-tab.active[data-brief-mode="watches"]');
const articles=()=>{const c=read(CACHE,{});return Array.isArray(c.articles)?c.articles:[]};
const day0=v=>{const d=new Date(v),n=new Date();if(Number.isNaN(d.getTime()))return 999;return Math.round((new Date(n.getFullYear(),n.getMonth(),n.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000)};
const full=v=>{const d=new Date(v);if(Number.isNaN(d.getTime()))return'';const x=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(d);return x[0].toUpperCase()+x.slice(1)};
const label=v=>day0(v)===1?'Hier':day0(v)===2?'Avant-hier':full(v);
const image=a=>{const r=clean(a.visual?.url||a.image||a.quickVisualUrl);if(r&&!/^data:image\/svg\+xml/i.test(r))return r;const p=new URLSearchParams({v:'19',url:clean(a.url).slice(0,1900),image:clean(a.image).slice(0,1900),title:clean(a.title).slice(0,280),category:clean(a.category).slice(0,70),source:clean(a.source).slice(0,100)});return`/api/article-thumbnail?${p}`};
const clock=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(d)};
const row=(a,i)=>`<article class="article-card runtime-row" data-article="${esc(a.id)}" tabindex="0"><img class="article-image original-article-image stable-visual" src="${esc(image(a))}" alt="" width="400" height="224" loading="${i<5?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer"><div class="article-body"><h2>${esc(a.title)}</h2><div class="meta"><span class="source">${esc(a.source||'Source')}</span><span>${esc(clock(a.publishedAt))}</span></div></div></article>`;
const major=/guerre|attaque|cessez-le-feu|élection|gouvernement|président|premier ministre|attentat|catastrophe|séisme|inondation|incendie|crise|accord|sommet|justice|condamn|budget|déficit|croissance|inflation|chômage|épidémie|climat|diplomatie|nucléaire|réforme|retraite/i,low=/football|match|mercato|tennis|formule 1|promotion|bon plan|soldes|réduction|console|jeu vidéo|gta|people|célébrité|télé-réalité/i,editorial=new Set(['Politique','International','Europe','Économie','Société','Santé','Environnement','Science']);
const score=a=>Number(a.score||0)+(editorial.has(a.category)?65:0)+(major.test(`${a.title||''} ${a.summary||''}`)?80:0)+Math.max(0,(a.sources?.length||1)-1)*25-(low.test(`${a.title||''} ${a.summary||''}`)?180:0);
function history(){const fb=read('news-feedback',{}),map=new Map();for(const a of articles()){const d=day0(a.publishedAt);if(d<1||d>8||fb[a.id]==='not')continue;const k=new Date(a.publishedAt).toISOString().slice(0,10);if(!map.has(k))map.set(k,[]);map.get(k).push(a)}return[...map.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,7).map(([k,v])=>({k,v:v.sort((a,b)=>score(b)-score(a)).slice(0,5)}))}
let applying=false;
function polishEssential(){
  if(applying||!brief()||!essential())return;
  const rt=document.querySelector('.runtime-brief-content'),j=rt?.querySelector('.journal-section');if(!j)return;
  applying=true;
  try{
    const wantedDay=full(new Date());
    let d=j.querySelector('.brief-day-v9138');
    if(!d){d=document.createElement('div');d.className='brief-day-v9138';d.textContent=wantedDay;j.prepend(d)}else if(d.textContent!==wantedDay)d.textContent=wantedDay;
    const t=j.querySelector('.brief-section-title');if(t&&t.textContent!=='Les 5 événements majeurs')t.textContent='Les 5 événements majeurs';
    j.querySelectorAll(':scope>.muted-note,.brief-scope').forEach(n=>n.remove());
    const days=history(),sig=days.map(x=>`${x.k}:${x.v.map(a=>a.id).join(',')}`).join('|');
    let h=rt.querySelector('.brief-history-v9138');
    if(h?.dataset.sig===sig)return;
    const next=document.createElement('section');next.className='brief-history-v9138';next.dataset.sig=sig;next.innerHTML=days.map((x,di)=>`<section class="brief-history-day-v9138"><div class="brief-history-date-v9138">${esc(label(x.v[0]?.publishedAt))}${day0(x.v[0]?.publishedAt)<=2?` · ${esc(full(x.v[0]?.publishedAt))}`:''}</div><div class="feed">${x.v.map((a,i)=>row(a,di*10+i)).join('')}</div></section>`).join('');
    if(h)h.replaceWith(next);else j.after(next);
  }finally{applying=false}
}
let quiet=0,max=0,raf=0;
function begin(){clearTimeout(quiet);clearTimeout(max);document.body.classList.add('brief-switching-v9138');max=setTimeout(()=>document.body.classList.remove('brief-switching-v9138'),800)}
function settle(){clearTimeout(quiet);quiet=setTimeout(()=>{polishEssential();requestAnimationFrame(()=>document.body.classList.remove('brief-switching-v9138'))},160)}
function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;if(!brief())return;polishEssential();if(document.body.classList.contains('brief-switching-v9138'))settle()})}
document.addEventListener('pointerdown',e=>{if(e.target.closest?.('[data-view="brief"],[data-brief-mode]')){begin();setTimeout(schedule,0);setTimeout(schedule,120);setTimeout(schedule,360)}},true);
const root=document.getElementById('app')||document.body;
new MutationObserver(records=>{if(applying||!brief())return;if(records.some(r=>r.addedNodes.length||r.removedNodes.length))schedule()}).observe(root,{childList:true,subtree:true});
setTimeout(schedule,0);
const s=document.createElement('style');s.textContent=`
.brief-switching-v9138 .runtime-brief-content{visibility:hidden!important}.journal-section>.muted-note,.brief-scope{display:none!important}.journal-section .brief-section-title{text-align:center!important;font-size:18px!important;margin:2px 0 14px!important}.journal-section .brief-day-v9138{text-align:center!important;margin:0 0 5px!important;color:#756d7e!important;font-size:11px!important;font-weight:800!important;text-transform:capitalize!important}.brief-history-v9138{margin-top:20px}.brief-history-day-v9138{margin-top:22px}.brief-history-date-v9138{text-align:center;margin:0 0 10px;color:#5f5869;font-size:13px;font-weight:900;text-transform:capitalize}.brief-history-day-v9138 .feed{display:grid;gap:10px}
`;document.head.appendChild(s);
})();