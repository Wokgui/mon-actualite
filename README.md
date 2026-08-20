# Mon actualité — prototype mobile

Prototype autonome d’une application Android-first qui filtre, fusionne et résume une sélection d’actualités personnalisées.

Production : <https://mon-actualite.vercel.app>

## Lancer

Servir ce dossier avec n’importe quel serveur HTTP statique, puis ouvrir l’adresse locale dans un navigateur. Aucun paquet ni compte externe n’est nécessaire.

## Installation Android

Dans Réglages, utiliser **Installer sur cet appareil**. Chrome affiche alors sa boîte d’installation native. Le manifeste fournit des icônes PNG 192×192, 512×512 et une variante maskable ; le service worker conserve l’interface et ses visuels pour un démarrage hors ligne.

## Structure

- `index.html`, `styles.css`, `app.js` : interface et navigation de la SPA.
- `assets/` : visuels éditoriaux hors ligne et icônes d’installation Android.
- `services/source-connectors.js` : frontière prévue pour Feedly, l’import OPML et la recherche web complémentaire.
- `manifest.webmanifest`, `sw.js` : installation PWA et cache hors ligne.

L’import OPML est déjà analysé localement pour afficher le nombre de flux détectés. Il n’envoie aucun fichier. Les méthodes `futureSourceGateway` et `futureWebSearchGateway` sont les points d’intégration destinés au futur backend. Les clés d’API et l’authentification Feedly devront rester côté serveur.
