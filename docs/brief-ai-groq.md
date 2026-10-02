# Brief IA automatique — Groq (98.46)

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
