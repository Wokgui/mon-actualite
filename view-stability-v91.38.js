(() => {
'use strict';
const app=document.getElementById('app');if(!app)return;
let allowUntil=Date.now()+2200,restoringUntil=0,transition=null;
const allowRender=(ms=500)=>{allowUntil=Math.max(allowUntil,Date.now()+Math.min(1200,Math.max(120,ms)))};
const allowed=()=>Date.now()<=allowUntil;
const restoring=()=>Date.now()<=restoringUntil;
const startRestore=()=>{restoringUntil=Date.now()+90};
const els=nodes=>[...nodes].filter(n=>n?.nodeType===Node.ELEMENT_NODE);
function find(nodes,sel){for(const n of els(nodes)){if(n.matches?.(sel))return n;const x=n.querySelector?.(sel);if(x)return x}return null}
function viewOf(nodes){const nav=find(nodes,'.bottom-nav');return nav?.querySelector?.('.nav-item.active[data-view]')?.dataset?.view||''}
function liveView(){return app.querySelector('.bottom-nav .nav-item.active[data-view]')?.dataset?.view||''}
function textCards(sel,min=3){return [...app.querySelectorAll(sel)].filter(n=>String(n.textContent||'').trim().length>3).length>=min}
function imagesReady(sel,min=3,max=5){
  const imgs=[...app.querySelectorAll(sel)].slice(0,max);
  if(!imgs.length)return true;
  let loaded=0;
  for(let i=0;i<imgs.length;i++){
    const img=imgs[i];
    img.loading='eager';img.decoding='async';
    try{if('fetchPriority' in img)img.fetchPriority=i<4?'high':'auto'}catch{}
    if(img.complete&&img.naturalWidth>8&&img.naturalHeight>8)loaded++;
  }
  return loaded>=Math.min(min,imgs.length);
}
function ready(target){
  if(target==='home')return liveView()==='home'&&textCards('.page .feed .article-card[data-article] h2',4)&&imagesReady('.page .feed .article-card[data-article] img.article-image',4,6);
  if(target==='watches')return liveView()==='brief'&&!!app.querySelector('.brief-mode-tab.active[data-brief-mode="watches"]')&&!!app.querySelector('.watch-layout-v9138')&&textCards('.watch-layout-v9138 .article-card[data-article] h2',2)&&imagesReady('.watch-layout-v9138 .article-card[data-article] img.article-image',3,5);
  if(target==='essential')return liveView()==='brief'&&!!app.querySelector('.brief-mode-tab.active[data-brief-mode="essential"]')&&textCards('.runtime-brief-content .article-card[data-article] h2',3)&&imagesReady('.runtime-brief-content .article-card[data-article] img.article-image',4,5);
  if(target==='brief')return liveView()==='brief'&&((textCards('.runtime-brief-content .article-card[data-article] h2',3)&&imagesReady('.runtime-brief-content .article-card[data-article] img.article-image',4,5))||(!!app.querySelector('.watch-layout-v9138')&&imagesReady('.watch-layout-v9138 .article-card[data-article] img.article-image',3,5)));
  return true;
}
function endTransition(){if(!transition)return;transition.overlay.remove();transition=null;document.documentElement.classList.remove('stable-view-transition-v9139')}
function waitTransition(){if(!transition)return;const age=performance.now()-transition.started;if(ready(transition.target)){transition.good=(transition.good||0)+1;if(transition.good>=3){endTransition();return}}else transition.good=0;if(age>2200){endTransition();return}requestAnimationFrame(waitTransition)}
function neutralizeClone(clone){
  clone.dataset.stabilityClone='1';
  clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
  clone.querySelectorAll('[data-article],[data-view],[data-brief-mode],[data-home-more],[data-watch-all-toggle],[data-watch-edit-open]').forEach(n=>{
    n.removeAttribute('data-article');n.removeAttribute('data-view');n.removeAttribute('data-brief-mode');n.removeAttribute('data-home-more');n.removeAttribute('data-watch-all-toggle');n.removeAttribute('data-watch-edit-open');
  });
  clone.querySelectorAll('button,a,input,select,textarea').forEach(n=>{n.tabIndex=-1;n.setAttribute('aria-hidden','true')});
}
function startTransition(target){
  endTransition();
  if(!app.children.length)return;
  const overlay=document.createElement('div');overlay.className='stable-view-overlay-v9139';
  const clone=app.cloneNode(true);clone.removeAttribute('id');clone.classList.add('stable-view-clone-v9139');neutralizeClone(clone);clone.style.top=`-${window.scrollY}px`;
  overlay.appendChild(clone);document.body.appendChild(overlay);document.documentElement.classList.add('stable-view-transition-v9139');
  transition={overlay,target,started:performance.now(),good:0};allowRender(1200);requestAnimationFrame(waitTransition);
}
function targetFrom(el){if(el.matches?.('[data-brief-mode="watches"]'))return'watches';if(el.matches?.('[data-brief-mode="essential"]'))return'essential';const v=el.dataset?.view;if(v==='home')return'home';if(v==='brief')return'brief';return''}

document.addEventListener('pointerdown',e=>{
  const nav=e.target.closest?.('[data-view],[data-brief-mode]');if(nav){const target=targetFrom(nav);if(target)startTransition(target);return}
  if(e.target.closest?.('[data-home-more],[data-saved-filter],[data-refresh],[data-feedback],[data-topic-feedback],[data-direct-topic-add],[data-direct-topic-remove],[data-general-category],[data-interest],[data-brief-essential],[data-brief-watch],[data-dismiss-sheet],[data-close-sheet],[data-open-settings]'))allowRender(450);
},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')allowRender(350)},true);

const observer=new MutationObserver(records=>{
  if(restoring()||allowed()||transition)return;
  const appRecords=records.filter(r=>r.target===app);
  if(appRecords.length){
    const removed=appRecords.flatMap(r=>[...r.removedNodes]),added=appRecords.flatMap(r=>[...r.addedNodes]);
    const oldView=viewOf(removed),newView=viewOf(added);
    if(oldView&&oldView===newView&&(oldView==='home'||oldView==='brief')){
      const oldPage=find(removed,'.page'),newPage=find(added,'.page'),oldNav=find(removed,'.bottom-nav'),newNav=find(added,'.bottom-nav');
      if(oldPage&&newPage?.isConnected){startRestore();newPage.replaceWith(oldPage);if(oldNav&&newNav?.isConnected)newNav.replaceWith(oldNav);return}
    }
  }
  const view=liveView();if(view!=='home'&&view!=='brief')return;
  if(view==='home')for(const r of records){const t=r.target;if(!(t instanceof Element)||!t.matches('.page .feed'))continue;const removed=els(r.removedNodes),added=els(r.addedNodes);const a=removed.filter(n=>n.matches?.('.article-card[data-article]')).length,b=added.filter(n=>n.matches?.('.article-card[data-article]')).length;if(a>=3&&b>=3){startRestore();t.replaceChildren(...removed);return}}
  if(view==='brief')for(const r of records){const t=r.target;if(!(t instanceof Element)||!t.matches('.runtime-brief-content'))continue;const removed=els(r.removedNodes),added=els(r.addedNodes);if(removed.length&&added.length){startRestore();t.replaceChildren(...removed);return}}
});
observer.observe(app,{childList:true,subtree:true});
window.NewsViewStabilityV9138=Object.freeze({allowRender});
const style=document.createElement('style');style.textContent=`
.stable-view-overlay-v9139{position:fixed;z-index:10050;inset:0;overflow:hidden;background:#fbfaff;pointer-events:none}.stable-view-clone-v9139{position:absolute!important;left:0;right:0;width:100%;min-height:100vh}.stable-view-overlay-v9139 .bottom-nav{pointer-events:none!important}.brief-switching-v9138 .runtime-brief-content{visibility:visible!important}
`;document.head.appendChild(style);
})();