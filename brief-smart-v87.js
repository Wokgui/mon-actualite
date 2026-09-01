(() => {
  'use strict';
  const stats={version:'91.38.4-loader',disabled:true,lastDeduped:0,lastCandidates:0,lastChosen:0,lastTopScores:[]};
  const api=Object.freeze({version:'91.38.4-loader',disabled:true,stats,sameEvent:()=>false,rank:()=>0,impactScore:()=>0,selectIds:()=>[]});
  window.__briefSmartV9110=api;window.__briefSmartV9112=api;
  for(const src of ['scroll-brief-ui-v91.38.3.js','brief-ui-v91.38.3.js','article-ui-v91.38.3.js']){
    if(document.querySelector(`script[data-v91384="${src}"]`))continue;
    const s=document.createElement('script');s.src=`${src}?v=91.38.4`;s.async=false;s.dataset.v91384=src;document.head.appendChild(s);
  }
})();
