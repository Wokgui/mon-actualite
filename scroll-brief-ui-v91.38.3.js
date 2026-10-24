(() => {
'use strict';
const BRIEF_GREY='news-brief-grey-scroll-v9138-v1',CACHE='news-live-cache';
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const home=()=>!!document.querySelector('.nav-item.active[data-view="home"]'),brief=()=>!!document.querySelector('.nav-item.active[data-view="brief"]');
const grey=new Set(read(BRIEF_GREY,[]).map(String)),obsd=new WeakSet();let lastY=scrollY,down=false,scheduled=false;
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.intersectionRatio>=.5)e.target.dataset.briefGreyEligible='1'}),{threshold:[0,.25,.5,.75]});
function cards(){return brief()?[...document.querySelectorAll('.page .feed .article-card[data-article]')]:[]}
function bind(){for(const c of cards()){if(grey.has(String(c.dataset.article||'')))c.classList.add('read-passed-v9138');if(!obsd.has(c)){obsd.add(c);io.observe(c)}}}
function mark(){if(!brief()||!down||document.querySelector('.quick-summary-backdrop'))return;let ch=false;for(const c of cards()){if(c.classList.contains('read-passed-v9138')||c.dataset.briefGreyEligible!=='1')continue;const r=c.getBoundingClientRect();if(r.top<0&&r.bottom<=Math.max(16,innerHeight*.04)){const id=String(c.dataset.article||'');if(id)grey.add(id);c.classList.add('read-passed-v9138');ch=true}}if(ch)write(BRIEF_GREY,[...grey].slice(-1500))}
function reset(){grey.clear();write(BRIEF_GREY,[]);document.querySelectorAll('.article-card.read-passed-v9138').forEach(c=>c.classList.remove('read-passed-v9138'));const old=document.querySelector('[data-grey-reset-v9138]');if(old)old.click()}
function icon(){document.querySelectorAll('.grey-reset-v9138,.feed-reset-v9138,.feed-reset-button-v9138').forEach(n=>n.style.setProperty('display','none','important'));let b=document.querySelector('.top-reset-icon-v9138');if(!b){b=document.createElement('button');b.type='button';b.className='top-reset-icon-v9138';b.textContent='↻';b.title='Réinitialiser';b.setAttribute('aria-label','Réinitialiser les articles parcourus');document.body.appendChild(b)}b.hidden=!(home()||brief())||!!document.querySelector('.quick-summary-backdrop,.personalization-sheet,.watch-editor-backdrop-v9138')}
function hideHomeBand(){if(!home())return;for(const n of document.querySelectorAll('.page h1,.page h2,.page h3,.page h4,.page .section-title,.page .section-heading,.page .feed-heading,.page .saved-filter')){const t=norm(n.textContent);if(t==='toute l actualite'||t==='toute actualite')n.style.display='none'}}
function run(){scheduled=false;bind();mark();icon();hideHomeBand()}
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(run)}
document.addEventListener('click',e=>{if(e.target.closest?.('.top-reset-icon-v9138')){e.preventDefault();e.stopImmediatePropagation();reset()}},true);
window.addEventListener('scroll',()=>{const y=scrollY;down=y>lastY+1;lastY=y;schedule()},{passive:true});window.addEventListener('resize',schedule,{passive:true});
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});setTimeout(schedule,0);
const s=document.createElement('style');s.textContent=`
.top-reset-icon-v9138{position:fixed;z-index:1100;top:max(2px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:30px;height:28px;padding:0;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;color:#6d55d8;font-size:22px;font-weight:800;line-height:28px;text-align:center;-webkit-appearance:none;appearance:none}.top-reset-icon-v9138[hidden]{display:none!important}
.article-card.read-passed-v9138{opacity:.48!important;filter:saturate(.5)!important}.article-card.read-passed-v9138 h2,.article-card.read-passed-v9138 .meta{color:#96919b!important}.article-card.read-passed-v9138 img{filter:grayscale(.42) saturate(.58)!important}
`;document.head.appendChild(s);
})();
