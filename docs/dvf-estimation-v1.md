# Moteur d'estimation DVF V1 — JML Prospection

Cette V1 est déterministe, traçable et sans dépendance externe. Elle n'utilise ni annonces, ni DPE, ni machine learning.

## Source DVF

L'importeur utilise l'index officiel Etalab « DVF géolocalisées » :
`https://files.data.gouv.fr/geo-dvf/latest/csv/2024/communes/08/`

L'index est vérifié par téléchargement avant de sélectionner les fichiers communaux `.csv`. Les fichiers communaux sont téléchargés séquentiellement pour limiter la charge. Le millésime de source est indiqué dans le résultat d'import. Pour importer un fichier local, fournir le chemin CSV au script.

## Commandes

- Tests : `npm test`
- Import officiel : `npm run import:dvf`
- Import d'un CSV local : `node scripts/import-dvf.js --input ./chemin/vers/dvf.csv`
- Fichier de sortie : `data/dvf-08.json`
- Backtest : `npm run backtest:dvf`
- Autre chemin de données : `DVF_DATA=/chemin/dvf-08.json npm run backtest:dvf`

Le fichier d'import est une donnée générée locale et ne doit pas être ajouté au dépôt.

## API privée

Route : `POST /api/estimate`

En-tête requis : `Authorization: Bearer <JML_API_TOKEN>`

Exemple de corps JSON :
```json
{
  "type": "Maison",
  "surface": 100,
  "terrain": 450,
  "rooms": 5,
  "latitude": 49.77,
  "longitude": 4.72,
  "commune": "Charleville-Mézières"
}
```

La route est refusée si `JML_API_TOKEN` n'est pas configuré. Limite en mémoire : 20 requêtes par minute et par adresse IP apparente. En déploiement derrière un proxy, vérifier que `X-Forwarded-For` est fourni par le proxy et non contrôlable directement par un client.

Ajouter dans Render, dans les variables d'environnement du service API :
- `JML_API_TOKEN` : une valeur aléatoire longue et secrète.

Le secret ne doit jamais être intégré au navigateur ou au dépôt. La route renvoie 503 tant que `data/dvf-08.json` n'a pas été importé sur le serveur.

## Limites connues

- La V1 est un premier filtre statistique, pas une expertise immobilière.
- Les ventes DVF peuvent porter sur plusieurs biens, et les informations publiques ne décrivent pas l'état intérieur, les travaux ou les nuisances.
- L'importeur exclut les mutations ayant plusieurs logements distincts pour éviter d'attribuer arbitrairement le prix total à un seul logement.
- Les ventes doivent comporter prix, surface bâtie, date, commune et coordonnées valides.
- L'ajustement temporel n'est appliqué que si l'échantillon contient au moins 12 ventes sur au moins 12 mois ; il est plafonné à ±15 %. Il s'agit d'une hypothèse prudente, pas d'un indice officiel.
- Le backtest doit être exécuté sur des données importées et ses résultats doivent être examinés avant tout usage client.
- Le jeu DVF importé est un artefact de déploiement : il doit être généré ou transféré explicitement sur l'environnement hébergé.
- Mention client : « Estimation indicative, ne remplace pas une expertise ».
