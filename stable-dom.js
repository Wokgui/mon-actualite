(() => {
'use strict';
const APP_ID='app', LIVE_SUMMARY_TTL=5*60*1000, SUMMARY_CACHE_KEY='news-article-summaries-v4';
const native=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');if(!native?.get||!native?.set)return;
const nativeGet=native.get,nativeSet=native.set;let parsing=false;
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
function liveArticles(){const c=read('news-live-cache',{});return Array.isArray(c.articles)?c.articles:[]}
function live(a={}){const t=String(a.title||'').toLowerCase(),u=String(a.url||'').toLowerCase();return /\b(?:en direct|direct|live)\b/.test(t)||/\/(?:live|direct)\//.test(u)}
function bad(v=''){const t=String(v||'').toLowerCase();return !t||/résumé indisponible/.test(t)||/ouvrez?\s+l[’']article|consultez?\s+(?:les?\s+)?détails/.test(t)||/ce live est fermé|basculer vers (?:notre|le) nouveau live/.test(t)}
function refreshLiveSummaryCache(){const now=Date.now(),ids=new Set(liveArticles().filter(live).map(a=>String(a.id||'')));if(!ids.size)return;for(const key of[SUMMARY_CACHE_KEY,'news-factual-summaries-v2']){const c=read(key,{});let ch=false;for(const[k,v]of Object.entries(c)){const id=k.startsWith('article:')?k.slice(8):k;if(!ids.has(String(id)))continue;if(!v?.savedAt||now-Number(v.savedAt||0)>LIVE_SUMMARY_TTL||bad(v?.summary||'')){delete c[k];ch=true}}if(ch)write(key,c)}}
function activeView(root=document){return root?.querySelector?.('.bottom-nav .nav-item.active[data-view]')?.dataset?.view||''}
function renderAllowed(){try{return Boolean(window.NewsViewStabilityV9138?.isRenderAllowed?.())}catch{return false}}
function cards(root){return[...root.querySelectorAll?.(':scope > .article-card[data-article]')||[]]}
function ids(list){return list.map(n=>String(n.dataset.article||''))}
function strictExtension(oldIds,newIds){if(!oldIds.length||newIds.length<=oldIds.length)return false;for(let i=0;i<oldIds.length;i++)if(!oldIds[i]||oldIds[i]!==newIds[i])return false;return true}
function loadedImages(root){const map=new Map();root?.querySelectorAll?.('[data-article]').forEach(card=>{const id=card.getAttribute('data-article');if(!id||map.has(id))return;const img=card.querySelector('img.article-image,img.brief-thumb,img.original-article-image,img.runtime-detail-image');if(!img)return;const src=img.currentSrc||img.getAttribute('src')||'';if(src&&img.complete&&img.naturalWidth>1)map.set(id,img)});return map}
function transplant(current,next){const map=loadedImages(current);if(!map.size)return;next?.querySelectorAll?.('[data-article]').forEach(card=>{const img=map.get(card.getAttribute('data-article'));if(!img)return;const target=card.querySelector('img.article-image,img.brief-thumb,img.original-article-image,.article-placeholder,.brief-thumb.article-placeholder');if(target&&target!==img)target.replaceWith(img);card.classList.remove('v42-image-pending','v42-image-failed');card.classList.add('v42-image-loaded')})}
function relevant(el,text){if(parsing||typeof text!=='string'||!text.includes('data-article='))return false;return el.id===APP_ID||el.classList?.contains('feed')||el.classList?.contains('runtime-brief-content')}
function normalizedMarkup(el,text){if(!el.classList?.contains('runtime-brief-content'))return text;return String(text)
 .replace('Les 5 événements majeurs · France & Monde','Les 5 événements majeurs')
 .replace(/<p class="muted-note">Une sélection resserrée des faits dignes de l’ouverture d’un journal télévisé\.<\/p>/g,'')
 .replace(/<span class="brief-scope">(?:France|Monde)<\/span>/g,'')}
Object.defineProperty(Element.prototype,'innerHTML',{
 configurable:native.configurable,enumerable:native.enumerable,get(){return nativeGet.call(this)},set(value){
  let text=typeof value==='string'?normalizedMarkup(this,value):value;
  if(!relevant(this,text)){nativeSet.call(this,text);return}
  const template=document.createElement('template');try{parsing=true;nativeSet.call(template,String(text))}finally{parsing=false}
  const allowed=renderAllowed(),view=activeView();
  if(this.id===APP_ID&&this.querySelector('[data-article]')&&!allowed){const oldView=activeView(this),newView=activeView(template.content);if(oldView&&oldView===newView&&(oldView==='home'||oldView==='brief'))return}
  if(this.classList?.contains('feed')){
   const current=cards(this),next=cards(template.content);
   if(current.length&&view==='home'){
    const oldIds=ids(current),newIds=ids(next);
    if(strictExtension(oldIds,newIds)){
      this.querySelector(':scope > [data-home-more]')?.remove();
      for(const card of next.slice(current.length))this.appendChild(card);
      const more=template.content.querySelector(':scope > [data-home-more]');if(more)this.appendChild(more);
      return;
    }
    if(!allowed)return;
   }
   if(current.length&&view==='brief'&&!allowed)return;
  }
  if(this.classList?.contains('runtime-brief-content')&&this.querySelector('[data-article]')&&!allowed)return;
  transplant(this,template.content);this.replaceChildren(...template.content.childNodes)
 }
});
refreshLiveSummaryCache();window.addEventListener('focus',refreshLiveSummaryCache);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLiveSummaryCache()});
})();