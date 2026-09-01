(() => {
'use strict';
const RELEASE='91.40',SETTINGS='news-settings',KEYWORDS='news-keywords',HOME='news-home-topics-v9138';
const HOME_CATS=new Set(['IA','Tech','Smartphones','VR','Automobile','Énergie']);
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f}catch{return f}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const esc=v=>clean(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uniq=a=>{const s=new Set(),r=[];for(const x of Array.isArray(a)?a:[]){const v=clean(x),k=norm(v);if(v&&k&&!s.has(k)){s.add(k);r.push(v)}}return r};
const settings=()=>{const s=read(SETTINGS,{});return s&&typeof s==='object'?s:{}};
const homeTopics=()=>{const x=read(HOME,null);if(Array.isArray(x))return uniq(x);const init=uniq(settings().interests||[]);write(HOME,init);return init};
const watchTopics=()=>uniq(settings().briefWatchTopics||[]);
const saveWatch=a=>{const s=settings();s.briefWatchTopics=uniq(a);write(SETTINGS,s)};
const addKeyword=t=>write(KEYWORDS,uniq([...read(KEYWORDS,[]),t]));
const keepKeyword=t=>{const k=norm(t);return homeTopics().some(x=>norm(x)===k)||watchTopics().some(x=>norm(x)===k)};
const removeKeyword=t=>{if(keepKeyword(t))return;const k=norm(t);write(KEYWORDS,uniq(read(KEYWORDS,[]).filter(x=>norm(x)!==k)))};

function setTopic(kind,value,remove=false){
  value=clean(value);if(!value)return;const k=norm(value);
  if(kind==='home'){
    let h=homeTopics();h=remove?h.filter(x=>norm(x)!==k):uniq([...h,value]);write(HOME,h);
    const s=settings(),interests=Array.isArray(s.interests)?s.interests:[];
    if(remove)s.interests=interests.filter(x=>norm(x)!==k);else if(HOME_CATS.has(value))s.interests=uniq([...interests,value]);
    write(SETTINGS,s);if(!remove&&!HOME_CATS.has(value))addKeyword(value);
  }else{
    const w=watchTopics();saveWatch(remove?w.filter(x=>norm(x)!==k):uniq([...w,value]));if(!remove)addKeyword(value);
  }
  if(remove)removeKeyword(value);
  patchSheet(true);
  window.dispatchEvent(new CustomEvent('news-topic-preferences-changed'));
}

function editor(kind,topics){
  const home=kind==='home',ph=home?'Ex. robotique, Allemagne, voitures électriques…':'Ex. fusion nucléaire, Alzheimer, Quest 4…';
  return `<div class="direct-topic-editor-v9138"><div class="direct-topic-form-v9138"><input class="text-input" data-direct-topic-input="${kind}" maxlength="80" autocomplete="off" placeholder="${esc(ph)}"><button type="button" class="small-primary-btn" data-direct-topic-add="${kind}">${home?'Ajouter à l’accueil':'Ajouter à mes veilles'}</button></div>${topics.length?`<div class="direct-topic-list-v9138">${topics.map(t=>`<div class="direct-topic-item-v9138"><span>${esc(t)}</span><button type="button" data-direct-topic-remove="${kind}" data-topic="${esc(t)}">×</button></div>`).join('')}</div>`:'<p class="direct-topic-empty-v9138">Aucun sujet ajouté.</p>'}</div>`;
}

function patchSheet(force=false){
  const sh=document.querySelector('.personalization-sheet');if(!sh)return;
  for(const sec of sh.querySelectorAll('.personalize-section')){
    const title=clean(sec.querySelector('h3')?.textContent),kind=/^Accueil$/i.test(title)?'home':/Mes veilles/i.test(title)?'watches':'';if(!kind)continue;
    const topics=kind==='home'?homeTopics():watchTopics(),sig=topics.map(norm).join('|');
    if(!force&&sec.dataset.directV9138===sig&&sec.querySelector('.direct-topic-editor-v9138'))continue;
    sec.querySelectorAll(':scope > .personalize-chips,:scope > .personalize-add,:scope > .direct-topic-editor-v9138').forEach(n=>n.remove());
    sec.insertAdjacentHTML('beforeend',editor(kind,topics));sec.dataset.directV9138=sig;
    const p=sec.querySelector(':scope > p');if(p)p.textContent=kind==='home'?'Tapez librement les sujets que vous voulez faire remonter sur la page principale.':'Tapez librement les sujets que vous voulez suivre.';
  }
}

function versionUi(){
  document.documentElement.dataset.codeRelease=RELEASE;
  const s=document.querySelector('.app-version-section');if(!s)return;
  const title=s.querySelector('.app-version-row strong'),rel=s.querySelector('.app-version-row span:not(.app-version-badge)'),badge=s.querySelector('.app-version-badge');
  if(title&&title.textContent!==`Mon actualité · version ${RELEASE}`)title.textContent=`Mon actualité · version ${RELEASE}`;
  if(rel&&rel.textContent!=='Publication du 1er septembre 2026')rel.textContent='Publication du 1er septembre 2026';
  if(badge&&badge.textContent!==`v${RELEASE}`)badge.textContent=`v${RELEASE}`;s.dataset.codeRelease=RELEASE;
}

let queued=false;
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;patchSheet();versionUi()})}
document.addEventListener('pointerdown',e=>{if(e.target.closest?.('[data-view="sheet"],[data-open-settings],[data-runtime-settings]')){setTimeout(schedule,0);setTimeout(schedule,100);setTimeout(schedule,280)}},true);
document.addEventListener('click',e=>{
  const add=e.target.closest?.('[data-direct-topic-add]');if(add){e.preventDefault();const kind=add.dataset.directTopicAdd,input=document.querySelector(`[data-direct-topic-input="${kind}"]`);setTopic(kind,input?.value||'',false);if(input)input.value='';return}
  const del=e.target.closest?.('[data-direct-topic-remove]');if(del){e.preventDefault();setTopic(del.dataset.directTopicRemove,del.dataset.topic||'',true);return}
},true);
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-direct-topic-input]')){e.preventDefault();const kind=e.target.dataset.directTopicInput;setTopic(kind,e.target.value||'',false);e.target.value=''}},true);
window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});setTimeout(schedule,0);

const st=document.createElement('style');st.id='ui-summary-fixes-v9138';st.textContent=`
html body .feed.feed-settling-v9138{visibility:visible!important}
.hero-header p,.new-info-banner-v80,.brief-smart-v87,.brief-diff-v80,.verification-note-v83.single{display:none!important}
.article-card.new-since-visit-v79::after,.article-card.essential-v77::before,.article-card.essential-v77::after{content:none!important;display:none!important}
.article-card.essential-v77{border:0!important;background:transparent!important;box-shadow:none!important}.article-card.essential-v77 .article-body{background:transparent!important}
.direct-topic-editor-v9138{margin-top:12px}.direct-topic-form-v9138{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.direct-topic-form-v9138 .small-primary-btn{min-height:44px;white-space:nowrap}.direct-topic-list-v9138{display:grid;gap:7px;margin-top:10px}.direct-topic-item-v9138{display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:8px;align-items:center;min-height:42px;padding:5px 5px 5px 11px;border:1px solid #e7e3ec;border-radius:12px;background:#fff}.direct-topic-item-v9138 span{font-size:12px;font-weight:700;overflow-wrap:anywhere}.direct-topic-item-v9138 button{width:34px;height:34px;border:0;border-radius:10px;background:#f1eef5;color:#625b6b;font-size:20px}.direct-topic-empty-v9138{margin:9px 2px 0!important;color:#8a8492!important;font-size:11px!important}
`;
document.head.appendChild(st);
})();
