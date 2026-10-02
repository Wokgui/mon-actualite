// One owner for automatic Brief generation. Credentials never enter JS storage.
import { newestBriefCards } from './brief-presentation.js?v=98.50';
export const DEFAULT_AI_PROMPT = 'Fais une synthèse en français des nouveautés importantes des sept derniers jours concernant les innovations pratiques ou théoriques dans tous les domaines, les découvertes scientifiques, la réalité virtuelle et mixte, et les voitures. Privilégie les véritables nouveautés plutôt que les promotions ou les rumeurs. Explique ce qui est nouveau, à quoi cela pourrait servir et si c’est disponible, expérimental ou théorique. Commence par une synthèse courte, puis présente les sujets intéressants avec leurs sources. Regroupe les doublons et signale les incertitudes. N’invente aucune information.';
const CONFIG = 'news-brief-ai-settings-v1', RESULT = 'news-brief-ai-results-v1', ATTEMPT = 'news-brief-groq-attempt-v1';
export const INTERVAL_MS = 12 * 3600000, ERROR_BACKOFF_MS = 3600000;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const normalized = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const settings = read(CONFIG, {}), subscribers = new Set(), pending = new Map();
function restoreResult(value) {
  if (!value || typeof value.summary !== 'string' || !value.summary.trim() || !Array.isArray(value.cards)) return null;
  const source = article => {
    try { const url = new URL(article?.url); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && typeof article.title === 'string' ? article : null; } catch { return null; }
  };
  return { ...value, summary: clean(value.summary,16000), cards: value.cards.slice(0,8).filter(card => card && typeof card.title === 'string' && typeof card.summary === 'string' && source(card.article)), sources: (Array.isArray(value.sources) ? value.sources : []).filter(source).slice(0,24) };
}
const oldDefault = 'Résume les actualités importantes en français. Présente les faits, leurs conséquences et ce qui est nouveau. Regroupe les articles qui parlent du même événement et indique les sources. Ne complète pas les informations absentes des sources.';
export const briefAI = {
  provider: 'groq', prompt: typeof settings.prompt === 'string' && settings.prompt !== oldDefault ? settings.prompt.slice(0, 6000) : DEFAULT_AI_PROMPT,
  autoAtOpen: settings.mode === 'groq-auto' ? settings.autoAtOpen !== false : true,
  configured: false, credentialVersion: '', supported: false, initialized: false, busy: '', error: '', notice: '', result: restoreResult(read(RESULT, null))
};
let revision = 0, inFlight = null, startupAttempted = false, hooks = {}, initialized = null;
export function onAIChange(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }
function notify() { for (const callback of subscribers) callback(); }
export function setAISettings(values, { announce = true } = {}) {
  const prompt = typeof values.prompt === 'string' ? values.prompt.slice(0, 6000) : briefAI.prompt;
  const autoAtOpen = typeof values.autoAtOpen === 'boolean' ? values.autoAtOpen : briefAI.autoAtOpen;
  // Save before publishing; a full disk must not silently lose the user's prompt.
  try { localStorage.setItem(CONFIG, JSON.stringify({ provider: 'groq', mode: 'groq-auto', prompt, autoAtOpen })); }
  catch { briefAI.error = 'Impossible d’enregistrer le réglage sur cet appareil.'; if (announce) notify(); return false; }
  if (prompt !== briefAI.prompt || autoAtOpen !== briefAI.autoAtOpen) revision++;
  briefAI.prompt = prompt; briefAI.autoAtOpen = autoAtOpen;
  briefAI.error = ''; if (announce) notify(); return true;
}
export function briefTopics(prompt) {
  const text = normalized(prompt), topics = [];
  if (/innovat|decouvert|theori|scientif|recherche/.test(text)) topics.push('innovation OR découverte OR "recherche scientifique"');
  if (/\bvr\b|realite virtuelle|realite mixte|quest|casque/.test(text)) topics.push('"réalité virtuelle" OR "réalité mixte" OR casque VR');
  if (/voitur|automobil|vehicul|mobilite/.test(text)) topics.push('voiture OR automobile OR "nouveau véhicule"');
  if (/\bia\b|intelligence artificielle/.test(text)) topics.push('intelligence artificielle innovation');
  if (/energie|nucleaire|batterie/.test(text)) topics.push('énergie batterie recherche innovation');
  if (/sante|medecine|medical|biolog/.test(text)) topics.push('médecine santé recherche découverte');
  if (/espace|astronom/.test(text)) topics.push('espace astronomie découverte');
  // Preserve new subjects beyond the built-in themes; no fixed-only whitelist.
  const stop = new Set('fais faire donne resume synthese francais nouveautes importantes derniers dernier jours sept concernant domaines tous toutes articles sources liens avec dans pour une les des leur leurs qui que quoi soit cela ceci peux veux souhaite prefere commence presente explique signale groupe paragraphe court courte interessant interessants importants important informations actualite actualites semaine plutot nouvelles sujet sujets uniquement sans entre theoriques pratiques'.split(' '));
  const extra = [...new Set(text.match(/[a-z0-9]{4,}/g) || [])].filter(word => !stop.has(word)).slice(0, 10);
  if (extra.length) topics.push(extra.join(' '));
  return [...new Set(topics)].slice(0, 6).map(topic => topic.slice(0,59) + ' when:7d');
}
export function selectBriefArticles(articles, prompt, now = Date.now()) {
  const terms = [...new Set(normalized(prompt).match(/[a-z]{4,}/g) || [])], seen = new Set();
  const ranked = (Array.isArray(articles) ? articles : []).flatMap(article => {
    try {
      const url = new URL(article?.url), time = Date.parse(article.publishedAt || '');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)
        || !Number.isFinite(time) || time < now - 7 * 86400000 || time > now + 3600000 || !clean(article.title, 280)) return [];
      seen.add(url.href);
      const text = normalized([article.title, article.summary, article.category].join(' '));
      const score = terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
      return [{ ...article, url: url.href, score, time }];
    } catch { return []; }
  }).sort((a,b) => b.score - a.score || b.time - a.time);
  // Round-robin subjects: today's VR flood cannot hide science or cars.
  const buckets = new Map();
  for (const article of ranked) {
    const category = clean(article.category, 70) || 'Autres';
    if (!buckets.has(category)) buckets.set(category, []);
    buckets.get(category).push(article);
  }
  const selected = [];
  while (selected.length < 24 && [...buckets.values()].some(bucket => bucket.length)) {
    for (const bucket of buckets.values()) if (bucket.length && selected.length < 24) {
      const article = bucket.shift();
      selected.push({ id: String(article.id || article.url), url: article.url, title: clean(article.title, 220),
        summary: clean(article.summary, 300), source: clean(article.source, 80), category: clean(article.category, 70),
        image: clean(article.image, 1900), publishedAt: article.publishedAt });
    }
  }
  return selected;
}
export function normalizeAIResult(payload, articles) {
  if (!payload || typeof payload.summary !== 'string' || !Array.isArray(payload.cards) || !payload.summary.trim()) throw Error('Réponse IA inexploitable. La dernière synthèse est conservée.');
  const seen = new Set(), byId = new Map(articles.map((article,index) => ['A' + (index + 1), article]));
  const cards = payload.cards.slice(0, 8).flatMap(card => {
    const article = byId.get(card?.sourceId);
    if (!article || seen.has(article.url) || !clean(card.title, 240) || !clean(card.summary, 2500)) return [];
    seen.add(article.url);
    return [{ sourceId: article.id, title: clean(card.title, 240), summary: clean(card.summary, 2500), article }];
  });
  if (payload.cards.length && !cards.length) throw Error('Les sources du résultat ne correspondent pas aux articles fournis.');
  const summary = clean(payload.summary, 16000).replace(/\[([^\]\n]{1,240})\]\((A\d+)\)/g, (match, title, id) => byId.has(id) ? `[${title}](${byId.get(id).url})` : title);
  return { provider: 'groq', summary, cards: newestBriefCards(cards), sources: articles, generatedAt: new Date().toISOString() };
}
function bridge(action, fields = {}) {
  if (typeof window.MonActualiteGroq?.postMessage !== 'function') return Promise.reject(Error('Le Brief automatique sécurisé nécessite la version Android actuelle.'));
  const id = 'groq-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Groq ne répond pas dans le délai prévu. La dernière synthèse est conservée.')); }, 75000);
    pending.set(id, { resolve, reject, timer });
    window.MonActualiteGroq.onmessage = event => {
      try {
        const response = JSON.parse(event.data), entry = pending.get(response.id);
        if (!entry) return;
        clearTimeout(entry.timer); pending.delete(response.id);
        response.ok ? entry.resolve(response.data) : entry.reject(Error(response.error || 'Demande Groq impossible.'));
      } catch {}
    };
    try { window.MonActualiteGroq.postMessage(JSON.stringify({ id, action, ...fields })); }
    catch { clearTimeout(timer); pending.delete(id); reject(Error('Connexion Android indisponible.')); }
  });
}
export function initializeBrief(options) {
  hooks = options || hooks;
  if (initialized) return initialized;
  initialized = (async () => {
    briefAI.supported = typeof window.MonActualiteGroq?.postMessage === 'function';
    setAISettings({}, { announce: false });
    if (briefAI.supported) {
      try { Object.assign(briefAI, await bridge('status')); }
      catch (error) { briefAI.error = error.message; }
    }
    briefAI.initialized = true; notify();
    await maybeGenerateBrief();
  })();
  return initialized;
}
export async function saveGroqKey(key) {
  if (inFlight || briefAI.busy) { briefAI.error = 'Attends la fin de la demande avant de changer de clé.'; notify(); return false; }
  briefAI.busy = 'Enregistrement de la clé…'; notify();
  try {
    const status = await bridge('configure', { key });
    Object.assign(briefAI, status); revision++; startupAttempted = false;
    briefAI.error = ''; briefAI.notice = 'Clé enregistrée sur cet appareil. La première synthèse démarre automatiquement si l’option est activée.';
    return true;
  } catch (error) { briefAI.error = error.message; return false; }
  finally { briefAI.busy = ''; notify(); void maybeGenerateBrief(); }
}
export async function disconnectGroq() {
  try { Object.assign(briefAI, await bridge('disconnect')); revision++; briefAI.error = ''; briefAI.notice = 'Clé retirée. La dernière synthèse reste consultable.'; }
  catch (error) { briefAI.error = error.message; }
  notify();
}
function signature() { return JSON.stringify([briefAI.prompt.trim(), briefAI.credentialVersion]); }
export function maybeGenerateBrief() {
  if (!briefAI.initialized || !briefAI.configured || !briefAI.autoAtOpen || startupAttempted || document.hidden || !navigator.onLine) return Promise.resolve(null);
  const result = briefAI.result, age = Date.now() - Date.parse(result?.generatedAt || '');
  if (result?.provider === 'groq' && result.prompt === briefAI.prompt.trim() && result.credentialVersion === briefAI.credentialVersion && age >= 0 && age < INTERVAL_MS) return Promise.resolve(result);
  const attempt = read(ATTEMPT, {}), elapsed = Date.now() - Number(attempt.at);
  if (attempt.signature === signature() && elapsed >= 0 && elapsed < ERROR_BACKOFF_MS) return Promise.resolve(null);
  startupAttempted = true;
  return generateBrief();
}
export function generateBrief({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (!briefAI.configured || !briefAI.prompt.trim()) { briefAI.error = !briefAI.configured ? 'Enregistre ta clé Groq dans Réglages → IA.' : 'Indique un prompt.'; notify(); return Promise.resolve(null); }
  if (!navigator.onLine) { briefAI.error = 'Hors connexion. La dernière synthèse est conservée.'; notify(); return Promise.resolve(null); }
  const prompt = briefAI.prompt.trim(), expected = revision, keyVersion = briefAI.credentialVersion;
  briefAI.busy = 'Recherche des articles de la semaine…'; briefAI.error = ''; briefAI.notice = ''; notify();
  inFlight = Promise.resolve().then(async () => {
    try {
      localStorage.setItem(ATTEMPT, JSON.stringify({ signature: signature(), at: Date.now() }));
      let extra = [], discoveryFailed = false;
      try { extra = await hooks.discover?.(briefTopics(prompt)) || []; } catch { discoveryFailed = true; }
      if (expected !== revision) throw Error('Les réglages ont changé. Actualise pour utiliser le nouveau prompt.');
      const candidates = [...extra, ...(hooks.getArticles?.() || [])];
      const articles = selectBriefArticles(hooks.filter ? candidates.filter(hooks.filter) : candidates, prompt);
      if (!articles.length) throw Error('Aucun article récent exploitable. Actualise les nouvelles puis réessaie.');
      briefAI.busy = 'Rédaction de ta synthèse…'; notify();
      const wireArticles = articles.map((article,index) => ({ sourceId: 'A' + (index + 1), title: article.title, summary: article.summary, source: article.source, category: article.category, publishedAt: article.publishedAt }));
      while (wireArticles.length > 1 && new TextEncoder().encode(JSON.stringify({ prompt, articles: wireArticles })).length > 17500) { wireArticles.pop(); articles.pop(); }
      if (new TextEncoder().encode(JSON.stringify({ prompt, articles: wireArticles })).length > 17500) throw Error('Prompt trop volumineux. Raccourcis-le avant de réessayer.');
      const data = await bridge('generate', { prompt, articles: wireArticles, force });
      if (expected !== revision || !briefAI.configured || data.credentialVersion !== keyVersion) throw Error('Le prompt ou la connexion a changé. Le résultat précédent est conservé.');
      const result = { ...normalizeAIResult(data.result, articles), prompt, credentialVersion: keyVersion, model: data.model, partialSources: discoveryFailed };
      localStorage.setItem(RESULT, JSON.stringify(result));
      briefAI.result = result; briefAI.notice = discoveryFailed ? 'Synthèse actualisée avec les articles déjà disponibles : la recherche ciblée était indisponible.' : 'Synthèse actualisée.';
      return result;
    } catch (error) { briefAI.error = error.message; return null; }
    finally { briefAI.busy = ''; inFlight = null; notify(); }
  });
  return inFlight;
}
