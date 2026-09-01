(() => {
'use strict';
let allowUntil=Date.now()+80;
const allowRender=(ms=180)=>{allowUntil=Math.max(allowUntil,Date.now()+Math.min(280,Math.max(90,ms)))};
const allowed=()=>Date.now()<=allowUntil;
// Only the immediate user-triggered render is allowed. Older versions kept a
// 900-1400 ms window open, which let delayed enhancers rewrite Home/Brief after
// they were already visible.
document.addEventListener('pointerdown',e=>{
  if(e.target.closest?.('[data-view],[data-brief-mode],[data-home-more],[data-saved-filter],[data-refresh],[data-feedback],[data-topic-feedback],[data-direct-topic-add],[data-direct-topic-remove],[data-general-category],[data-interest],[data-brief-essential],[data-brief-watch],[data-dismiss-sheet],[data-close-sheet],[data-open-settings]'))allowRender(220);
},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')allowRender(220)},true);
window.NewsViewStabilityV9138=Object.freeze({allowRender,isRenderAllowed:allowed});
})();