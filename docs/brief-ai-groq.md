# Brief IA automatique — Groq (98.46)

## Présentation et ouverture 98.53

Le rendu initial de L’essentiel contient uniquement un message de chargement sous les onglets, sans cartes ni images dans le DOM. Une seule préparation de données par langue complète ce rendu en une fois; les anciens observateurs de visibilité et l’interception des clics de navigation sont retirés. Une réponse complète d’une ou deux journées est utilisable, sans attente infinie de trois journées. Le délai réseau est limité à douze secondes avec repli sur le catalogue disponible. L’historique dédié ne remplace plus le catalogue d’Accueil pendant la lecture.

Accueil, L’essentiel, Veille et les textes des synthèses IA utilisent la même taille calculée : 11,5 px × réglage du texte × réglage des titres. Le minimum reste celui d’Accueil, soit 11,5 px à texte 100 et titres 100 (8,05 px si les titres sont aussi réduits à 70). Les domaines IA restent volontairement plus grands, centrés et gras. Les tests vérifient une requête d’historique, zéro image et zéro carte pendant l’attente, la réponse partielle en jours, l’erreur et le cache de repli, les quatre tailles au minimum et maximum, leur persistance après rechargement et l’absence de débordement à 320 px.

## Présentation 98.47

Réglages → IA utilise partout la taille de « Service d’intelligence artificielle », tout en respectant le réglage de taille de l’interface. Les intitulés de service et de clé sont centrés et le prompt est justifié.

Brief → IA affiche une synthèse justifiée avec un titre centré et des paragraphes distincts par sujet. Les notifications de réussite et le sous-titre de prompt obsolète sont retirés de cette vue; les erreurs et l’avertissement de recherche partielle restent visibles. La date de génération et le lien vers les articles sont centrés; chaque article possède sa date de publication et son lien centrés en dessous. Un trait noir de 2 px sépare les articles, uniquement dans IA.

Les cartes sont triées par date de publication décroissante lors de la normalisation et du rendu, y compris pour les anciens caches, sans mutation des sources ou des photos. Les résultats invalides ou sans date valide restent à la fin. Le prompt système demande désormais un paragraphe court par sujet séparé par deux sauts de ligne. Les anciens résultats sont lus sans réécriture de leur texte; leurs sauts de ligne existants sont respectés. Aucun appel Groq supplémentaire n’est lancé pour remettre en forme un cache.

## Présentation 98.48

Brief → IA retire le titre de synthèse et les pieds de carte. L’introduction reste justifiée, y compris lorsqu’elle contient un deux-points. Les espacements bandeau → onglets et onglets → synthèse utilisent la même valeur de 14 px. Les cartes sont resserrées, sans supprimer la protection contre le bandeau de navigation fixe.

La date et l’heure de publication sont à droite de la source dans l’en-tête de chaque article. Les titres intermédiaires des cartes sont centrés et gras. Un formateur pur nettoie aussi les anciens résultats : les libellés Utilité et Statut disparaissent mais leur contenu reste; le bloc Source et sa continuation sont retirés puisque la provenance et l’accès à l’article existent dans l’en-tête. Le cache, le prompt personnel, la clé et les verrous de photos sont inchangés. Les futures générations reçoivent également cette consigne de présentation. Le test mobile mesure les espacements, les dates en en-tête, le nettoyage des anciens blocs et l’absence des pieds de carte, en plus des contrôles précédents.

## Présentation 98.49

Le titre intermédiaire en tête de chaque carte IA est déplacé au-dessus de l’aperçu source et de sa photo; à défaut le titre de la carte IA sert de titre. L’aperçu conserve le titre réel de l’article source. Les espacements des cartes sont réduits et les dimensions des photos restent inchangées. Brief → Veille et IA affichent une consigne noire centrée, « Réglez vos préférences dans l’onglet Réglages », avec le même écart de 14 px entre les onglets et cette consigne qu’entre le bandeau et les onglets. L’ancien message vide IA est retiré; erreurs et état de génération restent visibles.

Les réglages utilisent des actions ajustées au contenu, avec la couleur dominante et son premier plan adaptatif; Bloquer garde un rouge doux et du texte blanc. Les curseurs et Domaines couverts ont des titres centrés, le premier titre Langue est équilibré entre le bandeau et son séparateur, le doublon À éviter disparaît, et les interrupteurs Fonctionnement sont visuellement de 38 × 22 px avec une zone tactile de 44 × 44 px. Aucune migration de clé, de prompt ou de cache n’est nécessaire. Le test navigateur couvre ces éléments et leur fonctionnement, en modes Android simulé et Web.

## Présentation 98.50

Langue utilise maintenant les mêmes métriques de titre et de flèche que Taille et densité du texte. L’import OPML est centré réellement : les actions ajustées au contenu utilisent un conteneur flex de bloc, avec marges automatiques, plutôt qu’un affichage inline-flex. Vérifier la mise à jour reprend la couleur dominante avec texte adaptatif; le badge v98 garde un texte blanc. Le champ de clé est intitulé Ta clé Groq, qu’une clé soit déjà enregistrée ou non. Aucun changement de clé, de cache, de prompt ou de pipeline photo.

Les tests mobiles comparent les hauteurs et flèches à 320 et 412 px sur trois tailles de texte, mesurent le centrage OPML et vérifient les couleurs, le badge et le libellé de clé. La sauvegarde PC est une archive séparée des fichiers versionnés, du projet Android, de l’historique Git et de l’APK; elle ne prétend pas extraire les données personnelles du téléphone.

## Présentation 98.51

La consigne de préférences n’est affichée dans Veille et IA que tant que la rubrique n’a pas de contenu : articles réellement présents dans Veille ou synthèse conservée dans IA. Une synthèse sans cartes est néanmoins du contenu. Le contenu remonte à 14 px sous les onglets, comme les 14 px entre le bandeau et les onglets; les marges initiales de Veille ne réintroduisent pas d’espace. Les erreurs et états de génération utiles restent visibles.

Les titres de domaines centrés des cartes IA passent à 16 px, contre 14 px pour les paragraphes, en conservant le réglage de taille. Les consignes de génération demandent des phrases complètes pour chaque catégorie demandée, commençant par une majuscule, et signalent un manque de sources sans inventer. Le formateur met aussi une majuscule au début des paragraphes et domaines des résultats déjà conservés, sans modifier le cache ou les destinations de liens et sans déclencher une génération supplémentaire. La sauvegarde PC est renouvelée séparément, avec le nouvel APK et la même signature.

## Présentation 98.52

Les boutons Restaurer la couleur par défaut et Restaurer les hauteurs par défaut reprennent les règles communes de couleur dominante, premier plan adaptatif, largeur ajustée au contenu, centrage, zone tactile et focus. Les fonctions de restauration restent inchangées. Le badge v98 séparé est retiré; Mon actualité avec sa version et la ligne de publication sont centrés. Les titres de domaines des cartes IA passent de 16 à 18 px, contre 14 px pour le corps, avec le réglage de taille conservé. Les tests vérifient les couleurs claires et foncées, la taille/position des actions, les clics de restauration, les deux lignes centrées et le rapport de taille des domaines. La sauvegarde PC est renouvelée, sans remplacer les précédentes.

## Activation unique dans l’APK

Créer un compte sur https://console.groq.com/keys, rester sur Free sans activer de facturation, créer une clé, puis l’enregistrer dans Réglages → IA. Ne jamais transmettre la clé dans une conversation. Le compte et les limites Groq sont indépendants de l’abonnement ChatGPT. L’app ne crée aucun compte et ne souscrit aucune offre payante.

Le prompt personnel est conservé. Le prompt initial couvre les innovations pratiques et théoriques, les découvertes scientifiques, la VR et les voitures. Les résultats apparaissent dans Brief → IA. Le bouton Actualiser permet une demande manuelle; l’option à l’ouverture est activée par défaut lors de la migration de l’ancien parcours manuel.

## Fonctionnement

- services/brief-groq.js est le seul propriétaire de la génération. Une demande simultanée maximum; le résultat du même prompt et de la même clé est réutilisé pendant 12 heures. Une erreur conserve la dernière synthèse et bloque les relances automatiques pendant une heure et pendant le lancement courant. Un changement de prompt ou de clé invalide les réponses en cours.
- fetchBriefCandidates effectue une recherche ciblée sur les sept derniers jours, sans modifier le catalogue ou l’ordre d’Accueil. Les exclusions de sources/sujets et de vidéos sont respectées. Au maximum 24 articles récents sont sélectionnés avec diversité par catégorie. La recherche n’est pas exhaustive; seuls titres et extraits sont transmis. Si la découverte échoue, le fil déjà disponible sert de repli avec un avertissement visible.
- Le résultat est strictement structuré en summary et cards. Chaque carte doit citer un identifiant du lot figé; liens et photos proviennent de ce lot, jamais de l’IA. Le verrou photo partagé existant est réutilisé. Le dernier résultat reste visible pendant le rafraîchissement. Le sous-onglet Brief est conservé lors du rechargement.
- GroqAiBridge n’accepte que le document Android principal /assets/index.html sur l’origine autorisée. La clé est chiffrée AES-GCM via Android Keystore dans noBackupFilesDir; jamais retournée au JavaScript, enregistrée dans localStorage ou incluse dans l’APK. Aucun endpoint ou modèle arbitraire, redirection HTTP, journal de clé ou réponse brute d’erreur.
- Endpoint officiel fixe https://api.groq.com/openai/v1/chat/completions, modèle openai/gpt-oss-120b, sortie JSON stricte sans SSE, raisonnement low, maximum 2200 tokens de sortie. Entrées et délais bornés, une demande native simultanée, garde anti-rafale native persistante et sauvegardes atomiques.
- Le stockage chiffré et la génération sont proposés uniquement dans l’APK Android. L’aperçu Web explique cette limitation et ne collecte aucune clé.
- Les anciens ponts ChatHandoffBridge et SubscriptionAiBridge ne sont plus enregistrés; leurs fichiers et anciens tests historiques restent disponibles. Les anciennes autorisations fournisseur ne sont pas révoquées à la place de l’utilisateur.

## Validation et limites

tests/v9846-groq.mjs couvre migration, sélection sur sept jours, provenance figée, cache, requête unique, erreurs, réponses obsolètes, sauvegarde atomique et absence de clé dans le stockage JavaScript. GroqBriefTest couvre le contrat JSON natif, le format des clés, les tailles maximales, les sources fictives, les réponses tronquées et les erreurs HTTP.

tests/v9846-groq-browser.mjs parcourt le frontend mobile: génération à l’ouverture, trois sous-onglets, liens/photos, cache après réouverture, absence de demandes en doublon, changement de prompt, erreur conservant le résultat, clé retirée/réenregistrée, isolation d’Accueil et mode Web sans pont. Le pont et la réponse fournisseur sont des fixtures, pas une validation avec un vrai compte Groq ou un téléphone physique. Le workflow Android compile le pont et exécute tous les tests JVM.

Documentation fournisseur: https://console.groq.com/docs/structured-outputs et https://console.groq.com/docs/rate-limits. Les limites réelles du compte peuvent évoluer. L’appel réel final nécessite la clé de l’utilisateur et ne peut pas être garanti par les fixtures.
