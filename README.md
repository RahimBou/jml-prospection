# JML Prospection — V1.13.0

## V1.6.2 — serveur et sources publiques
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


## V1.10.0 — Data Agent
Ajout d'une couche de contrôle qualité entre les sources publiques et les moteurs d'analyse. Le Data Agent vérifie les champs essentiels, repère les valeurs incohérentes, signale les conflits entre sources et sépare la qualité des données de toute analyse commerciale.


## V1.11.2 — rapprochement DPE ↔ adresse
- Le Radar distingue désormais **DPE confirmé à la même adresse**, **correspondance incertaine** et **aucune correspondance DVF fiable**.
- Le bonus de classe énergétique est appliqué uniquement sur une correspondance d'adresse exacte : **F/G +18, E +10, D +4**.
- Les correspondances rue, code postal ou proximité ne donnent aucun bonus de classe DPE.
- Les signaux complémentaires liés à l'âge du DPE, à la consommation et au GES sont également conditionnés à une adresse confirmée.
- Le statut de rapprochement est affiché directement dans chaque candidat du Radar.


## V1.12.0 — volume DVF augmenté
- Le Radar futur ne s'arrête plus à 1 000 transactions DVF.
- Interrogation DVF+ par pages de 500 jusqu'à **10 000 transactions maximum** sur la période sélectionnée.
- En cas de secours open-data, le moteur peut également charger jusqu'à **10 000 transactions**.
- Le filtrage et la pondération continuent ensuite sur ce volume élargi.


## V1.13.0 — Prospection par annonce publique + carte
- Ajout d'un module **Prospects vendeurs particuliers** avec carte interactive.
- Une adresse provenant d'une annonce publique peut être géocodée par la **BAN / Géoplateforme**.
- L'adresse est ensuite croisée avec jusqu'à **10 000 transactions DVF** et les DPE correspondants.
- Le module distingue **DPE confirmé à la même adresse**, **DPE incertain** et **aucun DPE correspondant**.
- La carte affiche le point de l'annonce, les mutations DVF rapprochées et les DPE rapprochés lorsque leurs coordonnées sont disponibles.
- Le lien public de l'annonce peut être conservé dans la fiche CRM.
- La collecte automatique de coordonnées personnelles n'est pas activée : le module part d'une annonce publique ou d'une adresse fournie par l'utilisateur.
- Le service de géocodage utilisé est désormais celui de la Géoplateforme, l'ancien endpoint API Adresse ayant été déprécié.


## V1.16.0 — Connecteurs annonces
- Ajout du test serveur **ChercherTrouver.immo** via `/api/integrations-health` et son endpoint `/api/v1/ping`, qui ne consomme pas le quota d'annonces.
- Les clés API restent côté Render et ne sont jamais exposées au navigateur.
