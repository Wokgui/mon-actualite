(() => {
  'use strict';
  const stats={version:'91.38.13-loader',disabled:true,lastDeduped:0,lastCandidates:0,lastChosen:0,lastTopScores:[]};
  const api=Object.freeze({version:'91.38.13-loader',disabled:true,stats,sameEvent:()=>false,rank:()=>0,impactScore:()=>0,selectIds:()=>[]});
  window.__briefSmartV9110=api;window.__briefSmartV9112=api;
  // v91.38.13: Brief layout, history, watches and scroll-greying are now
  // finalized by feedly-continuous-v91.38.js in one pre-paint pass. Loading the
  // old brief-ui + scroll-brief-ui layers here caused the same view to be
  // rewritten several times after it was already visible.
  const src='article-ui-v91.38.3.js';
  if(!document.querySelector(`script[data-v913813="${src}"]`)){
    const s=document.createElement('script');s.src=`${src}?v=91.38.13`;s.async=false;s.dataset.v913813=src;document.head.appendChild(s);
  }
})();