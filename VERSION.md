# JML Prospection — V1.6.2

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
