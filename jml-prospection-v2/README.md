# JML Prospection V2

Reconstruction propre du moteur de prospection JML Immobilier.

## Principes
- Aucun code V1/V1.40 réutilisé.
- Backend Node.js natif, sans dépendance npm.
- Sources publiques séparées du moteur métier.
- Les annonces en ligne, les signaux DVF/DPE et la mémoire du marché sont traités séparément.
- Une disparition d'annonce n'est jamais interprétée automatiquement comme une vente.
- Les opportunités cachées sont présentées comme des adresses à vérifier sur le terrain, jamais comme une intention de vente certaine.

## Structure
- `server.js` : API et serveur HTTP
- `src/sources.js` : connecteurs de données publiques
- `src/market-engine.js` : normalisation, déduplication et signaux
- `public/index.html` : interface
- `public/app.js` : interface et appels API
- `public/styles.css` : style

## Démarrage
```bash
npm start
```

Port : `10000` par défaut.
