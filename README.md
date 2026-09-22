# JML Prospection — V1.6.0

## V1.6.0 — serveur et sources publiques
- Passage de Render Static Site à un service Node.
- API serveur `/api/health`, `/api/commune`, `/api/dpe` et `/api/dvf`.
- Recherche DPE via l'API ADEME.
- Recherche de transactions via DVF+ Cerema.
- Géocodage des communes via l'API Adresse.
- Résultats affichés dans l'interface sans ré-identification de personnes.
- Préparation d'une fiche à partir d'un DPE public, avec validation humaine avant enregistrement.

Le serveur ne télécharge pas toute la base DPE/DVF dans le navigateur : les recherches sont filtrées côté serveur et limitées en volume.

Application indépendante de prospection immobilière pour JML Immobilier.

## V1.5 — historique des prix et signaux enrichis
- Tableau de bord
- Recherche avancée
- Anti-doublons et fusion des sources
- Import/export CSV
- Calcul indicatif du prix/m²
- Date de détection
- Radar automatique de signaux
- Score de signal par bien
- Filtres : nouveau détecté, fiche ancienne, relance en retard, DPE F/G, terrain important, sources multiples, données incomplètes
- Boutons rapides pour filtrer les signaux détectés
- Tri par priorité de signal
- Historique structuré des prix
- Détection des baisses de prix
- Historique des apparitions par source
- Affichage de l'évolution du prix sur chaque fiche

### Règles actuelles du radar
Le score est volontairement transparent et basé uniquement sur les données déjà présentes :
- nouveau détecté ≤ 7 jours : +3
- fiche ancienne ≥ 60 jours : +2
- relance dépassée : +3
- DPE F ou G : +2
- terrain ≥ 1 000 m² : +2
- plusieurs sources réellement distinctes : +3
- baisse de prix détectée : +4
- données essentielles manquantes : +1

Ce score n'est pas une probabilité de vente. Il sert uniquement à prioriser la revue des biens.

## Mise en ligne de test — Render

Le dépôt contient maintenant un `render.yaml` prêt pour un déploiement **Static Site** sur Render.

### Connexion
1. Ouvrir Render et choisir **New → Blueprint**.
2. Connecter le compte GitHub.
3. Sélectionner le dépôt `RahimBou/jml-prospection`.
4. Render détectera automatiquement `render.yaml`.
5. Créer le service `jml-prospection`.
6. Chaque mise à jour de `main` pourra ensuite être redéployée automatiquement.

L'application actuelle est un prototype navigateur : les données de test sont stockées dans le `localStorage` du navigateur. Le déploiement Render sert donc à tester l'interface en ligne ; il ne constitue pas encore une base de données partagée entre appareils.

## Feuille de route
1. Historique structuré des changements de prix et caractéristiques
2. Carte Ardennes
3. Moteur de signaux enrichi
4. Connexion progressive aux sources publiques et données DPE
5. Pige et mises à jour automatiques, dans le respect du cadre légal et de la vie privée
6. Base distante / synchronisation multi-appareils

## Principe
Le projet travaille au niveau des biens et des informations publiquement accessibles. Il ne doit pas servir à réidentifier des particuliers à partir de données privées, de compteurs, de consommations ou de comptes personnels.


## Sources publiques retenues — étape 1

- **DVF / data.gouv.fr** : transactions immobilières publiques, utilisées pour l’analyse de marché et les comparables. Les conditions de réutilisation interdisent la ré-identification des personnes.  
- **DPE / ADEME** : données DPE des logements existants depuis juillet 2021, disponibles en open data et par API.  
- Étape suivante : construire les connecteurs serveur pour rechercher les données par commune/adresse, normaliser les résultats, dédoublonner les biens et alimenter l’historique des signaux.
