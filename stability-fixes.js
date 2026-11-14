const STABLE_IMAGE_KEY = 'news-stable-images-v1';
const ARTICLE_CACHE_KEY = 'news-live-cache';
const PUBLISHER_IMAGE_KEY = 'news-original-images-v3-no-google-logo';

function sfRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}

function sfWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function sfArticle(id) {
  const cache = sfRead(ARTICLE_CACHE_KEY, {});
  const list = Array.isArray(cache.articles) ? cache.articles : [];
  return list.find(item => String(item?.id || '') === String(id || '')) || null;
}

function sfFallback(article) {
  const params = new URLSearchParams({
    v: '3',
    title: String(article?.title || '').slice(0, 280),
    category: String(article?.category || '').slice(0, 70)
  });
  return new URL(`/api/article-photo-fast?${params}`, location.href).href;
}

function sfAbsolute(value) {
  try { return new URL(String(value || ''), location.href).href; }
  catch { return ''; }
}

function sfCardForImage(image) {
  return image?.closest?.('[data-article]') || null;
}

function sfRemember(id, url) {
  if (!id || !url) return;
  const stable = sfRead(STABLE_IMAGE_KEY, {});
  stable[String(id)] = url;
  sfWrite(STABLE_IMAGE_KEY, stable);

  // Le moteur d’illustrations existant lit déjà ce cache. En y plaçant
  // le secours qui a réellement fonctionné, il ne retente plus une URL cassée.
  const publisher = sfRead(PUBLISHER_IMAGE_KEY, {});
  publisher[String(id)] = url;
  sfWrite(PUBLISHER_IMAGE_KEY, publisher);
}

function sfStableFor(id) {
  return sfAbsolute(sfRead(STABLE_IMAGE_KEY, {})[String(id || '')] || '');
}

// Important : cet écouteur est volontairement en capture. Lorsqu’une photo
// éditeur échoue, on choisit UNE seule URL de secours et on la mémorise.
// Cela évite la boucle photo éditeur -> thumbnail -> illustration -> photo éditeur
// qui provoquait le clignotement de toute la liste.
document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const card = sfCardForImage(image);
  const id = card?.dataset?.article;
  if (!id) return;

  const article = sfArticle(id);
  const fallback = sfStableFor(id) || sfFallback(article);
  if (!fallback) return;

  sfRemember(id, fallback);
  image.dataset.stableImage = '1';
  image.removeAttribute('referrerpolicy');
  if (sfAbsolute(image.getAttribute('src')) !== fallback) image.src = fallback;

  // Empêche les anciens gestionnaires d’erreur de réécrire immédiatement src.
  event.stopImmediatePropagation();
}, true);

document.addEventListener('load', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const card = sfCardForImage(image);
  const id = card?.dataset?.article;
  if (!id) return;
  const src = sfAbsolute(image.currentSrc || image.src || '');
  if (!src) return;
  if (/\/api\/(?:article-photo-fast|article-thumbnail)\b/i.test(src)) sfRemember(id, src);
}, true);

// Si un ancien MutationObserver tente malgré tout de remettre l’URL cassée,
// restaure immédiatement l’image connue comme stable sans reconstruire la carte.
const sfRoot = document.getElementById('app');
if (sfRoot) {
  new MutationObserver(records => {
    const stable = sfRead(STABLE_IMAGE_KEY, {});
    for (const record of records) {
      const image = record.target;
      if (!(image instanceof HTMLImageElement)) continue;
      const card = sfCardForImage(image);
      const id = card?.dataset?.article;
      if (!id) continue;
      const wanted = sfAbsolute(stable[String(id)] || '');
      if (!wanted) continue;
      if (sfAbsolute(image.getAttribute('src')) === wanted) continue;
      image.dataset.stableImage = '1';
      image.removeAttribute('referrerpolicy');
      image.src = wanted;
    }
  }).observe(sfRoot, { subtree: true, attributes: true, attributeFilter: ['src'] });
}
