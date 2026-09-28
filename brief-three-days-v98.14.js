(()=>{
  const MIN_DAYS=3;
  let observer=null;
  function update(){
    const root=document.querySelector('[data-stable-brief-content]');
    if(!root) return;
    const essentialTab=document.querySelector('[data-brief-mode="essential"]');
    const essentialActive=essentialTab?.classList.contains('active');
    if(!essentialActive){root.classList.remove('brief-waiting-three-days');return;}
    const days=root.querySelectorAll('.brief-history-day-v9138');
    root.classList.toggle('brief-waiting-three-days',days.length<MIN_DAYS);
  }
  function watch(){
    observer?.disconnect();
    observer=new MutationObserver(update);
    observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
    update();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',watch,{once:true}); else watch();
  window.addEventListener('news:stable-render',update);
})();
