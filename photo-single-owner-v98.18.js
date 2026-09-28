(()=>{
  'use strict';
  const locks=new Map();
  const watching=new WeakSet();
  const abs=u=>{try{return new URL(u,location.href).href}catch{return String(u||'')}};
  const isTile=img=>{const target=abs(img.dataset.photoSrc||'');return !target||abs(img.src)!==target};
  function own(img){
    const card=img.closest('.article-card[data-article]'); if(!card)return;
    const id=String(card.dataset.article||''); if(!id)return;
    const remembered=locks.get(id);
    const target=remembered||img.dataset.photoSrc;
    if(!target)return;
    if(!remembered && abs(target)!==abs(img.src)) img.src=target;
    img.loading='eager';
    if(watching.has(img))return; watching.add(img);
    let locked=remembered||'';
    img.addEventListener('load',()=>{
      if(!locked && img.naturalWidth>1 && img.naturalHeight>1 && !isTile(img)){
        locked=img.currentSrc||img.src; locks.set(id,locked); card.dataset.photoLocked='1'; img.dataset.singleOwner='1';
      }
    },true);
    new MutationObserver(()=>{
      const wanted=locks.get(id)||locked;
      if(wanted && abs(img.src)!==abs(wanted)) img.src=wanted;
    }).observe(img,{attributes:true,attributeFilter:['src','srcset']});
  }
  function scan(root=document){root.querySelectorAll?.('img.article-image[data-photo-src]').forEach(own)}
  const app=document.getElementById('app');
  if(app)new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1){if(n.matches?.('img.article-image[data-photo-src]'))own(n);scan(n)}}).observe(app,{childList:true,subtree:true});
  window.addEventListener('news:stable-render',()=>scan()); scan();
})();
