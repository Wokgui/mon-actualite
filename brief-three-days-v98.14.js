(()=>{
  const MIN_DAYS=3;
  let observer=null;
  let unlocked=false;

  function isEssentialActive(){
    return document.querySelector('[data-brief-mode="essential"]')?.classList.contains('active')===true;
  }

  function update(){
    const root=document.querySelector('[data-stable-brief-content]');
    if(!root) return;
    if(!isEssentialActive()){
      root.classList.remove('brief-waiting-three-days');
      return;
    }
    const dayCount=root.querySelectorAll(':scope > .brief-history-day-v9138').length;
    if(dayCount>=MIN_DAYS) unlocked=true;
    root.classList.toggle('brief-waiting-three-days',!unlocked);
  }

  function resetForFreshBrief(){
    if(!isEssentialActive()) return;
    const root=document.querySelector('[data-stable-brief-content]');
    if(!root) return;
    const dayCount=root.querySelectorAll(':scope > .brief-history-day-v9138').length;
    if(dayCount<MIN_DAYS) unlocked=false;
    update();
  }

  function watch(){
    observer?.disconnect();
    observer=new MutationObserver(()=>queueMicrotask(update));
    observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
    resetForFreshBrief();
  }

  document.addEventListener('click',event=>{
    if(event.target.closest('[data-view="brief"],[data-brief-mode="essential"]')){
      unlocked=false;
      requestAnimationFrame(resetForFreshBrief);
    }
  },true);

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',watch,{once:true}); else watch();
  window.addEventListener('news:stable-render',resetForFreshBrief);
})();
