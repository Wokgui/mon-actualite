(()=>{
  'use strict';
  let loading=false;
  let ready=false;
  const dayKey=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`};
  const hasThreeDays=articles=>new Set((articles||[]).map(a=>dayKey(a.publishedAt)).filter(Boolean)).size>=3;
  async function prepare(){
    if(loading||ready)return ready;
    loading=true;
    try{
      const settings=JSON.parse(localStorage.getItem('news-settings')||'{}');
      const language=String(settings.language||document.documentElement.lang||'fr').split('-')[0];
      const url=location.hostname==='wokgui.github.io'
        ?new URL('./preview-news.json',location.href)
        :new URL('/api/news',location.origin);
      url.searchParams.set('language',language);
      url.searchParams.set('brief','3days');
      url.searchParams.set('t',Date.now().toString());
      const response=await fetch(url.href,{cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache'}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const payload=await response.json();
      if(hasThreeDays(payload?.articles)){
        window.__applyNewsPayloadV9128?.(payload);
        ready=true;
      }
    }catch{}finally{loading=false}
    return ready;
  }
  // Prépare l'historique dès que l'écran principal est utilisable, sans attendre l'ouverture du Brief.
  const start=()=>window.setTimeout(()=>void prepare(),250);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  // Si l'utilisateur ouvre le Brief avant la fin du préchargement, on garde l'écran courant puis on ouvre le Brief une fois les 3 jours prêts.
  document.addEventListener('click',async event=>{
    const button=event.target.closest('.bottom-nav .nav-item[data-view="brief"]');
    if(!button||ready||button.dataset.briefPrefetchReplay==='1')return;
    event.preventDefault();event.stopImmediatePropagation();
    const ok=await prepare();
    if(ok){button.dataset.briefPrefetchReplay='1';button.click();requestAnimationFrame(()=>delete button.dataset.briefPrefetchReplay)}
    else{button.dataset.briefPrefetchReplay='1';button.click();requestAnimationFrame(()=>delete button.dataset.briefPrefetchReplay)}
  },true);
})();
