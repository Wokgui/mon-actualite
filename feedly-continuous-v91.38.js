(() => {
  'use strict';

  const GREY_KEY = 'news-grey-after-scroll-v9138-v1';
  const CACHE_KEY = 'news-live-cache';
  const SETTINGS_KEY = 'news-settings';
  const KEYWORDS_KEY = 'news-keywords';
  const PATCH_FLAG = '__feedlyContinuousV9138';
  const greyIds = new Set();
  const observed = new WeakSet();
  let scrollDown = false;
  let lastY = window.scrollY;
  let moreBusy = false;
  let scheduled = false;

  const ALIASES = {
    'recherche scientifique':['recherche','science','scientifique','laboratoire','etude','decouverte'],
    'innovations':['innovation','startup','brevet','recherche','nouvelle technologie'],
    'innovation':['innovation','startup','brevet','recherche','nouvelle technologie'],
    'progres humains':['progres','avancee','decouverte','qualite de vie','education','droits humains'],
    'medecine':['medecine','medical','sante','traitement','therapie','vaccin','chirurgie'],
    'espace':['espace','spatial','astronomie','nasa','esa','satellite','lune','mars'],
    'energie':['energie','electricite','nucleaire','solaire','eolien','batterie','hydrogene'],
    'environnement':['environnement','climat','biodiversite','pollution','ecologie'],
    'education':['education','ecole','universite','apprentissage','formation'],
    'vr':['vr','realite virtuelle','virtual reality','quest','steamvr'],
    'ia':['ia','intelligence artificielle','openai','chatgpt','gemini','anthropic']
  };

  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = value => clean(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uniq = values => {
    const out = [], seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const value = clean(raw), key = norm(value);
      if (!value || !key || seen.has(key)) continue;
      seen.add(key); out.push(value);
    }
    return out;
  };

  for (const id of read(GREY_KEY, [])) greyIds.add(String(id));
  const persistGrey = () => write(GREY_KEY, [...greyIds].slice(-1200));
  const homeActive = () => Boolean(document.querySelector('.bottom-nav .nav-item.active[data-view="home"]'));
  const homeCards = () => [...document.querySelectorAll('.page .feed > .article-card[data-article]')];

  const visibleObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.intersectionRatio >= .55) entry.target.dataset.greyEligibleV9138 = '1';
  }, { threshold: [0,.25,.55,.8] });

  function bindCards() {
    if (!homeActive()) return;
    for (const card of homeCards()) {
      if (observed.has(card)) continue;
      observed.add(card);
      visibleObserver.observe(card);
    }
  }

  function shouldGrey(card) {
    if (!scrollDown || card.dataset.greyEligibleV9138 !== '1') return false;
    const rect = card.getBoundingClientRect();
    const threshold = Math.min(72, Math.max(24, innerHeight * .06));
    return rect.top < 0 && rect.bottom <= threshold;
  }

  function keepInsteadOfRemove(card) {
    if (!card?.isConnected) return;
    const id = String(card.dataset.article || '');
    if (id && shouldGrey(card)) {
      greyIds.add(id);
      persistGrey();
      card.classList.add('read-passed-v9138');
    }
    delete card.dataset.traversedV90;
    delete card.dataset.openedV90;
  }

  if (!Element.prototype[PATCH_FLAG]) {
    const nativeRemove = Element.prototype.remove;
    Object.defineProperty(Element.prototype, PATCH_FLAG, { value:true, configurable:false });
    Element.prototype.remove = function patchedRemove() {
      if (homeActive() && this.matches?.('.article-card[data-article]') && this.closest?.('.page .feed')) {
        keepInsteadOfRemove(this);
        return;
      }
      return nativeRemove.call(this);
    };
  }

  function syncGrey() {
    if (!homeActive()) return;
    for (const card of homeCards()) {
      const id = String(card.dataset.article || '');
      card.classList.toggle('read-passed-v9138', Boolean(id && greyIds.has(id)));
    }
  }

  function resetGrey() {
    greyIds.clear();
    persistGrey();
    for (const card of homeCards()) {
      card.classList.remove('read-passed-v9138');
      delete card.dataset.greyEligibleV9138;
      delete card.dataset.traversedV90;
    }
    scrollDown = false;
    lastY = window.scrollY;
  }

  function ensureResetButton() {
    let button = document.querySelector('[data-grey-reset-v9138]');
    if (!homeActive()) {
      if (button) button.hidden = true;
      return;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'grey-reset-v9138';
      button.dataset.greyResetV9138 = '1';
      button.textContent = 'Réinitialiser';
      button.setAttribute('aria-label','Dégriser tous les articles');
      document.body.appendChild(button);
    }
    button.hidden = false;
  }

  function maybeLoadMore() {
    if (moreBusy || !homeActive() || document.hidden) return;
    const button = document.querySelector('.page .feed [data-home-more]');
    if (!button) return;
    const rect = button.getBoundingClientRect();
    if (rect.top > innerHeight + Math.max(1200, innerHeight * 1.5)) return;
    moreBusy = true;
    window.NewsViewStabilityV9138?.allowRender?.(2200);
    button.click();
    setTimeout(() => { moreBusy = false; schedule(); }, 180);
  }

  function articles() {
    const cache = read(CACHE_KEY, {});
    return Array.isArray(cache.articles) ? cache.articles : [];
  }
  function settings() {
    const value = read(SETTINGS_KEY, {});
    return value && typeof value === 'object' ? value : {};
  }
  function watchTopics() { return uniq(settings().briefWatchTopics || []); }
  function articleText(article) { return norm([article.title,article.summary,article.detail,article.category,article.source,...(article.tags||[]),...(article.matches||[])].filter(Boolean).join(' ')); }
  function terms(topic) { return uniq([norm(topic),...(ALIASES[norm(topic)]||[])].map(norm)); }
  function has(text, term) { return term.length<=3&&!term.includes(' ')?(` ${text} `).includes(` ${term} `):text.includes(term); }
  function matches(article, topic) { return norm(article.category)===norm(topic)||terms(topic).some(term=>has(articleText(article),term)); }
  function dayKey(value) { const d=new Date(value); return Number.isNaN(d.getTime())?'unknown':`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
  function dayLabel(value) {
    const d=new Date(value); if(Number.isNaN(d.getTime()))return'Date inconnue';
    const n=new Date(), today=new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime(), date=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
    const delta=Math.round((today-date)/86400000);
    if(delta===0)return'Aujourd’hui'; if(delta===1)return'Hier'; if(delta===2)return'Avant-hier';
    const label=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(d); return label.charAt(0).toUpperCase()+label.slice(1);
  }
  function time(value) { const d=new Date(value); return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(d); }
  function image(article) {
    const raw=clean(article.visual?.url||article.image||article.quickVisualUrl); if(raw&&!/^data:image\/svg\+xml/i.test(raw))return raw;
    const p=new URLSearchParams({v:'19',url:clean(article.url).slice(0,1900),image:clean(article.image).slice(0,1900),title:clean(article.title).slice(0,280),category:clean(article.category).slice(0,70),source:clean(article.source).slice(0,100)}); return `/api/article-thumbnail?${p}`;
  }
  function row(article,index) {
    return `<article class="article-card runtime-row watch-row-v9138" data-article="${esc(article.id)}" tabindex="0"><img class="article-image original-article-image stable-visual" src="${esc(image(article))}" alt="" width="400" height="224" loading="${index<7?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer"><div class="article-body"><h2>${esc(article.title)}</h2><div class="meta"><span class="source">${esc(article.source||'Source')}</span><span>${esc(time(article.publishedAt))}</span></div></div></article>`;
  }

  function updateWatchTopic(value,remove=false) {
    value=clean(value); if(!value)return; const key=norm(value), s=settings(), current=uniq(s.briefWatchTopics||[]);
    s.briefWatchTopics=remove?current.filter(item=>norm(item)!==key):uniq([...current,value]); write(SETTINGS_KEY,s);
    const keywords=uniq(read(KEYWORDS_KEY,[])); write(KEYWORDS_KEY,remove?keywords.filter(item=>norm(item)!==key):uniq([...keywords,value]));
  }
  function watchEditorMarkup() {
    const topics=watchTopics();
    return `<div class="watch-editor-form-v9138"><input class="text-input" data-watch-editor-input maxlength="80" autocomplete="off" placeholder="Ex. fusion nucléaire, Alzheimer, Quest 4…"><button type="button" class="small-primary-btn" data-watch-editor-add>Ajouter</button></div><div class="watch-editor-list-v9138">${topics.length?topics.map(topic=>`<div class="watch-editor-item-v9138"><span>${esc(topic)}</span><button type="button" data-watch-editor-remove="${esc(topic)}" aria-label="Supprimer ${esc(topic)}">×</button></div>`).join(''):'<p class="muted-note">Aucune veille définie.</p>'}</div>`;
  }
  function openWatchEditor() {
    document.querySelector('.watch-editor-backdrop-v9138')?.remove(); const backdrop=document.createElement('div'); backdrop.className='watch-editor-backdrop-v9138';
    backdrop.innerHTML=`<section class="watch-editor-sheet-v9138" role="dialog" aria-modal="true" aria-label="Modifier mes veilles"><header><div><span>Mes veilles</span><h2>Modifier veilles</h2></div><button type="button" data-watch-editor-close aria-label="Fermer">×</button></header><p>Ajoutez ou retirez ici les sujets suivis.</p><div data-watch-editor-body>${watchEditorMarkup()}</div></section>`;
    document.body.appendChild(backdrop); setTimeout(()=>backdrop.querySelector('[data-watch-editor-input]')?.focus(),0);
  }
  function refreshEditor() { const body=document.querySelector('[data-watch-editor-body]'); if(body)body.innerHTML=watchEditorMarkup(); }

  function renderWatches() {
    if(!document.querySelector('.brief-mode-tab.active[data-brief-mode="watches"]'))return;
    const runtime=document.querySelector('.runtime-brief-content'); if(!runtime)return;
    const topics=watchTopics(), feedback=read('news-feedback',{}), all=articles().filter(a=>feedback[a.id]!=='not').sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,180);
    const order=[], byDay=new Map(); for(const a of all){const k=dayKey(a.publishedAt);if(!byDay.has(k)){byDay.set(k,[]);order.push(k)}byDay.get(k).push(a)}
    const days=order.slice(0,8), signature=`${topics.map(norm).join('|')}::${days.map(k=>`${k}:${(byDay.get(k)||[]).map(a=>a.id).join(',')}`).join('|')}`;
    if(runtime.dataset.feedlyWatchSigV9138===signature&&runtime.querySelector('.watch-layout-v9138'))return;
    const groups=days.map((key,gi)=>{const dayArticles=byDay.get(key)||[],watched=topics.length?dayArticles.filter(a=>topics.some(t=>matches(a,t))):[],sample=dayArticles[0];
      const w=watched.length?`<div class="feed watch-filtered-feed-v9138">${watched.slice(0,24).map((a,i)=>row(a,gi*30+i)).join('')}</div>`:'<p class="watch-empty-day-v9138">Aucune nouvelle de vos veilles ce jour-là.</p>';
      const allMarkup=`<div class="feed watch-all-feed-v9138" hidden>${dayArticles.map((a,i)=>row(a,gi*30+i)).join('')}</div>`;
      return `<section class="watch-day-v9138"><h3>${esc(dayLabel(sample?.publishedAt))}</h3>${w}<button type="button" class="watch-all-band-v9138" data-watch-all-toggle><span>Toute l’actualité</span><small>${dayArticles.length} article${dayArticles.length>1?'s':''}</small></button>${allMarkup}</section>`;}).join('');
    window.NewsViewStabilityV9138?.allowRender?.(1000);
    runtime.innerHTML=`<section class="watches-by-day-v9138 watch-layout-v9138"><div class="watches-head-v9138"><strong>Mes veilles</strong><button type="button" class="watch-edit-button-v9138" data-watch-edit-open>Modifier veilles</button></div>${groups||'<p class="muted-note">Aucune actualité récente.</p>'}</section>`;
    runtime.dataset.feedlyWatchSigV9138=signature;
    runtime.dataset.watchDaysV9138=`${topics.map(norm).join('|')}|${all.filter(a=>topics.some(t=>matches(a,t))).slice(0,80).map(a=>a.id).join('|')}`;
  }

  function refresh() { scheduled=false; bindCards(); syncGrey(); ensureResetButton(); maybeLoadMore(); renderWatches(); }
  function schedule() { if(scheduled)return; scheduled=true; requestAnimationFrame(refresh); }

  const style=document.createElement('style'); style.id='feedly-continuous-v9138-style'; style.textContent=`
    .article-card.read-passed-v9138{opacity:.52!important;filter:saturate(.55)!important;transition:opacity .18s ease!important}
    .article-card.read-passed-v9138 h2,.article-card.read-passed-v9138 .meta{color:#918c96!important}.article-card.read-passed-v9138 img{filter:grayscale(.35) saturate(.65)!important}
    .grey-reset-v9138{position:fixed;z-index:10020;top:max(7px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);min-height:30px;padding:6px 13px;border:1px solid rgba(99,82,181,.16);border-radius:999px;background:rgba(250,249,253,.94);color:#6758b7;box-shadow:0 2px 10px rgba(45,36,70,.08);backdrop-filter:blur(8px);font:800 10.5px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}.grey-reset-v9138:active{transform:translateX(-50%) scale(.97)}
    .home-more{height:1px!important;min-height:1px!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;overflow:hidden!important;pointer-events:none!important}
    .watch-edit-button-v9138{border:0;border-radius:999px;padding:9px 13px;background:#eee9ff;color:#5d48c9;font-size:11px;font-weight:850}
    .watch-day-v9138{margin-top:18px}.watch-day-v9138>h3{margin:0 0 9px;font-size:15px;color:#4f4956;font-weight:900;text-transform:none}.watch-all-band-v9138{width:100%;margin:11px 0 4px;padding:12px 14px;border:1px solid #e2ddec;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:space-between;color:#5d48c9;font-weight:850;text-align:left}.watch-all-band-v9138 small{color:#8b8591;font-size:10px;font-weight:700}.watch-all-band-v9138.open{background:#f1edff}.watch-empty-day-v9138{margin:8px 0 10px;color:#918b96;font-size:11px}
    .watch-editor-backdrop-v9138{position:fixed;inset:0;z-index:10050;background:rgba(28,23,39,.28);display:flex;align-items:flex-end;justify-content:center;padding:16px}.watch-editor-sheet-v9138{width:min(680px,100%);max-height:82vh;overflow:auto;border-radius:24px 24px 18px 18px;background:#faf9fd;padding:18px;box-shadow:0 18px 60px rgba(40,30,70,.24)}.watch-editor-sheet-v9138 header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.watch-editor-sheet-v9138 header span{font-size:10px;color:#8b8492;font-weight:800}.watch-editor-sheet-v9138 h2{margin:2px 0 0;font-size:22px}.watch-editor-sheet-v9138 header>button{width:40px;height:40px;border:0;border-radius:14px;background:#eeeaf3;font-size:24px;color:#625b69}.watch-editor-sheet-v9138>p{margin:8px 0 14px;color:#7c7582;font-size:12px}.watch-editor-form-v9138{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.watch-editor-list-v9138{display:grid;gap:7px;margin-top:12px}.watch-editor-item-v9138{display:grid;grid-template-columns:minmax(0,1fr) 36px;align-items:center;gap:8px;padding:6px 6px 6px 12px;border:1px solid #e5e1ea;border-radius:13px;background:#fff;font-size:12px;font-weight:750}.watch-editor-item-v9138 button{width:34px;height:34px;border:0;border-radius:10px;background:#f1eef5;color:#625b6b;font-size:20px}
    @media(max-width:380px){.watch-editor-form-v9138{grid-template-columns:1fr}.watch-editor-form-v9138 .small-primary-btn{width:100%}}
  `; document.head.appendChild(style);

  document.addEventListener('click',event=>{
    const reset=event.target.closest?.('[data-grey-reset-v9138]'); if(reset){event.preventDefault();event.stopImmediatePropagation();resetGrey();return}
    const open=event.target.closest?.('[data-watch-edit-open]'); if(open){event.preventDefault();event.stopImmediatePropagation();openWatchEditor();return}
    const close=event.target.closest?.('[data-watch-editor-close]'); if(close||event.target.classList?.contains('watch-editor-backdrop-v9138')){event.preventDefault();document.querySelector('.watch-editor-backdrop-v9138')?.remove();return}
    const add=event.target.closest?.('[data-watch-editor-add]'); if(add){event.preventDefault();const input=document.querySelector('[data-watch-editor-input]');updateWatchTopic(input?.value||'',false);if(input)input.value='';refreshEditor();renderWatches();return}
    const remove=event.target.closest?.('[data-watch-editor-remove]'); if(remove){event.preventDefault();updateWatchTopic(remove.dataset.watchEditorRemove||'',true);refreshEditor();renderWatches();return}
    const toggle=event.target.closest?.('[data-watch-all-toggle]'); if(toggle){event.preventDefault();const day=toggle.closest('.watch-day-v9138'),filtered=day?.querySelector('.watch-filtered-feed-v9138'),empty=day?.querySelector('.watch-empty-day-v9138'),all=day?.querySelector('.watch-all-feed-v9138'),opening=Boolean(all?.hidden);if(all)all.hidden=!opening;if(filtered)filtered.hidden=opening;if(empty)empty.hidden=opening;toggle.classList.toggle('open',opening);toggle.querySelector('span').textContent=opening?'Mes veilles seulement':'Toute l’actualité';return}
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches?.('[data-watch-editor-input]')){event.preventDefault();updateWatchTopic(event.target.value||'',false);event.target.value='';refreshEditor();renderWatches()}},true);

  window.addEventListener('scroll',()=>{const y=window.scrollY;scrollDown=y>lastY+1?true:y<lastY-1?false:scrollDown;lastY=y;schedule()},{passive:true});
  window.addEventListener('resize',schedule,{passive:true}); window.addEventListener('focus',schedule); document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule()});
  const app=document.getElementById('app'); if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
  setTimeout(schedule,0); setTimeout(schedule,350);
})();
