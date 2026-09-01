# Mon actualité — version locale 91.45

Cette version sert à vérifier les corrections avant toute publication Vercel.

## Windows

1. Décompresse le paquet local dans un dossier.
2. Double-clique sur `START_LOCAL_V91.45.bat`.
3. Le navigateur ouvre `http://localhost:4173`.
4. Un petit badge `LOCAL 91.45` est affiché en haut à droite pour éviter de confondre cette version avec la production.
5. Pour arrêter la version locale, ferme la fenêtre noire du serveur.

Node.js 22 LTS doit être installé sur le PC.

## Téléphone Android sur le même Wi-Fi

Le serveur écoute aussi sur le réseau local. La fenêtre noire indique le port 4173. Sur le téléphone, ouvre `http://ADRESSE_IP_DU_PC:4173` en remplaçant `ADRESSE_IP_DU_PC` par l’adresse IPv4 du PC, par exemple `192.168.1.25`.

Si Windows demande une autorisation pour le pare-feu, autorise Node.js sur le réseau privé uniquement.

## Ce qui est local et ce qui ne l’est pas

Le HTML, JavaScript et CSS de la version de test sont servis depuis le PC. Les routes `/api/...` sont relayées vers `https://mon-actualite.vercel.app`, ce qui permet d’utiliser les vrais flux et la vraie clé Groq côté serveur sans la copier sur le PC.

Aucun déploiement Vercel n’est déclenché par ce serveur local.

## Corrections 91.45 à vérifier

- Les résumés IA rejetés uniquement par le contrôle `support-check` ou `title-restatement` ont droit à une seconde tentative légère unique.
- Le pré-calcul progressif 91.44 reste actif : premiers articles prioritaires, puis préparation lente des suivants.
- Si Groq reste indisponible, la fiche ne reste pas vide : après échec explicite ou attente trop longue, un résumé automatique extractif peut être affiché, sans être présenté comme un résumé IA.
- La fiche résumé réutilise en priorité l’image réellement déjà affichée sur la carte, y compris quand cette image est arrivée après le premier rendu et n’a jamais été recopiée dans l’objet article.
