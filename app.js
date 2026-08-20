import { importOpmlPreview } from "./services/source-connectors.js";

const $ = (selector, root = document) => root.querySelector(selector);
const app = $("#app");
const toastEl = $("#toast");

const categoryMeta = {
  IA: { icon: "sparkles", label: "IA" },
  Tech: { icon: "cpu", label: "Tech" },
  Smartphones: { icon: "smartphone", label: "Smartphones" },
  VR: { icon: "glasses", label: "VR" },
  Science: { icon: "flask", label: "Science" },
  Énergie: { icon: "sun", label: "Énergie" }
};

const articles = [
  {
    id: "agents-locaux", category: "IA", badge: "Important", time: "Il y a 18 min", bucket: "today",
    source: "MIT Technology Review", sources: ["MIT Tech Review", "Nature", "The Verge"], image: "assets/ia-tech.png", imageClass: "image-ai",
    title: "Les agents IA commencent à fonctionner directement sur nos appareils",
    summary: "De nouveaux modèles compacts exécutent des tâches complexes sans envoyer les données vers le cloud.",
    detail: "La nouvelle génération de modèles compacts peut planifier une suite d’actions, analyser des documents et exploiter des outils directement sur un téléphone ou un ordinateur. Le bénéfice immédiat est double : davantage de confidentialité et un fonctionnement possible hors connexion. Les premiers essais restent toutefois limités par la batterie et la mémoire disponible.",
    tags: ["IA locale", "Confidentialité", "Agents"], url: "https://www.technologyreview.com/"
  },
  {
    id: "batterie-silicium", category: "Smartphones", badge: "Nouveau produit", time: "Il y a 42 min", bucket: "today",
    source: "Frandroid", sources: ["Frandroid", "Android Authority"], image: "assets/smartphone-vr.png", imageClass: "image-device",
    title: "Les batteries silicium-carbone changent enfin l’autonomie des smartphones",
    summary: "Une capacité accrue dans le même volume ouvre la voie à deux jours réels d’utilisation.",
    detail: "Les cellules silicium-carbone arrivent sur davantage de modèles grand public. À encombrement comparable, elles stockent plus d’énergie que les batteries graphite traditionnelles. Les constructeurs promettent une autonomie sensiblement supérieure sans épaissir les appareils, avec une attention particulière portée à la maîtrise thermique et au vieillissement.",
    tags: ["Android", "Batterie", "Mobilité"], url: "https://www.frandroid.com/"
  },
  {
    id: "casque-vr", category: "VR", badge: "Mise à jour", time: "Il y a 1 h", bucket: "today",
    source: "UploadVR", sources: ["UploadVR", "Road to VR"], image: "assets/smartphone-vr.png", imageClass: "image-device",
    title: "Le suivi des mains en VR gagne nettement en précision",
    summary: "La nouvelle pile logicielle réduit les pertes de suivi et améliore les gestes fins sans manettes.",
    detail: "Une mise à jour du suivi des mains améliore la stabilité lors des croisements de doigts et dans les scènes peu éclairées. Les interactions sans contrôleur deviennent plus prévisibles, notamment pour les menus, la saisie et les applications créatives. Les jeux rapides restent plus confortables avec des manettes dédiées.",
    tags: ["VR", "Suivi des mains", "Accessibilité"], url: "https://www.uploadvr.com/"
  },
  {
    id: "solaire-perovskite", category: "Énergie", badge: "Innovation", time: "Il y a 2 h", bucket: "today",
    source: "IEEE Spectrum", sources: ["IEEE Spectrum", "Science"], image: "assets/science-energie.png", imageClass: "image-energy",
    title: "Une cellule solaire tandem franchit un cap de stabilité",
    summary: "Le nouveau procédé conserve son rendement après un test accéléré équivalent à plusieurs années.",
    detail: "Des chercheurs ont amélioré l’encapsulation d’une cellule tandem pérovskite-silicium. Le dispositif conserve une part élevée de ses performances après des cycles répétés de chaleur et d’humidité. Cette avancée vise le principal obstacle à l’industrialisation : maintenir le rendement dans des conditions réelles pendant de longues années.",
    tags: ["Solaire", "Recherche", "Décarbonation"], url: "https://spectrum.ieee.org/"
  },
  {
    id: "ordinateur-reparable", category: "Tech", badge: "Pratique", time: "Il y a 3 h", bucket: "today",
    source: "Ars Technica", sources: ["Ars Technica"], image: "assets/ia-tech.png", imageClass: "image-ai",
    title: "Les PC modulaires deviennent plus simples à réparer",
    summary: "Des composants standardisés permettent maintenant de remplacer ports et batterie en quelques minutes.",
    detail: "Les ordinateurs modulaires progressent sur deux points concrets : la disponibilité des pièces et la simplicité du démontage. Plusieurs composants peuvent désormais être remplacés sans colle ni outil spécialisé. Le coût initial reste supérieur, mais la durée de vie et la réparabilité compensent progressivement cet écart.",
    tags: ["Réparabilité", "PC", "Durabilité"], url: "https://arstechnica.com/"
  },
  {
    id: "ocean-profond", category: "Science", badge: "Découverte", time: "Il y a 5 h", bucket: "today",
    source: "New Scientist", sources: ["New Scientist", "CNRS"], image: "assets/science-energie.png", imageClass: "image-energy",
    title: "Un écosystème inattendu observé sous le plancher océanique",
    summary: "Des cavités volcaniques abritent une vie plus riche et plus durable que prévu.",
    detail: "Une mission océanographique a observé des organismes dans des cavités situées sous des sources hydrothermales. Ces niches étaient connues, mais leur diversité surprend les chercheurs. La découverte éclaire la manière dont la vie colonise les environnements extrêmes et pourrait se maintenir ailleurs dans le système solaire.",
    tags: ["Océans", "Biodiversité", "Exploration"], url: "https://www.newscientist.com/"
  },
  {
    id: "robot-domestique", category: "IA", badge: "Innovation", time: "Hier, 19:20", bucket: "yesterday",
    source: "Wired", sources: ["Wired", "TechCrunch"], image: "assets/ia-tech.png", imageClass: "image-ai",
    title: "Les robots domestiques apprennent avec beaucoup moins de démonstrations",
    summary: "Une méthode d’apprentissage transfère un geste connu vers de nouveaux objets et environnements.",
    detail: "Un nouveau système réduit le nombre de démonstrations nécessaires pour apprendre une tâche domestique. Le robot généralise un mouvement à des objets de formes différentes, mais les environnements encombrés restent difficiles. L’approche pourrait accélérer l’arrivée de robots réellement utiles à domicile.",
    tags: ["Robotique", "Apprentissage", "Maison"], url: "https://www.wired.com/"
  },
  {
    id: "android-satellite", category: "Smartphones", badge: "Mise à jour", time: "Hier, 14:10", bucket: "yesterday",
    source: "Android Authority", sources: ["Android Authority", "9to5Google"], image: "assets/smartphone-vr.png", imageClass: "image-device",
    title: "La messagerie satellite s’intègre directement à Android",
    summary: "L’interface guide l’utilisateur pour trouver le satellite sans application séparée.",
    detail: "Android prépare une expérience unifiée pour la messagerie satellite. Un guide visuel aide à orienter le téléphone, puis l’application de messages reprend automatiquement l’envoi. Le service vise d’abord les zones sans couverture mobile et ne remplace pas une connexion classique.",
    tags: ["Android", "Satellite", "Sécurité"], url: "https://www.androidauthority.com/"
  },
  {
    id: "lunettes-affichage", category: "VR", badge: "Nouveau produit", time: "Il y a 3 jours", bucket: "week",
    source: "Road to VR", sources: ["Road to VR"], image: "assets/smartphone-vr.png", imageClass: "image-device",
    title: "Des lunettes plus légères misent sur un affichage minimal",
    summary: "Notifications et navigation apparaissent dans le champ de vision sans isoler l’utilisateur.",
    detail: "Cette nouvelle catégorie de lunettes connectées privilégie un affichage simple, lisible et peu énergivore. L’objectif n’est pas de remplacer un casque VR mais d’afficher des informations utiles sans occuper tout le champ de vision. Le poids et l’autonomie progressent, mais l’offre logicielle reste limitée.",
    tags: ["Lunettes", "Réalité augmentée", "Mobilité"], url: "https://www.roadtovr.com/"
  },
  {
    id: "quantique-erreurs", category: "Science", badge: "Important", time: "Il y a 5 jours", bucket: "week",
    source: "Nature", sources: ["Nature", "Quanta Magazine"], image: "assets/science-energie.png", imageClass: "image-energy",
    title: "La correction d’erreurs quantiques passe un test décisif",
    summary: "Augmenter le nombre de qubits physiques réduit enfin les erreurs du qubit logique.",
    detail: "Une expérience montre qu’un qubit logique devient plus fiable à mesure que le code de correction grandit. Ce comportement attendu est indispensable pour construire des machines utiles, mais il ne signifie pas qu’un ordinateur quantique généraliste est imminent. Les besoins matériels restent considérables.",
    tags: ["Quantique", "Calcul", "Recherche"], url: "https://www.nature.com/"
  },
  {
    id: "stockage-chaleur", category: "Énergie", badge: "Pratique", time: "Il y a 12 jours", bucket: "month",
    source: "Canary Media", sources: ["Canary Media", "IEA"], image: "assets/science-energie.png", imageClass: "image-energy",
    title: "Le stockage de chaleur séduit les sites industriels",
    summary: "Des briques chauffées par l’électricité renouvelable remplacent progressivement une partie du gaz.",
    detail: "Des installations stockent l’électricité excédentaire sous forme de chaleur dans des matériaux réfractaires. La chaleur est ensuite utilisée par les procédés industriels lorsque la demande augmente. La solution est moins adaptée au réseau électrique, mais pertinente pour décarboner la vapeur industrielle.",
    tags: ["Industrie", "Stockage", "Renouvelable"], url: "https://www.canarymedia.com/"
  },
  {
    id: "wifi-maison", category: "Tech", badge: "Pratique", time: "Il y a 24 jours", bucket: "month",
    source: "Numerama", sources: ["Numerama"], image: "assets/ia-tech.png", imageClass: "image-ai",
    title: "Le Wi-Fi maillé devient plus simple à diagnostiquer",
    summary: "Les nouveaux outils expliquent clairement pourquoi une pièce perd du débit et proposent un meilleur placement.",
    detail: "Les systèmes Wi-Fi maillés commencent à afficher des diagnostics compréhensibles : obstacle détecté, liaison trop faible ou canal saturé. Les recommandations de placement deviennent plus utiles, ce qui évite de multiplier inutilement les bornes.",
    tags: ["Wi-Fi", "Maison", "Réseau"], url: "https://www.numerama.com/tech/"
  }
];

const briefs = {
  IA: "Les modèles deviennent plus petits et plus autonomes. La nouveauté utile n’est pas un nouveau chatbot, mais leur capacité à agir localement avec moins de données envoyées au cloud.",
  Tech: "La tendance réellement pratique concerne la durée de vie : appareils modulaires, diagnostics plus lisibles et composants enfin remplaçables.",
  Smartphones: "L’autonomie progresse grâce aux nouvelles cellules, tandis que les fonctions satellite commencent à devenir transparentes pour l’utilisateur.",
  VR: "Le matériel se fait plus discret. Le suivi des mains progresse maintenant plus vite que la puissance brute, ce qui améliore l’usage quotidien.",
  Science: "Deux avancées solides cette semaine : une observation nouvelle des écosystèmes profonds et un progrès mesurable de la correction d’erreurs quantiques.",
  Énergie: "Le solaire tandem gagne en durabilité et le stockage thermique trouve des usages industriels concrets. Deux progrès moins spectaculaires mais plus proches du terrain."
};

const defaultSettings = { notifications: true, webSearch: true, sourcePriority: true, summaryLength: "court", importance: "équilibrée", interests: Object.keys(categoryMeta) };
const savedSettings = JSON.parse(localStorage.getItem("news-settings") || "null");
const state = {
  view: "home", previous: [], category: "IA", categoryTab: "brief", articleId: null,
  saved: new Set(JSON.parse(localStorage.getItem("news-saved") || "[]")),
  feedback: JSON.parse(localStorage.getItem("news-feedback") || "{}"),
  newsPeriod: "today", customFrom: "2026-08-01", customTo: "2026-08-20",
  sheet: false, savedOnly: false, opmlName: "Aucun fichier importé",
  settings: { ...defaultSettings, ...(savedSettings || {}) }
};

let deferredInstallPrompt = null;
let isInstalled = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

const iconPaths = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  brief: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<path d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z"/><path d="M8 2v4M16 2v4M3 9h18"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.57 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.57 1.7 1.7 0 0 0 10 3V3h4v.08a1.7 1.7 0 0 0 1.06 1.52 1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v7H4V6h7"/>',
  sparkles: '<path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 14l.7 1.8L8 16.5l-2.3.7L5 19l-.7-1.8-2.3-.7 2.3-.7z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4M10 10h4v4h-4z"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/>',
  glasses: '<path d="M3 8h18l-1 9a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-3h0v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M9 14h6M5 8l2-4M19 8l-2-4"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 15v5h14v-5"/>',
  install: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 18v3h14v-3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  inbox: '<path d="M4 4h16v16H4z"/><path d="M4 14h5l2 3h2l2-3h5"/>'
};

function icon(name, filled = false) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] || iconPaths.sparkles}</svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function nav(active = state.view) {
  const items = [
    ["home", "home", "Accueil"], ["brief", "brief", "Brief"], ["sheet", "plus", "Ajouter"], ["news", "calendar", "Actualité"], ["settings", "settings", "Réglages"]
  ];
  return `<nav class="bottom-nav" aria-label="Navigation principale">${items.map(([view, ic, label]) =>
    `<button class="nav-item ${view === "sheet" ? "plus" : ""} ${active === view ? "active" : ""}" data-view="${view}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`
  ).join("")}</nav>`;
}

function articleCard(article) {
  const saved = state.saved.has(article.id);
  return `<article class="article-card" data-article="${article.id}" tabindex="0" aria-label="Lire : ${escapeHtml(article.title)}">
    <img class="article-image ${article.imageClass}" src="${article.image}" alt="" />
    <div class="article-body">
      <button class="save-btn ${saved ? "saved" : ""}" data-save="${article.id}" aria-label="${saved ? "Retirer des sauvegardes" : "Sauvegarder l’article"}">${icon("bookmark", saved)}</button>
      <div class="card-top"><span class="badge ${article.badge === "Important" ? "important" : ""}">${article.badge}</span></div>
      <h2>${article.title}</h2>
      <p class="summary">${article.summary}</p>
      <div class="meta"><span class="source">${article.source}</span><i class="dot"></i><span>${article.time}</span><i class="dot"></i><button class="category-link" data-category="${article.category}">${article.category}</button></div>
    </div>
  </article>`;
}

function topbar(title, back = true, right = "") {
  return `<header class="topbar">${back ? `<button class="icon-btn" data-back aria-label="Retour">${icon("back")}</button>` : "<span></span>"}<h1>${title}</h1>${right || "<span></span>"}</header>`;
}

function renderHome() {
  const feed = state.savedOnly ? articles.filter(a => state.saved.has(a.id)) : articles.filter(a => ["today", "yesterday"].includes(a.bucket)).slice(0, 8);
  return `<main class="page">
    <header class="hero-header"><div class="hero-mark"></div><span class="eyebrow">Jeudi 20 août</span><h1>Mon actualité</h1><p>L’essentiel choisi et synthétisé pour vous</p></header>
    ${state.saved.size ? `<div class="saved-filter"><button class="text-btn" data-saved-filter>${state.savedOnly ? "Voir toute l’actualité" : `Articles sauvegardés`}</button></div>` : ""}
    <section class="feed">${feed.length ? feed.map(articleCard).join("") : emptyState("Aucun article sauvegardé", "Sauvegardez une fiche avec le marque-page pour la retrouver ici.")}</section>
  </main>${nav("home")}`;
}

function renderCategory() {
  const meta = categoryMeta[state.category];
  const list = articles.filter(a => a.category === state.category);
  const content = state.categoryTab === "brief"
    ? `<section class="brief-card"><span class="brief-label">Ce qu’il faut retenir</span><h2>Le point sur ${state.category}</h2><p>${briefs[state.category]}</p><div class="source-list">${[...new Set(list.flatMap(a => a.sources))].slice(0, 4).map(s => `<span class="source-chip">${s}</span>`).join("")}</div></section>${list.slice(0, 2).map(articleCard).join("")}`
    : `<section class="feed">${list.map(articleCard).join("")}</section>`;
  return `<main class="page">${topbar("Catégorie")}
    <section class="title-row"><div class="category-icon">${icon(meta.icon)}</div><h1>${meta.label}</h1></section>
    <div class="tabs" role="tablist"><button class="tab ${state.categoryTab === "brief" ? "active" : ""}" data-tab="brief">Brief</button><button class="tab ${state.categoryTab === "all" ? "active" : ""}" data-tab="all">Tous les articles</button></div>
    <div class="feed">${content}</div>
  </main>${nav("")}`;
}

function renderDetail() {
  const article = articles.find(a => a.id === state.articleId) || articles[0];
  const saved = state.saved.has(article.id);
  const currentFeedback = state.feedback[article.id];
  return `<main class="page detail-page">${topbar("Article", true, `<button class="icon-btn save-btn-detail ${saved ? "saved" : ""}" data-save="${article.id}" aria-label="Sauvegarder">${icon("bookmark", saved)}</button>`)}
    <img class="detail-hero ${article.imageClass}" src="${article.image}" alt="Illustration : ${escapeHtml(article.title)}" />
    <article class="detail-content"><span class="badge ${article.badge === "Important" ? "important" : ""}">${article.badge}</span><h1>${article.title}</h1>
      <div class="detail-meta">${article.source} · ${article.time} · <button class="category-link" data-category="${article.category}">${article.category}</button></div>
      <section class="ai-summary"><strong>${icon("sparkles")} Synthèse IA</strong><p>${article.detail}</p></section>
      <div class="tags">${article.tags.map(t => `<span class="tag">${t}</span>`).join("")}</div>
      <a class="primary-btn" href="${article.url}" target="_blank" rel="noopener">Lire l’article original ${icon("external")}</a>
      <p class="feedback-title">Aidez l’IA à mieux choisir pour vous</p>
      <div class="feedback-grid">
        ${[["more", "Plus comme ça"], ["less", "Moins comme ça"], ["not", "Pas intéressé"], ["follow", "Sujet à suivre"]].map(([key, label]) => `<button class="${currentFeedback === key ? "selected" : ""}" data-feedback="${key}" data-id="${article.id}">${label}</button>`).join("")}
      </div>
    </article>
  </main>${nav("")}`;
}

function renderBrief() {
  const picks = [articles[0], articles[1], articles[3], articles[2]];
  return `<main class="page">${topbar("Brief du jour", false)}
    <section class="date-card"><span class="date">Jeudi 20 août · 08:45</span><h2>L’essentiel en 2 minutes</h2></section>
    <ol class="brief-points">${picks.map((a, i) => `<li class="brief-point" data-article="${a.id}" data-index="${i + 1}"><strong>${a.title}</strong><span>${a.summary}</span></li>`).join("")}</ol>
    <section class="brief-card"><span class="brief-label">Lecture globale</span><h2>Ce qui se dessine aujourd’hui</h2><p>L’actualité utile converge vers des technologies plus autonomes : IA locale, meilleure autonomie mobile et solutions énergétiques plus durables. Le suivi VR progresse aussi, sans annonce suffisamment majeure pour dominer le brief.</p><div class="source-list"><span class="source-chip">8 sources analysées</span><span class="source-chip">Doublons fusionnés</span></div></section>
  </main>${nav("brief")}`;
}

function periodArticles() {
  if (state.newsPeriod === "today") return articles.filter(a => a.bucket === "today");
  if (state.newsPeriod === "yesterday") return articles.filter(a => a.bucket === "yesterday");
  if (state.newsPeriod === "week") return articles.filter(a => ["today", "yesterday", "week"].includes(a.bucket));
  return articles;
}

function renderNews() {
  const periods = [["today", "Aujourd’hui"], ["yesterday", "Hier"], ["week", "7 derniers jours"], ["month", "30 derniers jours"], ["custom", "Personnalisée"]];
  const list = periodArticles();
  return `<main class="page">${topbar("Actualité", false)}
    <div class="periods">${periods.map(([key, label]) => `<button class="period ${state.newsPeriod === key ? "active" : ""}" data-period="${key}">${label}</button>`).join("")}</div>
    ${state.newsPeriod === "custom" ? `<div class="custom-dates"><label>Du<input type="date" data-date="from" value="${state.customFrom}"></label><label>Au<input type="date" data-date="to" value="${state.customTo}"></label></div>` : ""}
    <section class="feed">${list.length ? list.map(articleCard).join("") : emptyState("Rien d’important", "Aucune information suffisamment pertinente sur cette période.")}</section>
  </main>${nav("news")}`;
}

function settingRow(title, description, key) {
  return `<div class="setting-row"><div class="setting-label"><strong>${title}</strong><span>${description}</span></div><button class="switch ${state.settings[key] ? "on" : ""}" data-setting-toggle="${key}" role="switch" aria-checked="${state.settings[key]}"></button></div>`;
}

function renderSettings() {
  return `<main class="page">${topbar("Réglages", false)}
    <section class="settings-section install-section"><div class="install-app-icon"><img src="assets/app-icon.svg" alt="" /></div><div class="install-copy"><h2>${isInstalled ? "Application installée" : "Installer l’application"}</h2><p>${isInstalled ? "Mon actualité fonctionne comme une application autonome sur cet appareil." : "Ajoutez Mon actualité à Android pour l’ouvrir sans la barre de Chrome et l’utiliser hors ligne."}</p></div><button class="${isInstalled ? "secondary-btn" : "primary-btn"}" data-install ${isInstalled ? "disabled" : ""}>${isInstalled ? `${icon("check")} Déjà installée` : `${icon("install")} Installer sur cet appareil`}</button></section>
    <section class="settings-section"><h2>Sources Feedly / OPML</h2><p>Vos sources restent prioritaires. La recherche web ne complète que les sujets importants manquants.</p>
      <div class="import-status">${icon("upload")}<span>${escapeHtml(state.opmlName)}</span></div>
      <label class="secondary-btn" for="opml-input">Choisir un fichier OPML</label><input id="opml-input" class="file-input" type="file" accept=".opml,.xml">
      ${settingRow("Priorité aux sources", "Feedly avant la recherche web", "sourcePriority")}${settingRow("Recherche web complémentaire", "Uniquement si une information majeure manque", "webSearch")}
    </section>
    <section class="settings-section"><h2>Centres d’intérêt</h2><p>Appuyez sur un thème pour l’inclure ou l’exclure de la sélection.</p><div class="interest-grid">${Object.keys(categoryMeta).map(c => `<button class="interest ${state.settings.interests.includes(c) ? "active" : ""}" data-interest="${c}">${c}</button>`).join("")}</div></section>
    <section class="settings-section"><h2>Sélection et résumés</h2><div class="setting-row"><div class="setting-label"><strong>Longueur des résumés</strong><span>Format affiché dans les cartes</span></div><select class="select" data-setting-select="summaryLength"><option value="très court" ${state.settings.summaryLength === "très court" ? "selected" : ""}>Très court</option><option value="court" ${state.settings.summaryLength === "court" ? "selected" : ""}>Court</option><option value="détaillé" ${state.settings.summaryLength === "détaillé" ? "selected" : ""}>Détaillé</option></select></div>
      <div class="range-wrap"><div class="setting-label"><strong>Filtrage IA</strong><span>Moins de bruit, uniquement les nouveautés utiles</span></div><input type="range" min="1" max="3" value="3" aria-label="Niveau de filtrage"><div class="range-labels"><span>Ouvert</span><span>Très sélectif</span></div></div>
    </section>
    <section class="settings-section"><h2>Notifications</h2>${settingRow("Brief du matin", "Une notification seulement si le brief vaut le détour", "notifications")}</section>
    <button class="secondary-btn" data-reset>Réinitialiser les préférences</button>
  </main>${nav("settings")}`;
}

function emptyState(title, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon("inbox")}</div><h2>${title}</h2><p>${text}</p></div>`;
}

function renderSheet() {
  if (!state.sheet) return "";
  return `<div class="sheet-backdrop" data-close-sheet><section class="sheet" role="dialog" aria-modal="true" aria-label="Explorer les catégories" data-sheet-panel><div class="sheet-handle"></div><h2>Explorer un sujet</h2><p>Accédez au brief synthétique ou à tous les articles.</p><div class="category-grid">${Object.entries(categoryMeta).map(([key, meta]) => `<button class="category-choice" data-category="${key}">${icon(meta.icon)}<span>${meta.label}</span></button>`).join("")}</div></section></div>`;
}

function render() {
  const views = { home: renderHome, category: renderCategory, detail: renderDetail, brief: renderBrief, news: renderNews, settings: renderSettings };
  app.innerHTML = (views[state.view] || renderHome)() + renderSheet();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function navigate(view, additions = {}) {
  if (view !== state.view) state.previous.push({ view: state.view, category: state.category, articleId: state.articleId, categoryTab: state.categoryTab });
  Object.assign(state, { view, ...additions });
  render();
}

function goBack() {
  const prior = state.previous.pop();
  if (prior) Object.assign(state, prior); else state.view = "home";
  render();
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("show");
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function persist() {
  localStorage.setItem("news-saved", JSON.stringify([...state.saved]));
  localStorage.setItem("news-feedback", JSON.stringify(state.feedback));
  localStorage.setItem("news-settings", JSON.stringify(state.settings));
}

app.addEventListener("click", async event => {
  const save = event.target.closest("[data-save]");
  if (save) {
    event.preventDefault(); event.stopPropagation();
    const id = save.dataset.save;
    if (state.saved.has(id)) { state.saved.delete(id); toast("Article retiré des sauvegardes"); }
    else { state.saved.add(id); toast("Article sauvegardé"); }
    persist(); render(); return;
  }
  const category = event.target.closest("[data-category]");
  if (category) { event.preventDefault(); event.stopPropagation(); state.sheet = false; navigate("category", { category: category.dataset.category, categoryTab: "brief" }); return; }
  const article = event.target.closest("[data-article]");
  if (article) { navigate("detail", { articleId: article.dataset.article }); return; }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    const view = viewButton.dataset.view;
    if (view === "sheet") { state.sheet = true; render(); }
    else navigate(view, { savedOnly: false });
    return;
  }
  if (event.target.closest("[data-back]")) { goBack(); return; }
  const tab = event.target.closest("[data-tab]");
  if (tab) { state.categoryTab = tab.dataset.tab; render(); return; }
  const period = event.target.closest("[data-period]");
  if (period) { state.newsPeriod = period.dataset.period; render(); return; }
  const feedback = event.target.closest("[data-feedback]");
  if (feedback) {
    state.feedback[feedback.dataset.id] = feedback.dataset.feedback; persist();
    const messages = { more: "L’IA proposera davantage de sujets similaires", less: "L’IA réduira ce type de sujet", not: "Ce sujet sera écarté", follow: "Sujet ajouté à votre suivi" };
    toast(messages[feedback.dataset.feedback]); render(); return;
  }
  const toggle = event.target.closest("[data-setting-toggle]");
  if (toggle) { const key = toggle.dataset.settingToggle; state.settings[key] = !state.settings[key]; persist(); render(); toast("Réglage enregistré"); return; }
  const interest = event.target.closest("[data-interest]");
  if (interest) {
    const name = interest.dataset.interest; const current = new Set(state.settings.interests);
    current.has(name) ? current.delete(name) : current.add(name); state.settings.interests = [...current]; persist(); render(); return;
  }
  if (event.target.closest("[data-saved-filter]")) { state.savedOnly = !state.savedOnly; render(); return; }
  if (event.target.closest("[data-reset]")) { state.settings = { ...defaultSettings, interests: [...defaultSettings.interests] }; persist(); render(); toast("Préférences réinitialisées"); return; }
  if (event.target.closest("[data-install]")) {
    if (isInstalled) { toast("L’application est déjà installée"); return; }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      toast(choice.outcome === "accepted" ? "Installation lancée" : "Installation annulée");
    } else {
      toast("Dans Chrome : menu ⋮ puis Installer l’application");
    }
    return;
  }
  if (event.target.closest("[data-close-sheet]") && !event.target.closest("[data-sheet-panel]")) { state.sheet = false; render(); }
});

app.addEventListener("change", async event => {
  if (event.target.matches("[data-date]")) {
    state[event.target.dataset.date === "from" ? "customFrom" : "customTo"] = event.target.value;
    toast("Période personnalisée mise à jour");
  }
  if (event.target.matches("[data-setting-select]")) {
    state.settings[event.target.dataset.settingSelect] = event.target.value; persist(); toast("Réglage enregistré");
  }
  if (event.target.id === "opml-input" && event.target.files[0]) {
    const file = event.target.files[0];
    try {
      const preview = await importOpmlPreview(file);
      state.opmlName = `${file.name} · ${preview.feeds.length} source${preview.feeds.length > 1 ? "s" : ""} repérée${preview.feeds.length > 1 ? "s" : ""}`;
      render(); toast("Fichier OPML analysé localement");
    } catch {
      state.opmlName = `${file.name} · format non reconnu`;
      render(); toast("Impossible de lire ce fichier OPML");
    }
  }
});

app.addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-article]")) event.target.click();
  if (event.key === "Escape" && state.sheet) { state.sheet = false; render(); }
});

let serviceWorkerRefreshing = false;
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (serviceWorkerRefreshing) return;
    serviceWorkerRefreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(registration => registration.update()).catch(() => {});
}
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (state.view === "settings") render();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  isInstalled = true;
  render();
  toast("Mon actualité est installée");
});
render();
