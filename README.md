# Mon actualité

Application Android-first d’actualité générale et personnalisée, alimentée par des flux RSS/Atom et Google Actualités.

Production : <https://mon-actualite.vercel.app>

## Fonctionnement

- actualité générale : politique, international, économie, société, santé, environnement, science, culture, éducation et Europe ;
- centres d’intérêt personnels qui remontent certains sujets sans masquer l’actualité générale ;
- mots-clés libres recherchés dans les flux et, si l’option est active, dans Google Actualités ;
- sources RSS/Atom ajoutées manuellement ou importées depuis un fichier OPML ;
- priorité configurable aux sources personnelles ;
- fusion des articles très similaires provenant de plusieurs médias ;
- actualisation au démarrage, au retour dans l’application et toutes les 15 minutes lorsqu’elle reste ouverte ;
- cache local du dernier flux pour conserver un affichage utile hors connexion.

Les préférences, sources personnelles, mots-clés, articles sauvegardés et retours utilisateur sont conservés dans le stockage local du navigateur.

## Architecture

- `index.html`, `styles.css`, `app.js` : interface PWA et personnalisation ;
- `services/source-connectors.js` : import OPML et communication avec l’API ;
- `api/news.js` : fonction Vercel qui lit les flux, classe, hiérarchise et déduplique les articles ;
- `manifest.webmanifest`, `sw.js` : installation Android et cache hors ligne.

## Installation Android

Dans **Réglages**, utiliser **Installer sur cet appareil**. Chrome affiche alors la boîte d’installation native.

## Développement

L’interface statique peut être servie localement, mais la récupération réelle des actualités nécessite l’endpoint Vercel `/api/news`.
