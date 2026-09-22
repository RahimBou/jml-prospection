# JML Prospection — V1.11.0

## Version de référence
- Version : **1.6.2**
- Branche : **main**
- Application : jml-prospection
- Architecture : Node.js + interface web
- Déploiement : Render avec auto-deploy
- Sources connectées : ADEME DPE, DVF+ Cerema, API Adresse

- V1.6.2 : ajout d’un fallback de résolution des communes lorsque l’API Adresse est indisponible.\n\n## Règle de travail
Toute modification fonctionnelle doit :
1. incrémenter la version si elle change le comportement ;
2. afficher la version dans l’interface ;
3. être documentée dans le README ;
4. conserver les versions précédentes dans l’historique Git.

## Versions
- V1.5.x : prototype navigateur, historique des prix et radar.
- V1.6.2 : backend Node, premières connexions aux sources publiques et recherche DPE/DVF+.

## V1.10.0 — JML Data Agent
- Ajout du contrôle qualité serveur des données ADEME/DVF.
- Rejet des enregistrements manifestement incohérents avant analyse.
- Détection des conflits de surface entre sources.
- Rapport de qualité visible dans l'interface.


## V1.10.1 — Comparaison des surfaces
- Séparation explicite des surfaces : **habitable**, **bâtie** et **terrain**.
- Le Data Agent ne compare plus une surface habitable DPE avec une surface bâtie DVF.
- Les conflits de surface ne sont signalés que lorsque les surfaces comparées sont de même nature.
- Une divergence entre surface habitable, surface bâtie et terrain reste une différence de définition, pas une anomalie.


## V1.10.2 — Faux conflits de même source
- Une même source peut contenir plusieurs historiques d'un même bien.
- Le Data Agent ne traite plus ces historiques comme plusieurs sources indépendantes.
- Un conflit de surface n'est signalé que si plusieurs sources fournissent la même nature de surface et divergent de plus de 25 %.


## V1.10.3 — Rapprochement DPE ↔ DVF
- Rapprochement hiérarchisé : **numéro + rue + commune/CP**, puis **rue + commune/CP**, puis **code postal** si l'échantillon est suffisamment discriminant.
- Ajout d'un niveau de rapprochement par **proximité géographique ≤ 80 m** lorsque les coordonnées sont disponibles.
- Exploitation des coordonnées DPE/BAN et des coordonnées longitude/latitude DVF lorsqu'elles sont présentes.
- Les correspondances secondaires ne reçoivent plus les mêmes points qu'une correspondance exacte.
- Le radar expose le niveau et le motif de rapprochement.


## V1.10.4 — Correction radar

- Correction du bug `streetOnly is not defined`.
- Le radar utilise désormais directement le niveau de rapprochement calculé par le moteur DPE ↔ DVF.

## V1.10.5 — Rapprochement DPE ↔ DVF renforcé
- Normalisation des numéros et types de voies.
- Ajout d'un rapprochement par adresse normalisée.
- Ajout d'un rapprochement rue seul, uniquement lorsque l'échantillon reste limité.
- Le radar conserve les niveaux exact / rue / postal / proximité / aucun.


## V1.10.6 — Nettoyage des adresses
- Retrait du code postal et de la commune lorsqu'ils sont inclus dans l'adresse BAN brute.
- Amélioration du rapprochement DPE ↔ DVF lorsque les sources formatent différemment la même adresse.


## V1.10.7 — Correction syntaxe
- Réécriture propre de la normalisation d'adresse pour éviter l'erreur JavaScript de V1.10.6.
- L'ordre de définition des champs postal/commune est corrigé.


## V1.11.0 — Moteur de comparables locaux
- Le Radar n'attribue plus automatiquement une mutation DVF précise à un logement DPE.
- Sélection de comparables géographiques dans des rayons progressifs de 100 m, 250 m puis 500 m.
- Filtrage par type de bien, surface, pièces, distance, récence et cohérence du prix au m².
- Médiane locale, dispersion, distance médiane et nombre de comparables exposés dans le Radar.
- Les données d'adresse restent des éléments de contexte ; les ventes voisines sont traitées comme des comparables et non comme l'historique certain du logement.
- DVF géolocalisé fournit notamment type de local, surface bâtie, pièces, lots, prix, date et coordonnées géographiques, ce qui permet ce calcul spatial.
