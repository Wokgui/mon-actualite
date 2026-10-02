// Subscription-only. Credentials never enter JavaScript, browser storage or our
// backend. Native account requests are origin/main-frame restricted by Android.
export const AI_PROVIDERS = Object.freeze([
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', integrated: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', integrated: false },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', integrated: false },
  { id: 'mistral', name: 'Le Chat · Mistral', url: 'https://chat.mistral.ai/', integrated: false },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', integrated: false },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/', integrated: false }
]);
export const DEFAULT_AI_PROMPT = 'Résume les actualités importantes en français. Présente les faits, leurs conséquences et ce qui est nouveau. Regroupe les articles qui parlent du même événement et indique les sources. Ne complète pas les informations absentes des sources.';
const CONFIG_KEY = 'news-brief-ai-settings-v1';
const RESULT_KEY = 'news-brief-ai-results-v1';
const subscribers = new Set();
const requests = new Map();
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const initial = read(CONFIG_KEY, {});
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const briefAI = {
  provider: AI_PROVIDERS.some(provider => provider.id === initial.provider) ? initial.provider : 'chatgpt',
  prompt: clean(initial.prompt, 6000) || DEFAULT_AI_PROMPT,
  model: clean(initial.model, 100),
  autoAtOpen: initial.autoAtOpen !== false,
  busy: '', progress: '', error: '', account: { profiles: [], activeId: '', models: [] },
  result: null
};
const persistedResult = read(RESULT_KEY, null);
if (persistedResult?.provider === briefAI.provider && persistedResult?.prompt === briefAI.prompt
  && Array.isArray(persistedResult?.cards)) {
  try { briefAI.result = normalizeAIResult(persistedResult, persistedResult.cards.map(card => card.article)); } catch {}
}
export function aiProvider() { return AI_PROVIDERS.find(provider => provider.id === briefAI.provider); }
export function nativeAIAvailable() { return typeof window.MonActualiteAI?.postMessage === 'function'; }
export function onAIChange(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }
function notify() { for (const callback of subscribers) callback(); }
export function setAISettings(settings, { announce = true } = {}) {
  if (AI_PROVIDERS.some(provider => provider.id === settings.provider)) briefAI.provider = settings.provider;
  if (typeof settings.prompt === 'string') briefAI.prompt = settings.prompt.slice(0, 6000);
  if (typeof settings.model === 'string') briefAI.model = settings.model.slice(0, 100);
  if (typeof settings.autoAtOpen === 'boolean') briefAI.autoAtOpen = settings.autoAtOpen;
  briefAI.error = '';
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ provider: briefAI.provider, prompt: briefAI.prompt, model: briefAI.model, autoAtOpen: briefAI.autoAtOpen })); } catch {}
  if (announce) notify();
}
function nativeRequest(action, payload = {}, timeoutMs = 90000) {
  if (!nativeAIAvailable()) return Promise.reject(new Error('La connexion avec l’abonnement est disponible dans l’application Android. Aucun identifiant n’est enregistré dans le navigateur.'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      requests.delete(id);
      if (action === 'generate') try { window.MonActualiteAI.postMessage(JSON.stringify({ id: crypto.randomUUID(), action: 'cancel_generation' })); } catch {}
      if (action === 'connect') try { window.MonActualiteAI.postMessage(JSON.stringify({ id: crypto.randomUUID(), action: 'cancel' })); } catch {}
      reject(new Error('La demande a expiré. Réessaie depuis l’application.'));
    }, timeoutMs);
    requests.set(id, { resolve, reject, timer, action });
    window.MonActualiteAI.onmessage = event => {
      let response;
      try { response = JSON.parse(event.data); } catch { return; }
      const request = requests.get(response.id);
      if (!request) return;
      if (typeof response.progress === 'string') {
        if (request.action === 'connect' && briefAI.busy === 'connect') { briefAI.progress = clean(response.progress, 100); notify(); }
        return;
      }
      requests.delete(response.id); clearTimeout(request.timer);
      if (response.ok) request.resolve(response.data);
      else request.reject(new Error(clean(response.error, 500) || 'La demande IA n’a pas abouti.'));
    };
    try { window.MonActualiteAI.postMessage(JSON.stringify({ id, action, ...payload })); }
    catch { requests.delete(id); clearTimeout(timer); reject(new Error('Connexion Android indisponible.')); }
  });
}
export async function refreshAIAccount() {
  if (!nativeAIAvailable() || briefAI.busy) return;
  try {
    const account = await nativeRequest('status', {}, 10000);
    account.models = account.activeId === briefAI.account.activeId ? briefAI.account.models || [] : [];
    briefAI.account = account; notify(); await loadAIModels();
  } catch {}
}
export async function aiAccountAction(action, profileId = '') {
  if (briefAI.busy) return;
  briefAI.busy = action; briefAI.progress = ''; briefAI.error = ''; notify();
  try {
    briefAI.account = await nativeRequest(action, { profileId }, action === 'connect' ? 420000 : action === 'disconnect' ? 150000 : 90000);
    if (action === 'connect' && briefAI.account.planEnabled && !localStorage.getItem('news-brief-ai-welcome-v1')) {
      window.alert('Tu utilises ton abonnement ChatGPT. Les demandes IA de Mon Actualité consomment ses limites et, selon tes réglages ChatGPT, les crédits que tu as autorisés. Tu peux gérer cette utilisation dans les réglages ChatGPT.');
      localStorage.setItem('news-brief-ai-welcome-v1', '1');
    }
    if (action === 'connect' || action === 'select') {
      setAISettings({ model: '' }, { announce: false });
      if (briefAI.account.planEnabled) briefAI.account.models = await nativeRequest('models', {}, 90000);
    }
  } catch (error) {
    briefAI.error = error.message;
    if (action === 'disconnect' || action === 'connect') try { briefAI.account = await nativeRequest('status', {}, 10000); } catch {}
  }
  finally { briefAI.busy = ''; briefAI.progress = ''; notify(); }
}
let modelsRequest = null;
export async function loadAIModels() {
  if (!nativeAIAvailable() || !briefAI.account.planEnabled || briefAI.account.models?.length) return;
  if (modelsRequest) return modelsRequest;
  const activeId = briefAI.account.activeId;
  modelsRequest = (async () => {
    try { const models = await nativeRequest('models', {}, 90000); if (activeId === briefAI.account.activeId) briefAI.account.models = models; notify(); }
    catch (error) { briefAI.error = error.message; notify(); }
    finally { modelsRequest = null; }
  })();
  return modelsRequest;
}
function hash(value) {
  let result = 2166136261;
  for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(16);
}
export function normalizeAIResult(payload, articles) {
  if (!payload || !Array.isArray(payload.cards)) throw new Error('Réponse IA invalide : aucun article exploitable.');
  const cleanArticles = (Array.isArray(articles) ? articles : []).filter(article => {
    try { return article && ['https:', 'http:'].includes(new URL(article.url).protocol); } catch { return false; }
  });
  const byId = new Map(cleanArticles.map(article => [String(article.id), article]));
  const byUrl = new Map(cleanArticles.map(article => [article.url, article]));
  const seen = new Set();
  const cards = payload.cards.slice(0, 12).flatMap(card => {
    const article = byId.get(String(card.sourceId || '')) || byUrl.get(card.article?.url);
    const title = clean(card.title, 240), summary = clean(card.summary, 5000);
    if (!article || !title || !summary || seen.has(article.url)) return [];
    seen.add(article.url);
    // Ignore all model-proposed links/photos. The exact source URL/image from
    // our supplied catalogue anchors the same immutable photo lock as Home.
    const source = { id: clean(String(article.id), 180), url: article.url, title: clean(article.title, 280), source: clean(article.source, 100), category: clean(article.category, 70), image: clean(article.image, 1900), publishedAt: clean(article.publishedAt, 40) };
    return [{ id: 'ai-' + hash(article.url + title + summary), sourceId: source.id, title, summary, article: source }];
  });
  if (!cards.length) throw new Error('L’IA n’a pas fourni de résultats reliés aux articles transmis. Le résultat précédent est conservé.');
  return { provider: clean(payload.provider, 40), accountId: clean(payload.accountId, 100), prompt: clean(payload.prompt, 6000), model: clean(payload.model, 100), summary: clean(payload.summary, 10000), generatedAt: clean(payload.generatedAt, 40) || new Date().toISOString(), cards };
}
let openingAttempted = false;
export function maybeGenerateStartupBrief(articles) {
  if (openingAttempted || !briefAI.autoAtOpen || briefAI.busy || !nativeAIAvailable() || !aiProvider().integrated
    || !briefAI.account.connected || !briefAI.account.planEnabled || !briefAI.prompt.trim()
    || !Array.isArray(articles) || !articles.length || document.hidden || navigator.onLine === false) return;
  // Claim before notifying subscribers: account/news/render updates cannot duplicate it.
  openingAttempted = true;
  void generateAIBrief(articles);
}
export async function generateAIBrief(articles) {
  if (briefAI.busy) return;
  const provider = aiProvider();
  if (!provider.integrated) { briefAI.error = `L’accès automatique à Brief avec l’abonnement ${provider.name} n’est pas disponible dans cette application. Tu peux ouvrir ton compte sur son site officiel. Aucune API payante ne sera utilisée.`; notify(); return; }
  if (!briefAI.prompt.trim()) { briefAI.error = 'Écris ton prompt dans Réglages → IA.'; notify(); return; }
  if (!briefAI.account.planEnabled) { briefAI.error = 'Connecte un compte ChatGPT et autorise l’utilisation de ton abonnement dans Réglages → IA.'; notify(); return; }
  if (!Array.isArray(articles) || !articles.length) { briefAI.error = 'Les actualités ne sont pas encore disponibles. Le résultat précédent est conservé.'; notify(); return; }
  openingAttempted = true;
  briefAI.busy = 'generate'; briefAI.error = ''; notify();
  // One request per opening (when enabled) or explicit click; never an inference retry.
  const snapshot = articles.slice(0, 60).map(article => ({ id: String(article.id), url: article.url, title: clean(article.title, 280), source: clean(article.source, 100), category: clean(article.category, 70), summary: clean(article.summary, 1200), publishedAt: article.publishedAt, image: article.image || '' }));
  const requestSettings = { provider: briefAI.provider, accountId: briefAI.account.activeId, prompt: briefAI.prompt, model: briefAI.model };
  try {
    const response = await nativeRequest('generate', { prompt: requestSettings.prompt, model: requestSettings.model, articles: snapshot }, 180000);
    const result = normalizeAIResult({ ...response, ...requestSettings, model: response.model }, snapshot);
    // A response cannot leak into a different provider/prompt after navigation.
    if (briefAI.provider !== requestSettings.provider || briefAI.prompt !== requestSettings.prompt || briefAI.model !== requestSettings.model || briefAI.account.activeId !== requestSettings.accountId) return;
    briefAI.result = result;
    try { localStorage.setItem(RESULT_KEY, JSON.stringify(result)); } catch {}
  } catch (error) { briefAI.error = error.message; }
  finally { briefAI.busy = ''; notify(); }
}
