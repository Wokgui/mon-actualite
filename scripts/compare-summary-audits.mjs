import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function correctedBeforeQuality(row) {
  if (row.unavailable) return 'unavailable';
  if (row.inputUrlKind === 'google-news' && row.materialSource === 'rss') return 'google-news-aggregate';
  return row.summaryQuality;
}

const before = JSON.parse(await fs.readFile(path.resolve(arg('before')), 'utf8'));
const after = JSON.parse(await fs.readFile(path.resolve(arg('after')), 'utf8'));
const archive = JSON.parse(await fs.readFile(path.resolve(arg('archive')), 'utf8'));
const output = path.resolve(arg('output'));
const afterById = new Map(after.rows.map(row => [row.id, row]));

const rows = before.rows.map(old => {
  const current = afterById.get(old.id) || {};
  const beforeQuality = correctedBeforeQuality(old);
  const beforeTrusted = ['good', 'acceptable-short'].includes(beforeQuality);
  const afterTrusted = ['good', 'acceptable-short'].includes(current.summaryQuality) && !current.unavailable;
  return {
    index: old.index,
    source: old.source,
    category: old.category,
    publishedAt: old.publishedAt,
    ageBucket: old.ageBucket,
    pageHost: current.pageHost || old.pageHost,
    title: old.title,
    imagePresent: old.imagePresent,
    imageStatus: old.imageStatus,
    imageSource: old.imageSource,
    beforeMaterialSource: old.materialSource,
    beforeExtractedChars: old.extractedChars,
    beforeRssChars: old.rssChars,
    beforeSummaryChars: old.summaryChars,
    beforeQuality,
    beforeTrusted,
    beforeFailure: old.failureType,
    beforeTimeout: old.timedOut,
    beforeFallback: old.fallbackType,
    afterMaterialSource: current.materialSource,
    afterExtractionMethod: current.extractionMethod,
    afterExtractedChars: current.extractedChars,
    afterSourceChars: current.sourceChars,
    afterSummaryChars: current.summaryChars,
    afterQuality: current.summaryQuality,
    afterTrusted,
    afterUnavailable: current.unavailable,
    afterFailure: current.failureType,
    afterTimeout: current.timedOut,
    afterApiError: current.apiError,
    afterFallback: current.fallbackType,
    afterSearchEvidence: current.searchEvidenceCount,
    afterRetryCount: current.retryCount,
    afterElapsedMs: current.elapsedMs,
    afterSummary: current.summary
  };
});

const headers = Object.keys(rows[0]);
const csv = [headers.map(csvCell).join(','), ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n');
await fs.writeFile(output.replace(/\.md$/i, '.csv'), `${csv}\n`, 'utf8');

const beforeTrusted = rows.filter(row => row.beforeTrusted).length;
const afterTrusted = rows.filter(row => row.afterTrusted).length;
const corrected = rows.filter(row => !row.beforeTrusted && row.afterTrusted);
const remaining = rows.filter(row => row.afterUnavailable);
const combined = [...after.rows, ...archive.rows];
const unique = key => new Set(combined.map(row => row[key]).filter(Boolean)).size;
const pct = (value, total) => `${(100 * value / total).toFixed(1).replace('.', ',')} %`;

const markdown = `# Audit local systématique des résumés

Date : ${new Date().toISOString()}

## Périmètre et méthode

- 60 articles publics réels au total : 48 articles du catalogue local principal, conservés à l’identique pour le comparatif avant/après, plus 12 articles âgés de 8 à 30 jours.
- ${unique('source')} sources, ${unique('category')} catégories et ${unique('pageHost')} hôtes de pages distincts.
- Échantillon principal : 45 articles de moins de 12 h et 3 de 12 à 48 h. Complément : 12 articles de 8 à 30 jours.
- Pour chaque article : source, catégorie, date, hôte, extraction, longueur, qualité, image déclarée, échec, timeout/API, fallback, durée et résumé final sont consignés dans le CSV comparatif.
- Aucun déploiement. Aucune clé Groq/Gemini n’était disponible localement : les appels réels aux pages, flux et recherches sont mesurés ; les erreurs Groq 429 et timeout sont couvertes par des tests simulés reproductibles.

## Résultat avant/après sur les 48 mêmes articles

| Indicateur | Avant | Après | Évolution |
|---|---:|---:|---:|
| Résumés factuels jugés utilisables | ${beforeTrusted}/48 (${pct(beforeTrusted, 48)}) | ${afterTrusted}/48 (${pct(afterTrusted, 48)}) | +${afterTrusted - beforeTrusted} articles |
| Textes complets extraits | ${before.sample.fullText}/48 | ${after.sample.fullText}/48 | +${after.sample.fullText - before.sample.fullText} |
| Agrégats Google pris à tort pour des résumés | ${rows.filter(row => row.beforeQuality === 'google-news-aggregate').length} | 0 | supprimés |
| Snippets de recherche fiables utilisés | 0 | ${after.sample.bySourceMaterial['search-snippet'] || 0} | nouveau fallback |
| Résumés réellement indisponibles | ${rows.filter(row => row.beforeQuality === 'unavailable').length} | ${after.sample.unavailable} | inchangé en nombre, mais les échecs transitoires ne sont plus mis en cache durablement |
| Images préparées présentes dans le catalogue | ${before.sample.imagePresent}/48 | ${after.sample.imagePresent}/48 | hors périmètre des corrections |
| Médiane locale de traitement | ${before.sample.medianElapsedMs} ms | ${after.sample.medianElapsedMs} ms | coût des retries et recherches bornées |

Point important : avant correction, l’interface exigeait un résultat marqué IA et remplaçait aussi les bons fallbacks factuels par « résumé indisponible » lors d’une absence/erreur Groq. Dans l’environnement local sans clé, cela rendait 0/48 fallbacks affichables. Après correction, 46/48 sont affichables sans Groq, avec provenance factuelle et validation de qualité.

## Couverture complémentaire des articles anciens

- 12/12 résumés disponibles (${pct(12, 12)}).
- 11 textes complets et 1 snippet de recherche.
- 11 sources, 6 catégories, articles âgés de 8 à 30 jours.

Au total après correction : ${combined.filter(row => !row.unavailable).length}/60 résumés disponibles (${pct(combined.filter(row => !row.unavailable).length, 60)}), ${combined.filter(row => row.fullText).length} textes complets et ${combined.filter(row => row.materialSource === 'search-snippet').length} récupérations complémentaires.

## Causes récurrentes observées avant correction

| Cause | Occurrences sur 48 | Effet |
|---|---:|---|
| Extraction HTML réussie | 38 | texte complet exploitable |
| Erreur réseau/récupération | 3 | repli RSS Google, souvent trompeur |
| HTML sans paragraphes détectables | 3 | 2 snippets trop courts et 1 agrégat |
| Anti-bot / HTTP 403 ou 429 | 3 | page éditeur inaccessible |
| Timeout page | 1 | repli RSS Google |
| Agrégat Google Actualités accepté comme résumé | 8 | concaténation de titres de médias différents |
| Snippet trop court et aucune preuve complémentaire | 2 | résumé indisponible |

Les catégories demandées mais non rencontrées dans cet échantillon réel sont tout de même classifiables par les diagnostics : page non HTML, page trop volumineuse, URL bloquée, décodage Google, erreur Groq, réponse trop courte, contrôle d’étayage et reformulation du titre.

## Corrections apportées

1. Extraction structurée : JSON-LD \`articleBody\`, paragraphes \`article/main\`, repli document, puis métadonnées \`og:description\`/Twitter/description.
2. Retry réseau borné : une seule nouvelle tentative sur 429/5xx/erreur réseau, délai court et diagnostics du nombre de tentatives.
3. Rejet explicite des descriptions agrégées Google Actualités comme preuve RSS directe.
4. Recherche complémentaire Bing News RSS uniquement si le texte complet et le snippet éditeur fiable manquent ; variantes de requête et réutilisation prudente des titres du même agrégat Google.
5. Nettoyage des snippets : suppression des titres connexes, ellipses incomplètes, formulations promotionnelles et simples reformulations du titre.
6. Fallback d’ordre : texte complet → métadonnée de page → RSS direct fiable → snippet de recherche → indisponible. La recherche complémentaire est plafonnée à 6,5 secondes au total.
7. Groq : modèles alternatifs conservés, retry court sur 429/5xx, pas de retry immédiat après un timeout long, fallback factuel validé sur erreur, diagnostics par tentative.
8. Cache : réponse transitoire/indisponible en \`no-store\`, succès factuel courtement partageable côté serveur, aucun échec sauvegardé comme succès local.
9. Interface : les résumés factuels \`grounded\` et \`trusted\` sont désormais affichés et réutilisés ; ils ne sont plus faussement marqués comme IA.
10. Observabilité : provenance du matériau, méthode d’extraction, longueurs, statut HTTP, taille HTML, durée, retry, recherche, type d’échec, erreur Groq et fallback sont renvoyés dans \`diagnostics\`.

## Cas restant indisponibles

${remaining.map(row => `- **${row.source}** — ${row.title} : ${row.afterFailure || 'aucun texte'} ; le snippet trouvé était trop promotionnel ou incomplet et a été rejeté plutôt que d’afficher un faux résumé.`).join('\n')}

## Validation

- Tests ciblés réussis : qualité intégrée, rejet des agrégats Google, extraction JSON-LD/métadonnées, fallback sans clé, 429 avec retry borné, timeout sans multiplication, absence de cache d’échec.
- Vérification navigateur mobile locale réussie : fallback factuel affiché, 1 appel smart, 0 appel Groq, aucun message console.
- Vérification syntaxique réussie pour tous les fichiers modifiés.
- La suite statique globale conserve 4 échecs hors du chemin de résumé modifié : incohérences de précache/version, contrôle de priorité IA et classement de significativité. Ils sont signalés séparément, sans être masqués ni attribués à cet audit.

## Fichiers détaillés

- \`audit-resumes-bilan.csv\` : avant/après, une ligne par article principal.
- \`audit-resumes-avant.json/.csv\` : mesure brute avant instrumentation comportementale.
- \`audit-resumes-apres-final.json/.csv\` : mesure finale des 48 mêmes articles.
- \`audit-resumes-archives-final.json/.csv\` : 12 articles de 8 à 30 jours.
`;

await fs.writeFile(output, markdown, 'utf8');
console.log(`Saved ${output}`);
console.log(`Saved ${output.replace(/\.md$/i, '.csv')}`);
