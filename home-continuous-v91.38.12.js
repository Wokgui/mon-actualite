(() => {
'use strict';
let busy=false, timer=0;
const homeActive=()=>Boolean(document.querySelector('.bottom-nav .nav-item.active[data-view="home"]'));
function nearBottom(){
  const doc=document.documentElement;
  const remaining=Math.max(0,doc.scrollHeight-(window.scrollY+window.innerHeight));
  return remaining < Math.max(1800,window.innerHeight*3.2);
}
function pump(){
  clearTimeout(timer);
  timer=setTimeout(()=>{
    if(busy||document.hidden||!homeActive()||!nearBottom())return;
    const button=document.querySelector('.page .feed [data-home-more]');
    if(!button)return;
    busy=true;
    window.NewsViewStabilityV9138?.allowRender?.(900);
    button.click();
    setTimeout(()=>{busy=false;pump()},120);
  },35);
}
window.addEventListener('scroll',pump,{passive:true});
window.addEventListener('resize',pump,{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pump()});
document.addEventListener('click',()=>setTimeout(pump,60),true);
new MutationObserver(pump).observe(document.getElementById('app'),{childList:true,subtree:true});
setTimeout(pump,250);
setTimeout(pump,900);
})();
