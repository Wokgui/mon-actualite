# Brief IA — contrat de connexion par abonnement (98.40)

## Disponible et limites explicites

- Six choix persistants : ChatGPT, Claude, Gemini, Le Chat/Mistral, Perplexity et Grok.
- ChatGPT : parcours natif Android Sign in with ChatGPT pour un abonnement éligible, soumis aux permissions et limites du fournisseur. Aucun compte réel n’a été utilisé dans les tests automatisés. La validation complète requiert une connexion volontaire sur un téléphone.
- Autres services : ouverture du compte officiel; pas d’intégration automatique présentée comme fonctionnelle. Aucun contournement des interfaces privées, collecte de mot de passe ou remplacement par une API facturée.
- Web/PWA : pas de pont natif, pas de connexion intégrée annoncée. La version web hébergée ne se fait pas passer pour un client local autorisé.

## Flux et sécurité

Le rendu unique d’app.js possède les trois sections. services/brief-ai.js conserve seulement fournisseur, prompt, modèle et résultat textuel lié aux sources. Android détient les identifiants OAuth dans un fichier AtomicFile chiffré AES-GCM, avec une clé AndroidKeyStore et un emplacement noBackupFilesDir. Aucun jeton n’est transmis à JavaScript, au stockage web ou au serveur Mon Actualité.

Le pont WebMessageListener est limité à la page principale locale /assets/index.html sur l’origine HTTPS de l’application. Les articles externes ne naviguent pas dans cette WebView. Connexion : navigateur système, listener loopback 127.0.0.1 avant ouverture, PKCE S256, état et nonce uniques, client émis par inscription, vérification RSA/JWKS + issuer/audience/expiration/nonce, validation du sujet du compte sélectionné. Une nouvelle tentative ne remplace pas l’ancien compte avant validation. Le host et les inscriptions sont conservés, y compris après déconnexion. Les comptes sont isolés.

Renouvellement sérialisé et rotation atomique des jetons. Déconnexion locale, interruption de la génération et révocation officielle (deux tentatives maximum); une révocation non confirmée est annoncée sans laisser croire que le fournisseur a reçu la demande.

Catalogue de modèles propre au compte via /v1/models. Appel /v1/responses avec jeton OAuth, store:false et stream:true. Aucun retry de génération ni génération à l’ouverture. Un résultat n’est validé qu’après response.completed; erreurs tardives, limites ou interruption conservent le précédent résultat. Les résultats sont associés au fournisseur, au prompt et au compte sélectionné.

## Contenu

60 actualités maximum transmises : titres, dates, sources et extraits disponibles, pas prétendument le texte intégral. 12 cartes maximum. Chaque sourceId doit correspondre au catalogue transmis. Les liens et images proposés par le modèle sont ignorés : seules les sources réelles et leur verrou photo partagé avec Accueil servent au rendu. Échappement de tout texte; URL de source HTTP(S) obligatoire, y compris lors de restauration d’un résultat local.

## Vérifications

- SubscriptionOAuthTest : signature RSA réelle, nonce/audience/issuer/expiration, algorithme, signature altérée, client manquant ou substitué, scopes exacts, interruption et échec tardif, événement completed et contenu JSON.
- v9840-brief-ai-browser : six choix, persistance, prompt, zéro génération initiale, connexion simulée clairement identifiée, cartes/photos et URL source originales, cache photo partagé, rejet source inventée et URL javascript, conservation du résultat après limite, absence de jetons dans localStorage.
- Même parcours sans pont natif : blocage explicite de la génération et absence de faux bouton de connexion.
- Les deux workflows Android exécutent les tests JVM avant de publier leur APK. Les régressions mobile/PWA incluent les deux parcours IA.

## Sources officielles

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/ui-ux-guidelines
