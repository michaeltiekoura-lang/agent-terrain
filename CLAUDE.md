# AgriAccès — Agent Terrain

Instructions pour l'agent IA qui modifie ce dépôt.

## Le projet

Application web progressive (PWA) en français pour les agents terrain
d'AgriAccès Côte d'Ivoire : collecte, suivi des producteurs et rapports de
performance. Aucune étape de build, aucune dépendance : les fichiers sont
servis tels quels.

- `index.html` : toute l'application (HTML, CSS et JavaScript dans un seul fichier).
- `sw.js` : service worker (cache hors ligne et notifications push).
- `manifest.json` : manifeste PWA (les icônes y sont intégrées en base64, d'où sa taille).
- `icon.svg` : icône de l'application.

## Règles

- Rédiger les textes de l'interface, les messages de commit et les réponses en français.
- Garder l'application en un seul fichier `index.html` ; ne pas ajouter de framework,
  de bundler ni de dépendance externe sans demande explicite.
- **À chaque modification de `index.html`, `manifest.json` ou `icon.svg`, incrémenter
  `CACHE_NAME` dans `sw.js`** (ex. `agriacces-v1` → `agriacces-v2`). Le service worker
  sert les fichiers depuis le cache : sans ce changement, les utilisateurs ne
  recevront pas la mise à jour.
- Ne pas réécrire les images base64 de `manifest.json` ou `index.html` sauf demande explicite.
- Faire des changements ciblés : ne pas reformater ni réorganiser le code non concerné.
- Avant de terminer, vérifier que le JavaScript modifié n'a pas d'erreur de syntaxe.
