'use strict';

const MAX_EVENT_GAP_MS = 36 * 60 * 60 * 1000;
const STOP = new Set('avec dans pour plus apres avant cette cet ces sont etre leur leurs tout tous mais sans vers entre une des les sur qui que aux par son ses est fait font comme dont elle elles ils nous vous notre votre aussi encore deja tres moins depuis alors chez contre lors peut peuvent avait avoir sera un le la du de au en et ou ce se sa ne pas actualite direct video photos photo selon annonce nouvelle nouveau nouvelles nouveaux article sous'.split(' '));
const SOCIAL_SOURCE_RX = /^(?:facebook\.com|x\.com|twitter\.com|tiktok\.com|instagram\.com)$/i;
const MATERIAL_UPDATE_GAP_MS = 2 * 60 * 60 * 1000;
const DEVELOPMENT_RULES = [
  ['reaction', /\b(réagit|réaction|déclare|salue|condamne|réponse de|prise de position)\b/i],
  ['aid', /\b(aide humanitaire|débloque? .{0,35}\bfonds|fonds d['’]urgence|livraison d['’]aide)\b/i],
  ['investigation', /\b(enquête (?:ouverte|lancée)|mise en examen|perquisition|arrestation)\b/i],
  ['agreement', /\b(accord (?:signé|conclu|trouvé)|cessez[- ]le[- ]feu (?:signé|accepté)|adopte? un accord)\b/i],
  ['resignation', /\b(démissionne|démission annoncée|quitte (?:son poste|le gouvernement))\b/i],
  ['sanctions', /\b(nouvelles sanctions?|sanctions? (?:entrent|entrée) en vigueur|paquet de sanctions?)\b/i]
];

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTitle(value = '') {
  return clean(value).replace(/\s+[-–—|]\s+[^–—|]{2,45}$/i, '').trim();
}

function semanticText(value = '') {
  let text = normalize(cleanTitle(value));
  const replacements = [
    [/\bunion europeenne\b/g, ' ue '],
    [/\btourne(?:nt)? le dos\b/g, ' outcome '],
    [/\b(?:dit|disent|dites) non\b/g, ' outcome '],
    [/\bclaquent? la porte\b/g, ' outcome '],
    [/\b(?:coups? de feu|tirs? mortels?|fusillade)\b/g, ' shooting '],
    [/\b(?:naufrage|chavire\w*|coule au large)\b/g, ' shipwreck '],
    [/\b(?:ferry|bateau|navire|croisiere|chalutier)\b/g, ' vessel '],
    [/\b(?:crue|crues|inondation|inondations|coulee de boue)\b/g, ' flood ']
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

function canonicalToken(word = '') {
  if (/^islandais/.test(word)) return 'islande';
  if (word === 'non' || /^(?:rejet|refus|emport|impos)/.test(word)) return 'outcome';
  if (/^(?:referend|scrutin|vot)/.test(word)) return 'vote';
  if (/^(?:negoci|adhes|integr|reouvert)/.test(word)) return 'negotiation';
  if (/^(?:mort|victim|bless|disparu)/.test(word)) return 'casualty';
  if (/^(?:reag|reaction|declar|salu|condamn)/.test(word)) return 'reaction';
  return word;
}

function developmentMarkers(article = {}) {
  const title = cleanTitle(article.title || '');
  return DEVELOPMENT_RULES.filter(([, pattern]) => pattern.test(title)).map(([marker]) => marker);
}

function casualtyClaims(article = {}) {
  const claims = [];
  const pattern = /\b(\d{1,5})\s+(morts?|décès|victimes?|blessés?|disparus?)\b/gi;
  for (const match of cleanTitle(article.title || '').matchAll(pattern)) {
    const unit = canonicalToken(normalize(match[2]));
    claims.push(`${Number(match[1])}:${unit}`);
  }
  return [...new Set(claims)].sort();
}

function hasMaterialDevelopment(a = {}, b = {}) {
  const leftMarkers = developmentMarkers(a);
  const rightMarkers = developmentMarkers(b);
  if ((leftMarkers.length || rightMarkers.length) && !leftMarkers.some(marker => rightMarkers.includes(marker))) return true;

  const gap = Math.abs(publishedAt(a) - publishedAt(b));
  const leftClaims = casualtyClaims(a);
  const rightClaims = casualtyClaims(b);
  return gap >= MATERIAL_UPDATE_GAP_MS
    && leftClaims.length > 0
    && rightClaims.length > 0
    && leftClaims.join('|') !== rightClaims.join('|');
}

function eventTokens(article = {}) {
  const tokens = [];
  for (const raw of semanticText(article.title || '').split(' ')) {
    const word = canonicalToken(raw);
    if (!word || STOP.has(word) || (word.length < 4 && word !== 'ue')) continue;
    if (!tokens.includes(word)) tokens.push(word);
  }
  return tokens.slice(0, 24);
}

function tokenEquivalent(a = '', b = '') {
  if (a === b) return true;
  return a.length >= 6 && b.length >= 6 && a.slice(0, 5) === b.slice(0, 5);
}

function semanticOverlap(left = [], right = []) {
  const used = new Set();
  const matches = [];
  for (const token of left) {
    const index = right.findIndex((candidate, i) => !used.has(i) && tokenEquivalent(token, candidate));
    if (index < 0) continue;
    used.add(index);
    matches.push(token);
  }
  const common = matches.length;
  return {
    common,
    coverage: common / Math.max(1, Math.min(left.length, right.length)),
    jaccard: common / Math.max(1, left.length + right.length - common),
    matches
  };
}

function publishedAt(article = {}) {
  const value = Date.parse(article.publishedAt || article.date || '');
  return Number.isFinite(value) ? value : 0;
}

function sameNewsEvent(a = {}, b = {}) {
  const at = publishedAt(a);
  const bt = publishedAt(b);
  if (at && bt && Math.abs(at - bt) > MAX_EVENT_GAP_MS) return false;
  if (hasMaterialDevelopment(a, b)) return false;

  const left = eventTokens(a);
  const right = eventTokens(b);
  if (left.length < 3 || right.length < 3) return false;
  const overlap = semanticOverlap(left, right);
  if (overlap.common >= 5 && overlap.coverage >= 0.58 && overlap.jaccard >= 0.30) return true;
  if (overlap.common >= 4 && overlap.coverage >= 0.67 && overlap.jaccard >= 0.32) return true;

  const matched = new Set(overlap.matches);
  const eventMatches = [...matched].filter(token => ['outcome', 'vote', 'negotiation'].includes(token));
  const anchorMatches = [...matched].filter(token => !['outcome', 'vote', 'negotiation'].includes(token));
  if (overlap.common >= 3 && overlap.coverage >= 0.58 && eventMatches.includes('outcome') && anchorMatches.length >= 2) return true;
  if (overlap.common >= 3 && overlap.coverage >= 0.50 && matched.has('reaction') && anchorMatches.length >= 2) return true;
  if (matched.has('shipwreck') && matched.has('vessel') && overlap.common >= 4 && overlap.coverage >= 0.50) return true;
  if (matched.has('shooting') && overlap.common >= 3 && overlap.coverage >= 0.50) return true;
  if (matched.has('flood') && overlap.common >= 4 && overlap.coverage >= 0.55) return true;
  return false;
}

function representativeQuality(article = {}) {
  const title = cleanTitle(article.title || '');
  const source = clean(article.source || '');
  let score = Number(article.score || 0) * 0.10;
  if (title.length >= 45 && title.length <= 210) score += 4;
  if (/\b(?:\d{1,4}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|vingt|cent)\s+(?:morts?|victimes?|blessés?|disparus?)\b/i.test(title)) score += 8;
  if (/\b(?:référendum|naufrage|fusillade|crue|inondation|séisme|élection|accord|sanctions?)\b/i.test(title)) score += 5;
  if (SOCIAL_SOURCE_RX.test(source)) score -= 25;
  if (!title || /^[-–—\s]+/.test(title) || title.length < 24) score -= 20;
  return score;
}

function initialMergedCount(article = {}) {
  return Math.max(1, Number(article.mergedCount || 0), Array.isArray(article.sources) ? article.sources.filter(Boolean).length : 1);
}

function mergeFields(target, incoming) {
  const targetMergedCount = initialMergedCount(target);
  const incomingMergedCount = initialMergedCount(incoming);
  target.sources = [...new Set([...(Array.isArray(target.sources) ? target.sources : [target.source]), ...(Array.isArray(incoming.sources) ? incoming.sources : [incoming.source])].filter(Boolean))].slice(0, 8);
  target.mergedCount = targetMergedCount + incomingMergedCount;
  if ((incoming.summary || '').length > (target.summary || '').length) {
    target.summary = incoming.summary;
    target.detail = incoming.detail || incoming.summary;
  }
  if ((!target.image || target.visualStatus !== 'ready') && incoming.image && incoming.visualStatus === 'ready') {
    target.image = incoming.image;
    target.visualStatus = incoming.visualStatus;
    if (incoming.visual && typeof incoming.visual === 'object') target.visual = { ...incoming.visual };
    target.visualSource = incoming.visualSource;
    target.visualWidth = incoming.visualWidth;
    target.visualHeight = incoming.visualHeight;
    target.visualContentType = incoming.visualContentType;
  }
  target.score = Math.max(Number(target.score || 0), Number(incoming.score || 0));
  return target;
}

function mergeEventVariants(items = []) {
  const clusters = [];
  for (const item of items) {
    const index = clusters.findIndex(candidate => sameNewsEvent(candidate, item));
    if (index < 0) {
      clusters.push({ ...item, sources: [...new Set(Array.isArray(item.sources) ? item.sources : [item.source].filter(Boolean))], mergedCount: initialMergedCount(item) });
      continue;
    }
    const existing = clusters[index];
    const incomingWins = representativeQuality(item) > representativeQuality(existing);
    if (incomingWins) {
      const replacement = { ...item, sources: [...new Set(Array.isArray(item.sources) ? item.sources : [item.source].filter(Boolean))], mergedCount: initialMergedCount(item) };
      clusters[index] = mergeFields(replacement, existing);
    } else {
      mergeFields(existing, item);
    }
  }
  return clusters;
}

module.exports = { cleanTitle, eventTokens, semanticOverlap, developmentMarkers, casualtyClaims, hasMaterialDevelopment, sameNewsEvent, representativeQuality, mergeEventVariants };
