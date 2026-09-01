(() => {
'use strict';
const app=document.getElementById('app');if(!app)return;
let allowUntil=Date.now()+120;
const allowRender=(ms=500)=>{allowUntil=Math.max(allowUntil,Date.now()+Math.min(1400,Math.max(120,ms)))};
const allowed=()=>Date.now()<=allowUntil;

// v91.38.12: no cloned-page transition, no DOM snapshot, no global image-src
// interception. Those mechanisms were expensive on Android and caused the
// visible thumbnail flash plus the temporary movement of the centre nav item.
// stable-dom.js already blocks silent same-view rebuilds at their source.
document.addEventListener('pointerdown',e=>{
  if(e.target.closest?.('[data-view],[data-brief-mode],[data-home-more],[data-saved-filter],[data-refresh],[data-feedback],[data-topic-feedback],[data-direct-topic-add],[data-direct-topic-remove],[data-general-category],[data-interest],[data-brief-essential],[data-brief-watch],[data-dismiss-sheet],[data-close-sheet],[data-open-settings]')) allowRender(900);
},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')allowRender(600)},true);
window.NewsViewStabilityV9138=Object.freeze({allowRender,isRenderAllowed:allowed});
})();
