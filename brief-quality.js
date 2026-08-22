const BRIEF_BLOCK_KEY = 'news-blocked-terms-v1';
let briefQualityScheduled = false;

function bRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function bNorm(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function bEsc(value = '') {
  return String(value || '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function bTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (minutes < 1440) return `Il y a ${Math.floor(minutes / 60)} h`;
  return `Il y a ${Math.floor(minutes / 1440)} j`;
}

function bPhoto(article) {
  const params = new URLSearchParams({
    v: '3',
    url: String(article?.url || '').slice(0, 1900),
    title: String(article?.title || '').slice(0, 280),
    category: String(article?.category || '').slice(0, 70)
  });
  if (/^https?:\/\//i.test(article?.image || '') && String(article.image).length < 1900) params.set('image', article.image);
  return `/api/article-photo?${params}`;
}

function bBlocked(article) {
  const terms = bRead(BRIEF_BLOCK_KEY, []).map(bNorm).filter(Boolean);
  if (!terms.length) return false;
  const text = bNorm([article?.title, article?.summary, article?.detail, article?.category, article?.source].filter(Boolean).join(' '));
  return terms.some(term => text.includes(term));
}

const LOW_CATEGORIES = new Set(['Culture','Science','Tech','IA','Smartphones','VR','Automobile','Énergie','À suivre']);
const LOW_PATTERNS = [
  /\b(football|ligue 1|ligue des champions|champions league|cyclisme|vuelta|tour de france|tennis|rugby|formule 1|grand prix|nba|match|mercato|score|classement)\b/,
  /\b(influenceur|influenceuse|people|celebrite|star|chanteur|chanteuse|acteur|actrice|tele realite|tiktok|instagram|youtubeur)\b/,
  /\b(fait divers|faits divers|meurtre|assassinat|disparition|retrouve mort|retrouvee morte|accident de voiture|accident mortel|braquage|cambriolage|agression|incendie d une maison|drame familial)\b/,
  /\b(recette|vacances|tourisme|restaurant|mode|beaute|horoscope|astuce|bon plan|promotion|soldes|jeu steam|jeu video|smartphone|test produit|comparatif|comment savoir si|voici ce qui|voici comment)\b/
];

const MAJOR_PATTERNS = [
  /\b(gouvernement|assemblee nationale|senat|elysee|matignon|premier ministre|ministre|president|election|legislatives|presidentielle|referendum|loi|budget|reforme|motion de censure|conseil constitutionnel)\b/,
  /\b(guerre|cessez le feu|cessez-le-feu|invasion|offensive|sanctions|sommet|diplomatie|accord de paix|otan|onu|union europeenne|commission europeenne|parlement europeen)\b/,
  /\b(inflation|recession|croissance|chomage|emploi|bce|banque centrale|taux directeur|deficit|dette publique|commerce mondial|droits de douane)\b/,
  /\b(epidemie|pandemie|urgence sanitaire|catastrophe|seisme|tremblement de terre|inondations majeures|ouragan|canicule exceptionnelle|crise climatique|nucleaire)\b/,
  /\b(attentat|terrorisme|attaque militaire|frappe militaire|missile|otage|coup d etat|etat d urgence)\b/
];

const WORLD_HINTS = /\b(etats unis|usa|washington|chine|pekin|russie|moscou|ukraine|kiev|iran|teheran|israel|gaza|palestine|liban|syrie|inde|new delhi|japon|tokyo|coree|afrique|bresil|argentine|canada|mexique|royaume uni|londres|allemagne|berlin|italie|rome|espagne|madrid|union europeenne|bruxelles|otan|onu)\b/;
const FRANCE_HINTS = /\b(france|francais|francaise|paris|elysee|matignon|assemblee nationale|senat|gouvernement francais|ministere|hexagone)\b/;

function majorScore(article) {
  const category = String(article?.category || '');
  if (LOW_CATEGORIES.has(category)) return -999;
  const text = bNorm(`${article?.title || ''} ${article?.summary || ''}`);
  if (LOW_PATTERNS.some(pattern => pattern.test(text))) return -999;

  const base = {
    'Politique': 48,
    'International': 50,
    'Europe': 44,
    'Économie': 40,
    'Santé': 22,
    'Environnement': 20,
    'Société': 12,
    'Éducation': 12
  }[category] || 0;
  if (!base) return -999;

  let score = base;
  for (const pattern of MAJOR_PATTERNS) if (pattern.test(text)) score += 18;
  const age = Math.max(0, (Date.now() - Date.parse(article?.publishedAt || 0)) / 3600000);
  score += Math.max(0, 24 - age) * 0.9;
  score += Math.min(12, Math.max(0, Number(article?.score || 0) - 90) * 0.12);
  if (Array.isArray(article?.sources)) score += Math.min(16, Math.max(0, article.sources.length - 1) * 6);
  const feedback = bRead('news-feedback', {});
  if (feedback[article?.id] === 'less') score -= 18;
  if (feedback[article?.id] === 'more') score += 6;
  if (feedback[article?.id] === 'follow') score += 8;
  return score;
}

function briefZone(article) {
  const category = String(article?.category || '');
  const text = bNorm(`${article?.title || ''} ${article?.summary || ''}`);
  if (category === 'International' || category === 'Europe') return 'world';
  if (WORLD_HINTS.test(text) && !FRANCE_HINTS.test(text)) return 'world';
  return 'france';
}

function curatedBrief() {
  const cache = bRead('news-live-cache', {});
  const feedback = bRead('news-feedback', {});
  const articles = Array.isArray(cache.articles) ? cache.articles : [];
  const now = Date.now();
  let pool = articles.filter(article => {
    const age = now - Date.parse(article?.publishedAt || 0);
    return age >= 0 && age <= 48 * 3600000 && feedback[article?.id] !== 'not' && !bBlocked(article);
  });
  if (pool.length < 8) {
    pool = articles.filter(article => {
      const age = now - Date.parse(article?.publishedAt || 0);
      return age >= 0 && age <= 72 * 3600000 && feedback[article?.id] !== 'not' && !bBlocked(article);
    });
  }

  const scored = pool.map(article => ({ article, score: majorScore(article) })).filter(item => item.score >= 38).sort((a, b) => b.score - a.score);
  const select = zone => {
    const out = [];
    const sources = new Map();
    const titles = new Set();
    for (const item of scored) {
      if (briefZone(item.article) !== zone) continue;
      const title = bNorm(item.article?.title || '');
      if (title && titles.has(title)) continue;
      const source = bNorm(item.article?.source || item.article?.feedTitle || 'source');
      const count = sources.get(source) || 0;
      if (count >= 2) continue;
      out.push(item.article);
      if (title) titles.add(title);
      sources.set(source, count + 1);
      if (out.length >= 5) break;
    }
    return out;
  };
  return { france: select('france'), world: select('world') };
}

function briefRow(article, index) {
  return `<article class="article-card runtime-row" data-article="${bEsc(article.id)}" tabindex="0" aria-label="Lire : ${bEsc(article.title)}">
    <img class="article-image original-article-image direct-thumb" src="${bEsc(bPhoto(article))}" alt="" loading="${index < 3 ? 'eager' : 'lazy'}" decoding="async"${index < 2 ? ' fetchpriority="high"' : ''}>
    <div class="article-body">
      <h2>${bEsc(article.title)}</h2>
      <div class="meta"><span class="source">${bEsc(article.source || 'Source')}</span><span>${bEsc(bTime(article.publishedAt))}</span></div>
    </div>
  </article>`;
}

function applyBriefQuality() {
  briefQualityScheduled = false;
  if (!document.querySelector('.nav-item.active[data-view="brief"]')) return;
  if (!document.querySelector('.brief-mode-tab.active[data-brief-mode="essential"]')) return;
  const content = document.querySelector('.runtime-brief-content');
  if (!content) return;
  const { france, world } = curatedBrief();
  const signature = `${france.map(a => a.id).join(',')}|${world.map(a => a.id).join(',')}`;
  if (content.dataset.essentialQualitySignature === signature) return;
  content.dataset.essentialQualitySignature = signature;
  const section = (title, items) => `<section class="journal-section"><h2 class="brief-section-title">${title}</h2><div class="feed">${items.length ? items.map(briefRow).join('') : '<p class="muted-note">Aucune information majeure récente.</p>'}</div></section>`;
  content.innerHTML = `<p class="muted-note" style="margin:0 0 14px">Les événements majeurs des dernières 48 heures, sans sport, faits divers ni sujets secondaires.</p>${section('France', france)}${section('Monde', world)}`;
}

function scheduleBriefQuality() {
  if (briefQualityScheduled) return;
  briefQualityScheduled = true;
  requestAnimationFrame(applyBriefQuality);
}

const briefRoot = document.getElementById('app');
if (briefRoot) new MutationObserver(scheduleBriefQuality).observe(briefRoot, { childList: true, subtree: true });
window.addEventListener('focus', scheduleBriefQuality);
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleBriefQuality(); });
scheduleBriefQuality();