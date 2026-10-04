(()=>{'use strict';
const C='#8d82e8';
function installCss(){document.getElementById('ui-tune-v942')?.remove();const s=document.createElement('style');s.id='ui-tune-v942';s.textContent=`
:root{--news-accent-separator:${C}!important}
.shortcut-manual{grid-template-columns:minmax(0,1fr) 94px 94px!important}.shortcut-manual .shortcut-act{width:94px!important;min-width:94px!important;padding:9px 6px!important}
.source-directory-row-v9186{grid-template-columns:minmax(0,1fr) 82px 82px!important;column-gap:8px!important}.source-directory-row-v9186 [data-source-follow],.source-directory-row-v9186 [data-source-block]{box-sizing:border-box!important;width:82px!important;min-width:82px!important;max-width:82px!important;height:42px!important;padding:0 4px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;line-height:1.1!important}
.watch-sensitivity-v941 label{text-align:center!important}.watch-sensitivity-v941 select{box-sizing:border-box!important;min-height:52px!important;height:52px!important;padding:10px 34px 12px 14px!important;line-height:1.35!important;overflow:visible!important}
/* Une seule couleur et une seule épaisseur pour les séparateurs haut/bas des trois pages. */
.page-edge-top-v943,.page-edge-bottom-v943{position:fixed!important;left:0!important;right:0!important;height:2px!important;background:${C}!important;border:0!important;box-shadow:none!important;z-index:9998!important;pointer-events:none!important}
/* Le liseré de la date d'accueil est strictement identique aux barres. */
.home-date-v943{border:2px solid ${C}!important;outline:0!important;box-shadow:none!important}
/* Brief : le segment sélectionné remplit toute sa moitié, sans halo/bord mauve clair interne. */
.brief-tabs-clean-v943{padding:0!important;gap:0!important;overflow:hidden!important}
.brief-tabs-clean-v943 button{margin:0!important;border:0!important;outline:0!important;box-shadow:none!important;border-radius:0!important;height:100%!important;align-self:stretch!important}
.brief-tabs-clean-v943 button:first-child{border-radius:16px 0 0 16px!important}.brief-tabs-clean-v943 button:last-child{border-radius:0 16px 16px 0!important}
.brief-selected-v943{background:${C}!important;background-image:none!important;border:0!important;outline:0!important;box-shadow:none!important;color:#fff!important}
.brief-selected-v943::before,.brief-selected-v943::after{content:none!important;display:none!important}
@media(max-width:380px){.shortcut-manual{grid-template-columns:minmax(0,1fr) 86px 86px!important}.shortcut-manual .shortcut-act{width:86px!important;min-width:86px!important;font-size:11px!important}.source-directory-row-v9186{grid-template-columns:minmax(0,1fr) 76px 76px!important}.source-directory-row-v9186 [data-source-follow],.source-directory-row-v9186 [data-source-block]{width:76px!important;min-width:76px!important;max-width:76px!important}}
`;document.head.append(s)}
const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
function reorder(){const host=document.querySelector('.settings-accordions-v9185');if(!host)return;const all=[...host.querySelectorAll(':scope > .settings-accordion-v9185')];const find=t=>all.find(x=>x.querySelector(':scope > summary')?.textContent?.trim()===t);const size=find('Taille du texte'),general=find('Actualité générale');if(size&&general&&size.nextElementSibling!==general)host.insertBefore(size,general)}
function addLine(cls,top){const el=document.createElement('i');el.className=cls;el.style.top=Math.round(top)+'px';document.body.appendChild(el)}
function decorate(){document.querySelectorAll('.page-edge-top-v943,.page-edge-bottom-v943').forEach(x=>x.remove());const root=document.getElementById('app');if(!root)return;
 const nav=root.querySelector('.bottom-nav.stable-bottom-nav-v9184,.bottom-nav');if(nav)addLine('page-edge-bottom-v943',nav.getBoundingClientRect().top-2);
 let band=null;const home=[...root.querySelectorAll('h1,h2')].find(h=>text(h)==='Mon actualité');const pageHead=[...root.querySelectorAll('h1')].find(h=>['Réglages','Brief'].includes(text(h)));
 const h=home||pageHead;if(h){band=h.closest('.hero-header,.page-masthead-v9186')||h.parentElement;while(band&&band!==root&&band.getBoundingClientRect().height<70)band=band.parentElement;if(band)addLine('page-edge-top-v943',band.getBoundingClientRect().bottom-2)}
 if(home){const host=home.closest('.hero-header')||home.parentElement;const date=[...host.querySelectorAll('*')].find(x=>x.children.length===0&&/^\w+\s+\d{1,2}\s+\w+/i.test(text(x)));date?.classList.add('home-date-v943')}
 if(pageHead&&text(pageHead)==='Brief'){const buttons=[...root.querySelectorAll('button')].filter(b=>['Top 5 monde','Veille'].includes(text(b)));if(buttons.length===2){let tabs=buttons[0].parentElement;if(buttons[1].parentElement===tabs)tabs.classList.add('brief-tabs-clean-v943');buttons.forEach(btn=>{const selected=btn.classList.contains('active')||btn.getAttribute('aria-selected')==='true'||getComputedStyle(btn).color==='rgb(255, 255, 255)';btn.classList.toggle('brief-selected-v943',selected)})}}
}
let raf=0;function apply(){installCss();reorder();cancelAnimationFrame(raf);raf=requestAnimationFrame(decorate)}
const app=document.getElementById('app');if(app)new MutationObserver(()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{reorder();decorate()})}).observe(app,{childList:true,subtree:true});window.addEventListener('news:stable-render',apply);window.addEventListener('resize',()=>requestAnimationFrame(decorate));window.addEventListener('scroll',()=>requestAnimationFrame(decorate),{passive:true});apply();
})();