# Agent réseaux sociaux

Un agent IA (Claude) qui :

- **traite vos requêtes** en langage naturel : « écris un post LinkedIn sur notre rapport du trimestre », « raccourcis le post 3f2a1b9c pour X », « qu'est-ce qui est prévu jeudi ? » ;
- **prépare le contenu de chaque semaine** : thème, objectifs, créneaux répartis par réseau, puis un brouillon adapté à chaque plateforme (texte, hashtags, brief du visuel ou script vidéo) ;
- **gère vos comptes** Facebook, Instagram, LinkedIn, X (et TikTok en manuel) : file de validation, puis publication à l'heure prévue.

Vous gardez la main : l'agent crée des **brouillons**, seul vous pouvez les **approuver**, et rien n'est publié tant que le mode simulation est actif.

## Installation

```bash
cd social-agent
npm install
cp .env.example .env      # puis renseignez ANTHROPIC_API_KEY
```

Node.js 22.9 ou plus récent.

## Configurer votre marque

Modifiez `config/brand.json` : description, audiences, ton, piliers de contenu, interdits, hashtags et, pour chaque réseau, `enabled` et `posts_per_week`. L'agent s'y réfère à chaque requête.

## Utilisation

```bash
npm run plan               # prépare la semaine prochaine (ou : npm run plan -- 2026-W44)
npm run chat               # conversation avec l'agent + validation
```

Dans le chat, tout texte part à l'agent ; les commandes commençant par `/` sont les vôtres :

| Commande | Effet |
|---|---|
| `/posts [statut] [semaine]` | liste les posts |
| `/voir <id>` | affiche un post en entier |
| `/approuver <id> …` | approuve des brouillons |
| `/approuver-semaine 2026-W43` | approuve tous les brouillons d'une semaine |
| `/rejeter <id> [motif]` | rejette (demandez ensuite à l'agent de le retravailler) |
| `/publier-dus` | publie les posts approuvés dont l'heure est passée |

Cycle hebdomadaire conseillé : le vendredi `npm run plan`, relecture et corrections avec l'agent, approbation, puis publication automatique.

## Publication automatique

`npm run publish-due` publie les posts approuvés dont l'heure est passée. Planifiez-le, par exemple toutes les 15 minutes avec cron :

```cron
*/15 * * * * cd /chemin/vers/social-agent && npm run publish-due >> publish.log 2>&1
0 8 * * 5    cd /chemin/vers/social-agent && npm run plan -- >> plan.log 2>&1
```

## Connecter les comptes

Renseignez dans `.env` les identifiants des réseaux, puis passez `SOCIAL_DRY_RUN=false`. Un réseau sans identifiants reste en simulation.

| Réseau | Variables | Ce qu'il faut |
|---|---|---|
| Facebook | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN` | App Meta, jeton de Page avec `pages_manage_posts` |
| Instagram | `INSTAGRAM_USER_ID`, `INSTAGRAM_TOKEN` | Compte professionnel lié à la Page, `instagram_content_publish` ; chaque post exige une image publique (`media_url`) |
| LinkedIn | `LINKEDIN_AUTHOR_URN`, `LINKEDIN_TOKEN` | App LinkedIn avec `w_organization_social` |
| X | `X_USER_ACCESS_TOKEN` | Jeton OAuth 2.0 utilisateur avec `tweet.write` (offre API payante) |
| TikTok | — | Publication manuelle : l'agent fournit script et légende |

## Structure

```
config/brand.json        profil de la marque et comptes
src/agent.js             boucle Claude (outils + recherche web)
src/tools.js             outils de l'agent (plan, brouillons, publication)
src/platforms/index.js   connecteurs Facebook, Instagram, LinkedIn, X, TikTok
src/store.js             stockage JSON (data/db.json)
src/cli.js               chat, planification, publication
```

Modèle utilisé : `claude-opus-5-5` (modifiable avec `SOCIAL_AGENT_MODEL`).
