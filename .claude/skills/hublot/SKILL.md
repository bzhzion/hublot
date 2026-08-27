---
name: hublot
description: >
  Pilote Hublot (`hublot.exe`/`hublot`), l'outil qui donne à l'agent et à painteau un navigateur
  Chromium visible partagé en temps réel, avec un onglet par agent. À utiliser dès qu'une tâche a
  besoin de naviguer, cliquer, remplir un formulaire ou extraire du contenu d'une page web — à la
  place du MCP Playwright classique, qui ne supporte qu'un seul agent propriétaire à la fois et
  doit être déclaré avant le lancement de la session (impossible d'en ajouter un à la volée). Ce
  skill est versionné dans le repo `bzhzion/hublot` : le mettre à jour dans le même commit que
  tout changement de CLI, pas après coup.
---

# Hublot : piloter le navigateur partagé

Hublot est un CLI ordinaire (comme `git` ou `curl`), invocable à tout moment depuis l'outil
Bash/PowerShell de n'importe quel agent, sans rien à préconfigurer. Un unique broker possède un
Chromium **réellement visible** (jamais headless) ; chaque agent ouvre son propre onglet via un
`--label` de son choix et n'agit jamais sur celui d'un autre. Painteau garde toujours la
possibilité de cliquer/taper directement dans la fenêtre (typiquement pour un mot de passe),
puisqu'elle reste affichée à l'écran en permanence.

`hublot --help` et `hublot <commande> --help` restent la source de vérité exacte, toujours
synchronisée avec le binaire réellement installé. Ce skill donne le contexte que l'aide intégrée
ne peut pas donner : quand utiliser quoi, et les pièges déjà rencontrés.

## Prérequis

Le binaire n'est pas encore distribué (pas de winget, pas de Release GitHub) : construire depuis
les sources dans `D:/git/hublot` :

```
npm install
npm run build
npm run package
```

`build/hublot.exe` + `build/node_modules/playwright-core` (les deux ensemble, jamais l'exe seul)
sont alors utilisables. Utiliser le chemin complet si `hublot` n'est pas sur le PATH.

## Flux de base

1. **Démarrer le broker** (idempotent, ne fait rien s'il tourne déjà) :
   ```
   hublot start
   ```
2. **Ouvrir un onglet avec un label stable qui identifie l'agent**, pas la tâche en cours :
   ```
   hublot open --label claude-main --url "https://example.com"
   ```
3. **Piloter la page** : `navigate`, `back`, `click`, `hover`, `type`, `press`, `select`, `drag`,
   `upload`, `dialog`, `wait`, `find`, `evaluate`, `resize`.
4. **Lire le résultat** :
   - `extract` pour du texte brut (innerText).
   - `snapshot` (arbre d'accessibilité) pour repérer un élément de façon fiable — souvent
     préférable à un screenshot quand il s'agit de retrouver un rôle/nom plutôt que de "voir".
   - `screenshot` écrit un PNG horodaté sur disque et affiche son chemin absolu en stdout — le
     relire ensuite avec l'outil `Read` de l'agent, jamais renvoyé en mémoire directement.
   - `console`/`network` pour les logs JS/requêtes capturés depuis l'ouverture de l'onglet.
5. **Fermer proprement** : `hublot close --label claude-main` ferme uniquement cet onglet.
   `hublot stop` ferme tout le navigateur pour tous les agents — ne jamais l'utiliser par réflexe
   à la place de `close`.

## Convention multi-agents

Chaque agent garde un `--label` stable qui **l'identifie lui**, pas la tâche en cours
(`claude-main`, pas `task-1234`), et le réutilise pour toute sa session au lieu d'ouvrir un nouvel
onglet à chaque commande. C'est ce qui garantit que plusieurs agents en parallèle, même sur la
même machine, ne se marchent jamais dessus.

## Pièges déjà rencontrés

- **`hublot type` remplace la valeur du champ (`.fill()`), ne simule pas de vraies frappes
  clavier** : ça ne déclenche pas les handlers `keydown`/`keyup`/`input` qui écoutent spécifiquement
  une touche. Utiliser `hublot press --selector ... --key X` quand ce comportement compte.
- **Un `screenshot` ne capture que le contenu de la page, jamais l'interface du navigateur**
  (barre d'adresse, bulles natives comme "Enregistrer le mot de passe ?"). Ces éléments-là ne sont
  visibles/cliquables que par painteau directement dans la fenêtre, jamais via une commande Hublot.
- **Google (et la plupart des IdP) bloquent la connexion depuis un navigateur piloté par CDP**
  ("this browser or app may not be secure") — comportement normal de Google face à tout outil
  d'automatisation (Playwright/Puppeteer/Selenium inclus), pas un bug de Hublot. Ne pas chercher à
  contourner ça ; c'est un mur volontaire côté fournisseur d'identité.
- **`run-code-unsafe` exécute du code dans le process du broker lui-même** (accès Node complet :
  `fs`, `child_process`, tout ce qu'un process Node peut faire), **pas** dans le bac à sable JS de
  la page comme `evaluate`. Réservé à un usage explicitement demandé par painteau — ne jamais s'en
  servir par réflexe pour remplacer `evaluate`, qui couvre déjà l'immense majorité des besoins JS.
- **`hublot web on` expose une page de visualisation en direct sur le réseau** (même principe que
  `beammeup web on`) : fermé par défaut, ne jamais l'activer à la place de painteau sans qu'il le
  demande explicitement, et toujours utiliser son IP Tailscale plutôt que `0.0.0.0`.
- **Le profil persistant (cookies/mots de passe/sessions) vit sous `%LOCALAPPDATA%\hublot\profile`**,
  indépendant de la version de l'exécutable : mettre à jour Hublot ne fait jamais perdre les
  sessions déjà ouvertes. Les cookies *session* (sans expiration explicite) ne survivent en
  revanche jamais à un `hublot stop` complet — comportement standard de tout navigateur, pas une
  limite de Hublot.
- **Le broker accepte des connexions dès qu'il écoute, avant que le navigateur soit prêt.** `hublot
  start` attend explicitement que le navigateur soit opérationnel avant de rendre la main : ne pas
  contourner ça en enchaînant `start &` en tâche de fond suivi immédiatement d'une autre commande.

## Commandes disponibles (résumé)

`start` · `stop` · `status` (alias `list`) · `open` · `navigate` · `back` · `click` · `hover` ·
`type` · `press` · `select` · `drag` · `upload` · `dialog` · `wait` · `find` · `evaluate` ·
`run-code-unsafe` · `resize` · `extract` · `snapshot` · `screenshot` · `console` · `network` ·
`close` · `web`.

Détail complet de chaque commande, avec exemples et toutes les options, dans le `README.md` du
repo `bzhzion/hublot`.
