(() => {
'use strict';
const app=document.getElementById('app');if(!app)return;
let allowUntil=Date.now()+80,transition=null;
const allowRender=(ms=500)=>{allowUntil=Math.max(allowUntil,Date.now()+Math.min(1400,Math.max(120,ms)))};
const allowed=()=>Date.now()<=allowUntil;
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
function endTransition(){if(!transition)return;transition.overlay.remove();transition=null;document.documentElement.classList.remove('stable-view-transition-v91310')}
function waitTransition(){if(!transition)return;const age=performance.now()-transition.started;if(ready(transition.target)){transition.good=(transition.good||0)+1;if(transition.good>=2){endTransition();return}}else transition.good=0;if(age>1800){endTransition();return}requestAnimationFrame(waitTransition)}
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
  const overlay=document.createElement('div');overlay.className='stable-view-overlay-v91310';
  const clone=app.cloneNode(true);clone.removeAttribute('id');clone.classList.add('stable-view-clone-v91310');neutralizeClone(clone);clone.style.top=`-${window.scrollY}px`;
  overlay.appendChild(clone);document.body.appendChild(overlay);document.documentElement.classList.add('stable-view-transition-v91310');
  transition={overlay,target,started:performance.now(),good:0};allowRender(1300);requestAnimationFrame(waitTransition);
}
function targetFrom(el){if(el.matches?.('[data-brief-mode="watches"]'))return'watches';if(el.matches?.('[data-brief-mode="essential"]'))return'essential';const v=el.dataset?.view;if(v==='home')return'home';if(v==='brief')return'brief';return''}

// Once a valid picture is visible, keep that bitmap stable for this DOM node.
// A better recovered URL is kept in cache for the next natural render instead
// of changing the photograph while the user is looking at the list.
try{
  const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
  if(src?.get&&src?.set&&!HTMLImageElement.prototype.__newsStableVisibleSrcV91310){
    Object.defineProperty(HTMLImageElement.prototype,'__newsStableVisibleSrcV91310',{value:true,configurable:false});
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      configurable:src.configurable,enumerable:src.enumerable,
      get(){return src.get.call(this)},
      set(value){
        const next=String(value||'');
        const current=String(src.get.call(this)||'');
        const card=this.closest?.('.article-card[data-article],.brief-point[data-article]');
        const failed=card?.classList?.contains('v42-image-failed')||current.startsWith('data:image/svg+xml')||!this.complete||this.naturalWidth<2||this.naturalHeight<2;
        if(this.isConnected&&card&&!failed&&current&&next&&next!==current){this.dataset.deferredVisualSrcV91310=next;return}
        src.set.call(this,value);
      }
    });
  }
}catch{}

document.addEventListener('pointerdown',e=>{
  const nav=e.target.closest?.('[data-view],[data-brief-mode]');
  if(nav){
    const target=targetFrom(nav);
    if(target)startTransition(target);
    else allowRender(900); // Personnaliser/sheet is a deliberate same-view render.
    return;
  }
  if(e.target.closest?.('[data-home-more],[data-saved-filter],[data-refresh],[data-feedback],[data-topic-feedback],[data-direct-topic-add],[data-direct-topic-remove],[data-general-category],[data-interest],[data-brief-essential],[data-brief-watch],[data-dismiss-sheet],[data-close-sheet],[data-open-settings]'))allowRender(700);
},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')allowRender(500)},true);

// No MutationObserver here on purpose. Earlier versions watched every DOM
// mutation and then rewrote the DOM again to "stabilise" it. That feedback loop
// was itself a source of micro-freezes and visual vibration. stable-dom.js now
// prevents silent same-view root rebuilds before they happen.
window.NewsViewStabilityV9138=Object.freeze({allowRender,isRenderAllowed:allowed});
const style=document.createElement('style');style.textContent=`
.page{animation:none!important}
.bottom-nav{grid-template-columns:repeat(3,1fr)!important;padding-left:max(18px,env(safe-area-inset-left))!important;padding-right:max(18px,env(safe-area-inset-right))!important}
.bottom-nav .nav-item.plus{order:2!important;justify-self:center!important;transform:translateY(-13px)!important}
.bottom-nav [data-view="home"]{order:1!important}.bottom-nav [data-view="brief"]{order:3!important}
.bottom-nav,.bottom-nav .nav-item{transition:none!important}
.stable-view-overlay-v91310{position:fixed;z-index:10050;inset:0;overflow:hidden;background:#fbfaff;pointer-events:none}.stable-view-clone-v91310{position:absolute!important;left:0;right:0;width:100%;min-height:100vh}.stable-view-overlay-v91310 .bottom-nav{pointer-events:none!important}.brief-switching-v9138 .runtime-brief-content{visibility:visible!important}
`;document.head.appendChild(style);
})();
