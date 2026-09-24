# JML Prospection — V1.21.5

## V1.21.5 — Radar recalibré
- Le score principal devient une **priorité de prospection** : 70 % signal commercial public + 30 % contexte marché.
- Sans signal commercial public, le bien reste explicitement en **surveillance**.
- Déduplication des DPE Radar par adresse/unité/surface/type, sans supprimer les logements réellement distincts.
- Les distances des comparables DVF indiquent maintenant si elles sont calculées, partielles ou indisponibles ; aucun rayon n'est présenté comme certain lorsque la distance manque.



## V1.21.4 — correctif mode commune/adresse
- Restauration de la fonction de détection commune/adresse pour les sources publiques.
- Recherche `Sedan` en mode commune et adresse numérotée en mode ciblé.
- Version affichée synchronisée avec le déploiement.


## V1.21.3 — regroupement intelligent des sources publiques
- Regroupement des DPE au niveau de l'adresse/bâtiment sans supprimer les logements distincts.
- Regroupement des lignes DVF d'une même mutation en une opération unique.
- Affichage séparé des lignes brutes et des opérations/adresses réellement exploitables.
- Conservation des données détaillées pour les moteurs de rapprochement internes.

## V1.21.2 — sources publiques renforcées
- Recherche commune/adresse différenciée.
- Rapprochement DVF ciblé sur l'adresse saisie lorsque possible.
- Résultats DPE/DVF enrichis et volumes affichés plus utiles.
- Mention claire du mode de recherche et du secours open-data.



## V1.21.1 — correction JavaScript du dashboard
- Correction d'une erreur de syntaxe qui empêchait le chargement de l'interface interactive après V1.21.0.
- Les fonctions existantes du CRM sont conservées.


## V1.21.0 — tableau de bord terrain
- Le tableau de bord devient une vue opérationnelle de prospection : priorités terrain, nouveaux récents, adresses à compléter, relances, changements et biens prêts terrain.
- Ajout des secteurs actifs et d'indicateurs d'activité récente.
- Les raccourcis du dashboard filtrent directement les prospects concernés.
- Cette version ne modifie ni le moteur DVF/DPE, ni la veille ChercherTrouver.

## V1.20.6 — vue rue des adresses candidates
- Chaque adresse candidate dispose maintenant d'un bouton **👁️ Vue rue**.
- **🗺️ Map View** ouvre Google Maps sur la position candidate.
- **📋 Copier** facilite la préparation d'une tournée terrain.
- Aucun changement au moteur de récupération des annonces ni au rapprochement DVF/DPE.

# JML Prospection — V1.20.6

## V1.20.5 — diagnostic connecteur
- Health-check ChercherTrouver synchronisé.
- Détection explicite d'un serveur Render non redéployé.



## V1.20.4 — recalibrage de la confiance
- Les niveaux de confiance des adresses candidates sont désormais plus stricts.
- La récupération des annonces et le moteur de rapprochement restent inchangés.



## V1.20.3 — traçabilité des sources
- Affichage séparé du catalogue ChercherTrouver et de la source originale de l'annonce.
- Le moteur d'adresse et les sources publiques existantes restent inchangés.



## V1.20.2 — moteur d'adresse renforcé
- BDNB ajoutée comme source publique complémentaire pour les bâtiments.
- Recherche DPE élargie par adresse et commune.
- Secours BAN élargi pour les coordonnées difficiles.
- Les adresses restent des candidates techniques à vérifier.



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


## V1.17.0 — calibration du radar
- Séparation explicite entre **Score radar** et **Indice comportemental à 6 mois**.
- Classification des données : complètes / suffisantes / à compléter.
- Backtest historique : rapprochement exact corrigé avec numéro + rue normalisés et contrôle commune/CP.
- Le taux de base à 180 jours et le taux de correspondance exacte sont exposés pour distinguer une absence de ventes détectées d'un défaut de données.


## V1.18.0 — Radar sécurisé par preuves
Le Radar futur distingue désormais trois niveaux de preuve qui ne doivent plus être confondus :
1. **DPE confirmé à la même adresse** : le bonus énergétique n'est appliqué que lorsque l'adresse et l'unité sont suffisamment discriminées.
2. **Vente DVF à la même adresse** : l'historique du logement n'est confirmé que lorsqu'une mutation exacte peut être rattachée à l'unité ; une adresse exacte mais ambiguë reste non confirmée.
3. **Comparables DVF à proximité** : les mutations de la même adresse sont exclues de ce panier. Elles servent à l'historique, pas au calcul des comparables voisins.

### Nouveau score transparent /100
- Qualité des données : **15 points**
- Ancienneté de la dernière vente DVF confirmée : **15 points**
- DPE confirmé : **20 points**
- Type / surface / pièces par rapport aux comparables : **15 points**
- Terrain documenté à la même adresse : **5 points**
- Proximité et nombre de comparables distincts : **15 points**
- Historique DVF confirmé à la même adresse : **15 points**

Le score est un **indice de surveillance** et non une probabilité de vente. Chaque candidat affiche maintenant les preuves utilisées et les éléments qui expliquent son score.


## V1.22.0 — réorganisation du poste de pilotage
- Réorganisation visuelle complète sans modification des identifiants fonctionnels utilisés par les scripts.
- Navigation rapide sticky : Accueil, Radar, Prospects, Annonces, Sources, Laboratoire.
- Priorité donnée au travail commercial : tableau de bord → Radar → recherche → Prospects.
- Sources publiques, veille annonces, croisement DVF/DPE et laboratoire déplacés dans une zone secondaire.
- Responsive renforcé pour tablette/mobile.
