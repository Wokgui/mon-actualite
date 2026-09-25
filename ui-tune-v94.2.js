(()=>{'use strict';
function installCss(){if(document.getElementById('ui-tune-v942'))return;const s=document.createElement('style');s.id='ui-tune-v942';s.textContent=`
.shortcut-manual{grid-template-columns:minmax(0,1fr) 94px 94px!important}.shortcut-manual .shortcut-act{width:94px!important;min-width:94px!important;padding:9px 6px!important}
/* Source directory: Suivre / Bloquer always have exactly the same footprint. */
.source-directory-row-v9186{grid-template-columns:minmax(0,1fr) 82px 82px!important;column-gap:8px!important}.source-directory-row-v9186 [data-source-follow],.source-directory-row-v9186 [data-source-block]{box-sizing:border-box!important;width:82px!important;min-width:82px!important;max-width:82px!important;height:42px!important;padding:0 4px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;text-align:center!important;line-height:1.1!important}
/* Watch sensitivity: enough vertical room for descenders such as the p in pertinent. */
.watch-sensitivity-v941 label{text-align:center!important}.watch-sensitivity-v941 select{box-sizing:border-box!important;min-height:52px!important;height:auto!important;padding-top:13px!important;padding-bottom:15px!important;line-height:1.45!important;overflow:visible!important}
/* One coherent accent separator system: header/content and content/bottom navigation. */
:root{--news-accent-separator:rgba(103,83,225,.42)}
.app-header,.home-header,.brief-header,.settings-header,.page-header,.top-shell,.hero-header{border-bottom:2px solid var(--news-accent-separator)!important}
.bottom-nav,.app-nav,.main-nav,nav[aria-label*="principale" i]{border-top:2px solid var(--news-accent-separator)!important}
/* Settings and Watch use the same separator instead of pale grey rules. */
.settings-accordion-v9185{border-bottom-color:var(--news-accent-separator)!important}.settings-accordion-v9185>summary{border-color:var(--news-accent-separator)!important}.watch-sensitivity-v941{border-color:var(--news-accent-separator)!important}
@media(max-width:380px){.shortcut-manual{grid-template-columns:minmax(0,1fr) 86px 86px!important}.shortcut-manual .shortcut-act{width:86px!important;min-width:86px!important;font-size:11px!important}.source-directory-row-v9186{grid-template-columns:minmax(0,1fr) 76px 76px!important}.source-directory-row-v9186 [data-source-follow],.source-directory-row-v9186 [data-source-block]{width:76px!important;min-width:76px!important;max-width:76px!important}}
`;document.head.append(s)}
function reorder(){const host=document.querySelector('.settings-accordions-v9185');if(!host)return;const all=[...host.querySelectorAll(':scope > .settings-accordion-v9185')];const find=t=>all.find(x=>x.querySelector(':scope > summary')?.textContent?.trim()===t);const size=find('Taille du texte'),general=find('Actualité générale');if(size&&general&&size.nextElementSibling!==general)host.insertBefore(size,general)}
function apply(){installCss();reorder()}
const app=document.getElementById('app');if(app)new MutationObserver(()=>requestAnimationFrame(apply)).observe(app,{childList:true,subtree:true});window.addEventListener('news:stable-render',apply);apply();
})();