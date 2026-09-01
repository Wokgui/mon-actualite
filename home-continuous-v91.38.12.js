(() => {
'use strict';
let busy=false,timer=0;
const home=()=>document.querySelector('.bottom-nav .nav-item.active[data-view="home"]');
function nearBottom(){return document.documentElement.scrollHeight-(scrollY+innerHeight)<Math.max(2200,innerHeight*3.6)}
function pump(delay=30){clearTimeout(timer);timer=setTimeout(()=>{if(busy||document.hidden||!home()||!nearBottom())return;const button=document.querySelector('.page .feed [data-home-more]');if(!button)return;busy=true;window.NewsViewStabilityV9138?.allowRender?.(220);button.click();setTimeout(()=>{busy=false;pump(20)},70)},delay)}
window.addEventListener('scroll',()=>pump(20),{passive:true});window.addEventListener('resize',()=>pump(40),{passive:true});
document.addEventListener('click',e=>{if(e.target.closest?.('[data-view="home"]'))setTimeout(()=>pump(10),0)},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pump(30)});
setTimeout(()=>pump(0),120);setTimeout(()=>pump(0),500);
})();