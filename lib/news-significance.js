'use strict';

const CONSUMER_RX = /\b(comparatif|guide d['’]achat|bon plan|promo(?:tion)?|soldes?|code promo|meilleur(?:e|s)?|test(?:é|er)?|prise en main|avis|astuce|comment faire|sans débourser|gratuitement|abonnement|combien de jours|point vert|premier téléphone)\b/i;
const LISTICLE_RX = /\b(?:ces|les)\s+\d+\s+(?:aliments|astuces|conseils|raisons|signes|erreurs|choses|gestes)\b/i;
const REACTION_RX = /\b(réagit|réaction|se confie|confidences?|donne son avis|tacle|coup de gueule|s['’]indigne|buzz|polémique|réseaux sociaux|les internautes|se défend après|blague)\b/i;
const SPORTS_RX = /\b(ligue 1|ligue des champions|champions league|tour d['’]espagne|tour de france|pogacar|marquez|motogp|grand prix|formule 1|mercato|utmb|ultra[- ]trail|match|score final|entraîneur|but(?:s)?|vuelta|tennis|us open|roland[- ]garros|djokovic|alcaraz|sinner|eurosport)\b/i;
const CELEBRITY_RX = /\b(tapis rouge|tapis bleu|cheveux longs|barbe imposante|concerts? de|festival.*récompensé|star révèle|people)\b/i;
const HUMAN_TOLL_RX = /\b(?:au moins\s+)?(?:\d{1,5}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent|plusieurs)\s+(?:morts?|décès|victimes?|blessés?|disparus?)\b/i;
const MAJOR_EVENT_RX = /\b(inondations?|crues?|séisme|tremblement de terre|ouragan|cyclone|naufrage|chavir(?:e|é|ent|ement)|ferry|catastrophe|(?<!de )guerre(?!\s+(?:économique|commerciale|tarifaire|technologique|des? prix)\b)|invasion|frappes?|attaques? de drones?|cessez[- ]le[- ]feu|attentat|fusillade|coups? de feu|tirs? mortels?|référendum|élections?|scrutin|état d['’]urgence|pénurie grave|piratage massif)\b/i;
const MISSILE_ATTACK_RX = /\b(?:(?:frappes?|attaques?|tirs?|salves?|lancements?)\s+(?:de |des |d['’])?missiles?|missiles?\s+(?:tirés?|lancés?|frappent?|s['’]abattent?|touchent?))\b/i;
const SYSTEMIC_SANCTIONS_RX = /\b(paquet de sanctions?|sanctions? (?:économiques?|internationales?|européennes?|américaines?|onusiennes?)|sanctions? (?:contre|visant) (?:la |le |les |l['’])|sanctions? de l['’](?:ue|union européenne))\b/i;
const MARKET_REACTION_RX = /\b(cac\s*40|bourse|marchés? financiers?|marchés?|indices? boursiers?|wall street|euro stoxx|stoxx 600|dax)\b/i;
const PUBLIC_POLICY_NOUN_RX = /\b(loi|réforme|taxe|impôt|réglementation|décret|arrêté)\b/i;
const PUBLIC_INSTITUTION_RX = /\b(gouvernement|parlement|cour suprême|conseil constitutionnel|commission européenne|union européenne|ue|banque centrale|bce|fed|état)\b/i;
const PUBLIC_ACTION_RX = /\b(adopte|rejette|interdit|autorise|valide|annule|approuve|décide|impose|soumet|soumis|renforce|renforcées?|maintient|prolonge|supprime|réduit|augmente|suspend(?:re|u|ue|us|ues)?|officialise|entre en vigueur)\b/i;
const PUBLIC_EFFECT_RX = /\b(entre en vigueur|dès le 1er septembre|à partir du 1er septembre|règles? changent?|devient obligatoire|règles? renforcées?|ne seront pas suspendues?)\b/i;
const PUBLIC_POLICY_CONTEXT_RX = /\b(aides?|retraites?|pensions?|chômage|indemnisation|allocations?|rsa|prime|taxe|impôt|facturation électronique|arrêts? maladie|dsa|budget|subventions?|salaires? des enseignants?)\b/i;
const PUBLIC_SPECIFIC_DECISION_RX = /\b(déblocage de .*fonds|accord pétrolier)\b/i;
const PUBLIC_UTILITY_RX = /\b(alerte météo|vigilance (?:rouge|orange)|rappel de produits?|rappel massif|fermeture (?:des? )?(?:écoles?|routes?|gares?|aéroports?)|interruption (?:du |de la |des )?(?:trafic|réseau|service)|interdiction (?:des?|de la|du)|numéro d['’]urgence|consignes? de sécurité)\b/i;
const SCIENCE_RX = /\b(découverte|découvre|démontr|première mondiale|essai clinique|traitement|vaccin|mission spatiale|lancement spatial|télescope|nasa|esa|chiffrement quantique|chercheurs?)\b/i;
const CYBER_RX = /\b(pirat(?:age|é|er)|hackers?|cybercriminels?|fuite de données|vol de .*données|millions? de données|serveurs? compromis)\b/i;
const MALFORMED_RX = /^\s*[-–—|:]+\s*(?:$|[^\p{L}\p{N}]{0,4})/u;

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numericClaims(value = '') {
  return clean(value).match(/\b\d+(?:[.,]\d+)?(?:\s?(?:%|€|\$|euros?|dollars?|km|milliards?|millions?|ans?|mois|jours?|heures?|morts?|blessés?|disparus?|personnes?))?\b/gi) || [];
}

function publicDecisionSignal(value = '') {
  const text = clean(value);
  if (!text) return false;
  if (PUBLIC_POLICY_NOUN_RX.test(text) || PUBLIC_SPECIFIC_DECISION_RX.test(text)) return true;
  if (PUBLIC_INSTITUTION_RX.test(text) && PUBLIC_ACTION_RX.test(text)) return true;
  return PUBLIC_EFFECT_RX.test(text) && PUBLIC_POLICY_CONTEXT_RX.test(text);
}

function homeSignalScore(article = {}) {
  const title = clean(article.title || '');
  const text = title;
  let score = 0;
  const reasons = [];

  if (!title || title.length < 18 || MALFORMED_RX.test(title)) {
    score -= 34;
    reasons.push('titre pauvre');
  }

  const human = HUMAN_TOLL_RX.test(text);
  const sports = SPORTS_RX.test(text);
  const seismicMetaphor = sports && /\bséisme\b/i.test(text) && !human;
  const marketReaction = MARKET_REACTION_RX.test(text) && !human;
  const major = (MAJOR_EVENT_RX.test(text) || MISSILE_ATTACK_RX.test(text) || SYSTEMIC_SANCTIONS_RX.test(text)) && !seismicMetaphor && !marketReaction;
  const publicDecision = publicDecisionSignal(text);
  const publicUtility = PUBLIC_UTILITY_RX.test(text) && !CONSUMER_RX.test(text) && !LISTICLE_RX.test(text);
  const cyber = CYBER_RX.test(text);

  if (human) { score += 24; reasons.push('bilan humain'); }
  if (major) { score += 15; reasons.push('événement majeur'); }
  if (publicDecision) { score += 10; reasons.push('décision publique'); }
  if (publicUtility) { score += 6; reasons.push('utilité publique'); }
  if (cyber) { score += 11; reasons.push('cybersécurité'); }
  if (SCIENCE_RX.test(text)) { score += 7; reasons.push('science'); }

  const numbers = numericClaims(title);
  if (score > 0 && numbers.length >= 2) { score += 5; reasons.push('faits chiffrés'); }
  else if (score > 0 && numbers.length === 1) score += 2;

  const protectedFact = human || major || publicDecision || publicUtility || cyber;
  if (!protectedFact && (CONSUMER_RX.test(title) || LISTICLE_RX.test(title))) {
    score -= 16;
    reasons.push('contenu pratique/achat');
  }
  if (!protectedFact && REACTION_RX.test(title)) {
    score -= 13;
    reasons.push('réaction');
  }
  if (!protectedFact && sports) {
    score -= 16;
    reasons.push('sport léger');
  }
  if (!protectedFact && CELEBRITY_RX.test(title)) {
    score -= 11;
    reasons.push('people');
  }
  if (!protectedFact && /\?$/.test(title)) score -= 4;

  score = Math.max(-34, Math.min(38, score));
  return { score, reasons: reasons.slice(0, 4) };
}

function catalogRank(article = {}) {
  const base = Number(article.score || 0);
  const signal = homeSignalScore(article);
  return { score: base + signal.score, signal: signal.score, reasons: signal.reasons };
}

function rankCatalogArticles(articles = []) {
  return [...articles]
    .map(article => {
      const ranked = catalogRank(article);
      const baseScore = Number(article.score || 0);
      const catalogScore = Math.round(ranked.score * 10) / 10;
      return {
        ...article,
        scoreV915Base: baseScore,
        score: catalogScore,
        catalogSignalV915: ranked.signal,
        catalogScoreV915: catalogScore,
        catalogReasonsV915: ranked.reasons
      };
    })
    .sort((a, b) => Number(b.catalogScoreV915 || 0) - Number(a.catalogScoreV915 || 0)
      || Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
}

module.exports = { homeSignalScore, catalogRank, rankCatalogArticles, publicDecisionSignal };
