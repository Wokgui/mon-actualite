(()=>{
  'use strict';
  const START=performance.now();
  const MIN_VISIBLE_MS=1400;
  const MAX_WAIT_MS=9000;
  const QUIET_MS=900;
  let lastChange=performance.now();
  let released=false;
  function overlay(){let el=document.getElementById('startup-stability-v9815');if(el)return el;el=document.createElement('div');el.id='startup-stability-v9815';el.innerHTML='<div class="startup-stability-v9815__icon"></div><strong>Mon actualité</strong><div class="startup-stability-v9815__bar"><i></i></div>';document.body.appendChild(el);return el}
  function visibleCards(){return [...document.querySelectorAll('.article-card[data-article]')].filter(card=>{const r=card.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight})}
  function visibleImagesReady(){const cards=visibleCards();if(!cards.length)return false;return cards.every(card=>{const img=card.querySelector('img.article-image');if(!img)return true;return img.complete&&img.naturalWidth>1&&!img.classList.contains('image-pending-v98')&&(card.dataset.photoLocked==='1'||img.classList.contains('image-fallback-v98'))})}
  function release(){if(released)return;released=true;const el=document.getElementById('startup-stability-v9815');if(!el)return;el.classList.add('leaving');setTimeout(()=>el.remove(),180)}
  function check(){if(released)return;const elapsed=performance.now()-START,quiet=performance.now()-lastChange>=QUIET_MS;if((elapsed>=MIN_VISIBLE_MS&&quiet&&visibleImagesReady())||elapsed>=MAX_WAIT_MS)release();else setTimeout(check,120)}
  function start(){overlay();const app=document.getElementById('app');if(app)new MutationObserver(m=>{if(m.some(x=>x.type==='childList'))lastChange=performance.now()}).observe(app,{childList:true,subtree:true});window.addEventListener('news:stable-render',()=>{lastChange=performance.now()});window.addEventListener('news:photo-locked',()=>{lastChange=performance.now()});setTimeout(check,120)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
