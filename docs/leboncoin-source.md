# JML Prospection — source Leboncoin

## État

L'adaptateur leboncoin-source.js est isolé et n'est pas branché à une route HTTP ni à la collecte automatique. Les moteurs DVF/DPE et le CRM ne sont pas modifiés.

## Autorisation obligatoire

Les conditions générales Leboncoin interdisent l'extraction automatisée et l'utilisation de robots sans autorisation expresse et préalable. Ne pas activer ce connecteur avant d'avoir obtenu cette autorisation et reçu les informations du flux/API partenaire autorisé.

Une fois l'autorisation obtenue, configurer dans l'environnement serveur :

- LEBONCOIN_SOURCE_AUTHORIZED=true
- LEBONCOIN_FEED_URL=https://... — URL du flux/API communiqué ou autorisé par Leboncoin.

Ne jamais fournir un cookie de session personnel, contourner un CAPTCHA, imiter une session de navigateur, contourner un refus HTTP ou récupérer des données derrière une authentification non autorisée. En cas de refus ou de blocage, arrêter et contacter le fournisseur.

## Format de sortie

Les annonces sont normalisées en objets contenant source, URL, référence, prix affiché, surface, terrain, pièces, localisation, DPE, date de publication et provenance. Les données absentes restent null; aucun prix de vente signé n'est déduit du prix affiché.

Le flux doit être un JSON avec un tableau à la racine ou dans l'une de ces propriétés : items, results, ads, listings ou data. Le schéma réel du flux partenaire doit être confirmé avant activation.

## Tests locaux

Depuis la racine du dépôt :

\`\`\`sh
node --test tests/leboncoin-source.test.js
\`\`\`

Les tests utilisent des données fictives et un faux transport HTTP. Ils ne contactent pas Leboncoin.

## Intégration et déploiement

1. Obtenir et vérifier l'autorisation + le schéma du flux.
2. Exécuter les tests unitaires.
3. Tester en staging avec un flux autorisé et un petit échantillon.
4. Ajouter une route serveur protégée, journaliser l'état de collecte et les erreurs sans stocker de données personnelles inutiles.
5. Tester l'import, le dédoublonnage et la séparation entre prix affiché et ventes DVF.
6. Seulement après validation, activer la source en production.

Aucune modification du moteur DVF, DPE ou CRM n'est requise pour cette première brique.
