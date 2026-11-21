(()=>{
  'use strict';
  const START=performance.now();
  const MIN_VISIBLE_MS=650;
  const MAX_WAIT_MS=2200;
  const QUIET_MS=300;
  let lastChange=performance.now(),released=false;
  function overlay(){let el=document.getElementById('startup-stability-v9815');if(el)return el;el=document.createElement('div');el.id='startup-stability-v9815';el.innerHTML='<div class="startup-stability-v9815__icon"></div><strong>Mon actualité</strong><div class="startup-stability-v9815__bar"><i></i></div>';document.body.appendChild(el);return el}
  function ready(){const cards=[...document.querySelectorAll('.article-card[data-article]')];if(!cards.length)return false;return cards.slice(0,6).every(card=>card.dataset.photoLocked==='1')}
  function release(){if(released)return;released=true;const el=document.getElementById('startup-stability-v9815');if(!el)return;el.classList.add('leaving');setTimeout(()=>el.remove(),120)}
  function check(){if(released)return;const elapsed=performance.now()-START;if((elapsed>=MIN_VISIBLE_MS&&performance.now()-lastChange>=QUIET_MS&&ready())||elapsed>=MAX_WAIT_MS)release();else setTimeout(check,80)}
  function start(){overlay();window.addEventListener('news:stable-render',()=>{lastChange=performance.now()});setTimeout(check,80)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
