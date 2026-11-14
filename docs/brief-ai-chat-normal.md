# Brief IA — chat normal, import manuel (98.45)

Document historique. Ce parcours est remplacé en 98.46 par [le Brief Groq automatique](brief-ai-groq.md). Les anciens modules ne sont plus chargés ni enregistrés dans MainActivity.

## Parcours utilisateur

Dans Réglages → IA, choisir un service, conserver ou modifier le prompt, puis utiliser « Copier la demande et ouvrir ChatGPT ». La demande est écrite dans le presse-papiers uniquement après le clic. Le chat officiel est ouvert dans une application externe ou dans le navigateur. L’utilisateur colle et envoie la demande dans le chat, puis colle sa réponse dans « Réponse de ton chat » et choisit « Importer dans Brief → IA ».

Le service peut être ChatGPT, Claude, Gemini, Le Chat/Mistral, Perplexity ou Grok. Aucun identifiant n’est demandé par Mon Actualité. Les limites du chat choisi restent celles de son fournisseur. Il n’y a aucun appel IA automatisé par Mon Actualité, aucune clé API et aucun appel à l’ancien parcours de partage d’abonnement.

## Architecture et migration

- app.js utilise services/brief-chat.js, distinct du module d’abonnement historique désormais inutilisé.
- MainActivity ne construit plus SubscriptionAiBridge. ChatHandoffBridge ne sait qu’écrire une demande locale dans le presse-papiers et ouvrir une URL officielle autorisée. Origine et document principal sont vérifiés ; aucune lecture du presse-papiers ni opération réseau.
- Les paramètres existants sont migrés vers mode=manual-chat et autoAtOpen=false. Prompt, service et dernier résultat valide sont conservés. Les anciennes autorisations serveur ne sont pas révoquées automatiquement : elles ne sont plus utilisées ; l’utilisateur peut les retirer dans ChatGPT.
- Les sources préparées (40 maximum, extraits de 900 caractères maximum) sont figées et enregistrées localement avec le prompt et le service. A1 représente toujours la même source, même après rechargement et changement du catalogue. Il s’agit du fil courant, pas d’une recherche exhaustive du Web ou de tous les articles de la semaine.
- Le JSON demandé contient summary et cards avec sourceId/title/summary ; les réponses en prose sont aussi acceptées. Seuls les liens correspondant aux sources figées créent des cartes. Sans lien connu, seul le résumé est affiché. Un JSON mal formé n’est pas présenté comme une réussite en prose.
- Les photos et URL des cartes sont prises dans les sources figées, jamais dans les champs image/url proposés par le chat. Le verrou photo existant est réutilisé.
- Une réponse vide, invalide, trop longue (100 000 caractères maximum), sans demande correspondante ou non enregistrable ne remplace pas le résultat précédent.

## Validation

tests/v9845-chat-import.mjs vérifie migration, sources figées, JSON/prose, sources fictives rejetées, sauvegarde atomique et absence de branchement vers l’ancienne génération.

tests/v9845-chat-browser.mjs vérifie le parcours dans le vrai frontend mobile : copie/ouverture simulée, import, réouverture avec sources réordonnées, photos communes à Accueil et Brief, erreurs, sécurité HTML, mode navigateur et ancien pont natif piégé (zéro appel). Les images du test sont des fixtures ; ce n’est pas une conversation réelle avec un compte fournisseur.

ChatHandoffTest vérifie les six URL autorisées, les actions locales uniquement et les limites de saisie. Les workflows Android compilent le pont natif et exécutent les tests JVM. L’ouverture réelle du chat externe et le presse-papiers doivent aussi être confirmés sur le téléphone de l’utilisateur.
