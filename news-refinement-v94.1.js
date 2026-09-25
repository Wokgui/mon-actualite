(() => {
  'use strict';
  const MODE_KEY = 'news-watch-sensitivity-v1';
  const LONG_PRESS_MS = 620;
  const mode = () => ['strict','normal','large'].includes(localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : 'normal';
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const sameText = (a,b) => clean(a).localeCompare(clean(b), 'fr', { sensitivity: 'base' }) === 0;

  function installStyle() {
    if (document.getElementById('refinement-v944-style')) return;
    const style = document.createElement('style');
    style.id = 'refinement-v944-style';
    style.textContent = `
      .watch-sensitivity-v941{margin:6px 0 14px!important;padding:12px 14px!important;border-radius:16px!important}
      .watch-sensitivity-v941 .role-note-v941{margin:0 0 10px!important;font-size:12px!important;line-height:1.35!important}
      .watch-sensitivity-v941 label{font-size:13px!important;text-align:center!important;font-weight:700!important}
      .watch-sensitivity-v941 select{width:min(100%,330px)!important;min-height:38px!important;height:38px!important;margin:7px auto 0!important;padding:6px 30px 6px 10px!important;border-radius:12px!important;font-size:12px!important;line-height:1.15!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      .article-shortcut-v944{position:fixed;inset:0;z-index:10050;background:rgba(17,20,32,.34);display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box}
      .article-shortcut-v944__panel{width:min(100%,520px);max-height:min(78dvh,680px);overflow:auto;background:#fff;border-radius:24px;padding:18px;box-shadow:0 18px 50px rgba(20,24,45,.22)}
      .article-shortcut-v944__panel h2{font:800 18px/1.25 system-ui,sans-serif;margin:0 0 5px;color:#1f2430}
      .article-shortcut-v944__panel>p{font:500 12px/1.35 system-ui,sans-serif;margin:0 0 14px;color:#7b8190;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .article-shortcut-v944__actions{display:grid;gap:8px}
      .article-shortcut-v944__actions button{border:1px solid #e2e5ee;background:#f8f9fd;border-radius:14px;padding:11px 12px;text-align:left;color:#242a38;font:650 13px/1.25 system-ui,sans-serif}
      .article-shortcut-v944__actions button small{display:block;margin-top:2px;color:#858b99;font:500 11px/1.25 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .article-shortcut-v944__cancel{width:100%;margin-top:10px;border:0;background:transparent;padding:9px;color:#666d7c;font:650 13px system-ui,sans-serif}
      .article-shortcut-v944__edit{display:none;margin-top:12px;padding-top:12px;border-top:1px solid #eceef4}
      .article-shortcut-v944__edit.active{display:block}
      .article-shortcut-v944__edit label{display:block;font:700 12px system-ui,sans-serif;color:#343a48;margin-bottom:6px}
      .article-shortcut-v944__edit input{width:100%;box-sizing:border-box;border:1px solid #dfe2eb;border-radius:12px;padding:10px 11px;font:500 13px system-ui,sans-serif}
      .article-shortcut-v944__edit div{display:flex;gap:8px;margin-top:8px}
      .article-shortcut-v944__edit button{flex:1;border:0;border-radius:11px;padding:9px;font:700 12px system-ui,sans-serif}
      .article-shortcut-v944__edit [data-shortcut-save]{background:#6d68e8;color:white}.article-shortcut-v944__edit [data-shortcut-back]{background:#eff0f7;color:#3b4050}
    `;
    document.head.append(style);
  }

  function sections() { return [...document.querySelectorAll('.settings-page-v9185 .settings-accordion-v9185')]; }
  function findSection(title) { return sections().find(item => item.querySelector(':scope > summary')?.textContent?.trim() === title); }
  function addSettingsHelp() {
    if (!document.querySelector('.settings-page-v9185')) return;
    const notes = {
      'Centres d’intérêt': 'Thèmes larges : ils personnalisent l’Accueil sans exclure le reste de l’actualité.',
      'Mots-clés': 'Précisions de vos centres d’intérêt : ils renforcent la pertinence, sans devenir une veille.',
      'Actualité générale': 'Rubriques de base du fil général, indépendantes de la Veille.'
    };
    Object.entries(notes).forEach(([title, text]) => {
      const body = findSection(title)?.querySelector('.settings-accordion-content-v9185');
      if (!body || body.querySelector('.role-note-v941')) return;
      const p = document.createElement('p'); p.className = 'muted-note role-note-v941'; p.textContent = text; body.prepend(p);
    });
    const watchBody = findSection('Veille')?.querySelector('.settings-accordion-content-v9185');
    if (!watchBody || watchBody.querySelector('.watch-sensitivity-v941')) return;
    const box = document.createElement('div'); box.className = 'watch-sensitivity-v941';
    box.innerHTML = '<p class="muted-note role-note-v941">Seuls les sujets ajoutés ici alimentent la Veille. La sensibilité règle à quel point l’article doit être centré sur le sujet.</p><label>Sensibilité<select data-watch-sensitivity-v941><option value="strict">Strict · sujet principal</option><option value="normal">Normal · clairement pertinent</option><option value="large">Large · lien pertinent</option></select></label>';
    const select = box.querySelector('select'); select.value = mode(); select.addEventListener('change', () => localStorage.setItem(MODE_KEY, select.value)); watchBody.prepend(box);
  }

  function addBriefExplanation() {
    const title = document.querySelector('.brief-section-title');
    if (!title || title.parentElement.querySelector('.top5-note-v941')) return;
    const p = document.createElement('p'); p.className = 'muted-note top5-note-v941'; p.textContent = 'Sélection non personnalisée : importance, fraîcheur, portée mondiale et diversité des sources.'; title.after(p);
  }

  function prioritizeImages() {
    const images = [...document.querySelectorAll('.article-card img.article-image')];
    images.slice(0, 18).forEach((img, index) => {
      img.loading = 'eager';
      img.decoding = 'async';
      try { img.fetchPriority = index < 10 ? 'high' : 'auto'; } catch {}
      const src = img.currentSrc || img.src;
      if (src && !src.startsWith('data:') && !document.head.querySelector(`link[data-news-preload="${CSS.escape(src)}"]`)) {
        const link = document.createElement('link'); link.rel = 'preload'; link.as = 'image'; link.href = src; link.dataset.newsPreload = src; document.head.append(link);
      }
    });
  }

  function articleFromCard(card) {
    const id = clean(card?.dataset.article);
    const cache = readJson('news-live-cache', {});
    const article = Array.isArray(cache?.articles) ? cache.articles.find(item => String(item?.id || '') === id) : null;
    if (article) return article;
    return { id, title: clean(card?.querySelector('h2')?.textContent), source: clean(card?.querySelector('.source')?.textContent), category: clean(card?.querySelector('[data-category]')?.textContent) };
  }
  function addUnique(key, value) {
    const list = readJson(key, []); const v = clean(value); if (!v) return false;
    if (!list.some(item => sameText(typeof item === 'string' ? item : item?.query, v))) list.push(v);
    writeJson(key, list); return true;
  }
  function updateSettingsArray(field, value) {
    const settings = readJson('news-settings', {}); const list = Array.isArray(settings[field]) ? settings[field] : []; const v = clean(value); if (!v) return false;
    if (!list.some(item => sameText(item, v))) list.push(v); settings[field] = list; writeJson('news-settings', settings); return true;
  }
  function followSource(value) {
    const list = readJson('news-followed-sources-v1', []); const v = clean(value); if (!v) return false;
    if (!list.some(item => sameText(item, v))) list.push(v); writeJson('news-followed-sources-v1', list); return true;
  }
  function addWatch(value) {
    const list = readJson('news-watch-rules-v1', []); const v = clean(value); if (!v) return false;
    if (!list.some(rule => sameText(rule?.query, v))) list.push({ query:v, exclude:'' }); writeJson('news-watch-rules-v1', list); return true;
  }
  function closeShortcut() { document.querySelector('.article-shortcut-v944')?.remove(); }
  function finishShortcut(message) {
    closeShortcut();
    try { sessionStorage.setItem('news-active-view-v9204', 'settings'); } catch {}
    location.reload();
  }
  function editShortcut(root, kind, article) {
    const edit = root.querySelector('.article-shortcut-v944__edit'); const input = edit.querySelector('input'); const label = edit.querySelector('label');
    edit.dataset.kind = kind; edit.classList.add('active');
    label.textContent = kind === 'watch' ? 'Sujet à ajouter à Veille' : 'Mot-clé à ajouter';
    input.value = clean(article.title); input.focus(); input.select();
  }
  function openShortcut(article) {
    closeShortcut();
    const root = document.createElement('div'); root.className = 'article-shortcut-v944';
    const category = clean(article.category) || 'Cette rubrique'; const source = clean(article.source) || 'Cette source';
    root.innerHTML = `<div class="article-shortcut-v944__panel" role="dialog" aria-modal="true"><h2>Que faire de cet article ?</h2><p>${clean(article.title)}</p><div class="article-shortcut-v944__actions"><button data-shortcut="interest">Centre d’intérêt<small>Ajouter « ${category} »</small></button><button data-shortcut="keyword">Mot-clé<small>Ajouter un mot ou sujet précis</small></button><button data-shortcut="watch">Veille<small>Suivre précisément ce sujet</small></button><button data-shortcut="general">Actualité générale<small>Activer « ${category} »</small></button><button data-shortcut="source">Source d’information<small>Suivre « ${source} »</small></button></div><div class="article-shortcut-v944__edit"><label></label><input maxlength="120"><div><button data-shortcut-back>Retour</button><button data-shortcut-save>Ajouter</button></div></div><button class="article-shortcut-v944__cancel" data-shortcut-cancel>Annuler</button></div>`;
    root.addEventListener('click', event => {
      if (event.target === root || event.target.closest('[data-shortcut-cancel]')) return closeShortcut();
      if (event.target.closest('[data-shortcut-back]')) return root.querySelector('.article-shortcut-v944__edit').classList.remove('active');
      const action = event.target.closest('[data-shortcut]')?.dataset.shortcut;
      if (action === 'keyword' || action === 'watch') return editShortcut(root, action, article);
      if (action === 'interest') { updateSettingsArray('interests', category); return finishShortcut(); }
      if (action === 'general') { updateSettingsArray('generalCategories', category); return finishShortcut(); }
      if (action === 'source') { followSource(source); return finishShortcut(); }
      if (event.target.closest('[data-shortcut-save]')) {
        const edit = root.querySelector('.article-shortcut-v944__edit'); const value = clean(edit.querySelector('input').value); if (!value) return;
        edit.dataset.kind === 'watch' ? addWatch(value) : addUnique('news-keywords', value); finishShortcut();
      }
    });
    document.body.append(root);
  }

  let pressTimer = 0, pressCard = null, startX = 0, startY = 0, blockClickUntil = 0;
  function cancelPress() { if (pressTimer) clearTimeout(pressTimer); pressTimer = 0; pressCard = null; }
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('button,a,input,select,textarea,.article-shortcut-v944')) return;
    const card = event.target.closest('.article-card[data-article]'); if (!card) return;
    cancelPress(); pressCard = card; startX = Number(event.clientX || 0); startY = Number(event.clientY || 0);
    pressTimer = setTimeout(() => { const article = articleFromCard(card); pressTimer = 0; pressCard = null; blockClickUntil = Date.now() + 900; if (navigator.vibrate) navigator.vibrate(18); openShortcut(article); }, LONG_PRESS_MS);
  }, true);
  document.addEventListener('pointermove', event => { if (!pressCard || !pressTimer) return; if (Math.abs(Number(event.clientX||0)-startX)>12 || Math.abs(Number(event.clientY||0)-startY)>12) cancelPress(); }, { passive:true, capture:true });
  document.addEventListener('pointerup', cancelPress, true); document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('click', event => { if (Date.now() < blockClickUntil && event.target.closest('.article-card[data-article]')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  document.addEventListener('contextmenu', event => { if (event.target.closest('.article-card[data-article]')) event.preventDefault(); });

  function enhance() { installStyle(); addSettingsHelp(); addBriefExplanation(); prioritizeImages(); }
  const app = document.getElementById('app'); let pending = false;
  if (app) new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; enhance(); }); }).observe(app, { childList:true, subtree:true });
  window.addEventListener('news:stable-render', enhance); enhance();
})();