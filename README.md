# JML Prospection

Application indépendante de prospection immobilière pour JML Immobilier.

## V1.4 — radar de signaux
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

### Règles actuelles du radar
Le score est volontairement transparent et basé uniquement sur les données déjà présentes :
- nouveau détecté ≤ 7 jours : +3
- fiche ancienne ≥ 60 jours : +2
- relance dépassée : +3
- DPE F ou G : +2
- terrain ≥ 1 000 m² : +2
- plusieurs mises à jour/sources : +3
- données essentielles manquantes : +1

Ce score n'est pas une probabilité de vente. Il sert uniquement à prioriser la revue des biens.

## Feuille de route
1. Carte Ardennes
2. Historique structuré des changements de prix et caractéristiques
3. Moteur de signaux enrichi
4. Connexion progressive aux sources publiques et données DPE
5. Pige et mises à jour automatiques, dans le respect du cadre légal et de la vie privée
6. Base distante / synchronisation multi-appareils

## Principe
Le projet travaille au niveau des biens et des informations publiquement accessibles. Il ne doit pas servir à réidentifier des particuliers à partir de données privées, de compteurs, de consommations ou de comptes personnels.
