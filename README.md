# Hublot

Un hublot, c'est une fenêtre partagée : plusieurs personnes peuvent regarder
en même temps ce qui se passe derrière, et intervenir chacune à son tour sans
se gêner. C'est exactement le rôle de cet outil : un **unique navigateur
Chromium visible**, partagé entre plusieurs agents IA (et painteau lui-même),
où chaque agent a son propre onglet et n'agit jamais sur celui d'un autre.

## Pourquoi pas un MCP (type Playwright MCP) ?

Playwright MCP fonctionne bien pour un seul agent à la fois, mais deux
limites structurelles empêchent de l'utiliser pour plusieurs agents en
parallèle :

1. **Un seul agent "possède" la session de navigateur.** Aucun autre agent
   ne peut ouvrir un onglet ou agir en parallèle sans marcher sur les
   pieds du premier.
2. **Un MCP doit être déclaré avant le lancement de la session de l'agent.**
   Impossible d'en ajouter un à la volée quand un agent découvre en cours
   de tâche qu'il a besoin d'un navigateur.

Hublot contourne les deux : c'est un CLI ordinaire (comme `git` ou `curl`),
invocable à tout moment depuis l'outil Bash/PowerShell standard de n'importe
quel agent, sans configuration préalable.

## Architecture

```
hublot start   ──spawn détaché──▶  broker (Node.js)
                                     │
                                     ├─ launchPersistentContext (Chromium visible)
                                     │     • profil sur disque : cookies, autofill,
                                     │       gestionnaire de mots de passe natif
                                     ├─ un onglet technique toujours ouvert
                                     │     (garde le navigateur en vie même si
                                     │     tous les onglets "agents" sont fermés)
                                     └─ serveur TCP 127.0.0.1:47563 (JSON ligne par ligne)
                                            ▲
                                            │
        hublot open/click/type/...  ────────┘
              (n'importe quel agent, n'importe quand)
```

- **Un seul broker** possède le navigateur. Il tourne en tâche de fond,
  détaché du process qui l'a lancé (`hublot start` peut être appelé depuis
  n'importe quel terminal puis se terminer, le broker continue de vivre).
- **Chaque agent ouvre son propre onglet** via `--label` (ex.
  `claude-main`, `agent-debug`). Toutes ses commandes suivantes (`navigate`,
  `click`, `type`, `extract`, `screenshot`, `console`, `close`) sont
  scopées à ce label : deux agents ne peuvent jamais agir sur le même
  onglet par erreur.
- **La fenêtre reste réellement visible en permanence** (`headless: false`
  n'est pas une option, c'est une exigence produit) : painteau peut cliquer
  ou taper dans n'importe quel onglet à tout moment, typiquement pour saisir
  un mot de passe pendant qu'un agent travaille sur un autre onglet.
- **Communication par socket TCP localhost** (`127.0.0.1:47563`, JSON une
  ligne par requête/réponse) plutôt qu'un named pipe Windows : plus simple
  et plus portable en Node.js pur, sans dépendance native. N'écoute que sur
  `127.0.0.1`, jamais exposé au réseau.
- **Les captures d'écran sont écrites sur disque**, jamais renvoyées en
  mémoire à l'agent : `hublot screenshot` affiche juste le chemin absolu du
  PNG en stdout, à lire ensuite avec l'outil `Read` de l'agent.

### Persistance

- **Profil navigateur** : `%LOCALAPPDATA%/hublot/profile` (cookies,
  autofill, mots de passe enregistrés : tout ça vient gratuitement d'un
  profil Chromium persistant classique, rien à réinventer).
- **Table des onglets** : `%LOCALAPPDATA%/hublot/tabs.json`, réécrite à
  chaque changement. Au redémarrage du broker, les onglets connus sont
  rouverts avec leur `tabId` d'origine et leur dernière URL connue (le
  navigateur lui-même ne survit pas à l'arrêt du broker, seule la table
  label → onglet est reconstituée).
- **Logs du broker** : `%LOCALAPPDATA%/hublot/broker.log` (utile pour
  diagnostiquer un `hublot start` qui ne répond pas).
- **Captures d'écran** : `%TEMP%/hublot-screenshots/`.

## Installation

```bash
npm install
npm run build
```

Hublot réutilise en priorité le Chromium déjà installé sur la machine
(dans l'ordre : Google Chrome, puis Microsoft Edge). Si aucun des deux
n'est présent, ou si vous voulez isoler Hublot de vos navigateurs
installés, téléchargez le Chromium géré par Playwright :

```bash
npx playwright install chromium
```

(TODO : le code essaie d'abord `channel: 'chrome'`, puis `channel: 'msedge'`,
puis se rabat sur le Chromium Playwright ; ce dernier cas n'a pas été testé
en profondeur, faute de binaire disponible sur la machine de développement.)

## Commandes

Toutes les commandes après `start` échouent proprement (message clair, code
de sortie 1) si le broker ne répond pas.

```bash
# Démarre le broker si besoin (idempotent : ne fait rien s'il tourne déjà)
hublot start

# État du broker + liste des onglets ouverts (alias : hublot list)
hublot status

# Ouvre un onglet pour ce label (le réutilise s'il existe déjà)
hublot open --label claude-main --url "https://example.com"

# Navigue dans l'onglet du label
hublot navigate --label claude-main --url "https://example.com/page2"

# Clique sur un élément (sélecteur CSS Playwright)
hublot click --label claude-main --selector "button.submit"

# Saisit du texte dans un champ
hublot type --label claude-main --selector "input[name=q]" --text "recherche"

# Extrait le texte (innerText) d'un élément, ou de tout le body si --selector omis
hublot extract --label claude-main --selector ".result"

# Capture d'écran : écrit un PNG horodaté et affiche son chemin absolu
hublot screenshot --label claude-main

# Derniers logs console JS capturés depuis l'ouverture de l'onglet (borné à 500 entrées)
hublot console --label claude-main

# Ferme l'onglet de ce label (le navigateur, lui, reste ouvert)
hublot close --label claude-main

# Arrête complètement le broker et ferme le navigateur
hublot stop
```

### Convention d'usage multi-agents

Chaque agent doit utiliser un `--label` stable qui l'identifie (pas
seulement la tâche en cours), et le réutiliser pour toute la durée de son
travail plutôt que d'ouvrir un nouvel onglet à chaque commande. Objectif :
plusieurs agents en parallèle ne se marchent jamais dessus, même sur la
même machine.

## Distribution (exécutable + un dossier à côté)

Hublot se distribue sur le même principe que son outil sœur `beammeup` :
rien à installer sur la machine cible, pas de `npm install`. La forme
diffère légèrement : `build/hublot.exe` (Windows) ou `build/hublot` (Linux)
**plus un dossier `build/node_modules/` à côté** (voir "Limite du bundling"
ci-dessous pour pourquoi). Les deux doivent être distribués ensemble (même
dossier, même zip de release) — l'exécutable seul, sans ce dossier, échoue
au démarrage du broker.

Contrairement à BeamMeUp (Rust/Tauri), Hublot est du Node.js et utilise
donc le mode natif Node.js **Single Executable Applications (SEA)**,
disponible depuis Node 20 (marqué expérimental sur certaines versions ;
testé ici avec succès sur Node 25).

### Build local

```bash
npm install
npm run package
```

`npm run package` (défini dans `package.json`) enchaîne :

1. `npm run build` (compilation TypeScript classique, inchangée).
2. `node scripts/package-sea.mjs`, qui :
   - bundle `dist/cli/index.js` (+ tout ce qu'il importe, **sauf
     `playwright-core`**, voir "Limite du bundling") en un seul fichier
     CommonJS via **esbuild** (`build/sea-bundle.cjs`) : SEA exige un point
     d'entrée autonome, sans résolution de `node_modules` au runtime ;
   - génère la config et le blob SEA via
     `node --experimental-sea-config` (`build/sea-config.json`,
     `build/sea-prep.blob`) ;
   - copie le binaire `node` courant pour servir de socle
     (`build/hublot.exe` / `build/hublot`) ;
   - injecte le blob dans cette copie via **postject** (API
     programmatique, pas la CLI) ;
   - copie `node_modules/playwright-core` (aucune dépendance propre) dans
     `build/node_modules/playwright-core`.

Résultat testé en conditions réelles (session BeamMeUp visible, pas juste
en tâche de fond) : `build/hublot.exe start` lance un vrai Chromium visible,
`open`/`screenshot` fonctionnent sur une page réelle, sans Node.js ni
`npm install` sur la machine (l'exécutable embarque Node lui-même, le
dossier `node_modules/playwright-core` fournit le reste).

### Piège résolu : `hublot start` en mode empaqueté

`hublot start` spawn normalement un second process Node en pointant vers le
fichier compilé `dist/broker/index.js`. Un exécutable SEA n'a pas ce fichier
à côté de lui (tout est dans le blob embarqué) : spawner
`process.execPath` avec un chemin de fichier ne fonctionnerait pas. Le CLI
détecte ce mode via `node:sea`&nbsp;`isSea()` et, si c'est le cas, respawn
l'exécutable lui-même avec une commande cachée `__broker` (jamais listée
dans `--help`, jamais destinée à un usage manuel) qui exécute la même
logique broker (`runBroker()`, exportée depuis `src/broker/index.ts`) dans
le nouveau process. La distribution npm-install classique (`node
dist/cli/index.js`) n'est pas affectée : elle continue de spawner
`dist/broker/index.js` comme avant.

### Limite du bundling : `playwright-core` ne peut pas être fondu dans le blob

Plusieurs fichiers internes de `playwright-core` relisent leur propre
`package.json` via `require(path.join(__dirname, '..', 'package.json'))`.
Ça marche tel quel en distribution npm-install classique (`__dirname`
pointe vraiment vers `node_modules/playwright-core/lib`), mais une fois ces
fichiers fondus par esbuild dans un seul bundle, `__dirname` devient celui
du bundle final (`build/`), donc ce `require()` cherche `package.json` à
côté de l'exécutable au lieu du vrai fichier du paquet →
`ERR_UNKNOWN_BUILTIN_MODULE` au démarrage du broker en mode SEA. Constaté
à deux endroits différents (`lib/package.js` **et** une deuxième copie du
même motif à l'intérieur de `lib/coreBundle.js`, que Playwright embarque
déjà pré-empaqueté) : pas un cas isolé patchable fichier par fichier.

Solution retenue : `playwright-core` est marqué `external` dans esbuild
(jamais bundlé) et copié tel quel dans `build/node_modules/playwright-core`
(voir plus haut). Reste un piège : même un `require('playwright-core')`
"bare" (non bundlé) échoue en mode SEA, parce que le chargeur restreint de
SEA n'accepte que les modules déjà embarqués et les builtins Node — aucune
résolution disque automatique, même pour un module externe légitime.
`src/broker/playwrightCore.ts` contourne ça avec `createRequire(process.execPath)`
en mode SEA (détecté via `node:sea` `isSea()`), qui déclenche la résolution
CommonJS normale à partir du dossier de l'exécutable ; en distribution
npm-install classique, un `require()` ordinaire suffit.

### CI de release

- `.github/workflows/ci.yml` : build + packaging SEA sur Windows et Linux à
  chaque push/PR (vérification de compilation, pas de publication).
- `.github/workflows/release-windows.yml` : déclenché sur tag `vX.Y.Z`,
  build + package + publie une Release GitHub avec l'exécutable en asset.
  **Pas de signature Azure Trusted Signing pour l'instant** : les secrets
  (`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`) ne sont pas
  configurés côté Hublot. Un TODO explicite dans ce fichier indique où
  ajouter l'étape de signature (identique à celle de `beammeup`) une fois
  ces secrets créés. Sans signature, Windows SmartScreen affichera un
  avertissement « éditeur inconnu » au premier lancement.
- `.github/workflows/release-linux.yml` : même déclencheur, construit un
  `.deb` minimal (juste le binaire SEA copié dans `/usr/bin/hublot`, pas de
  dépendances) et le publie dans la même Release GitHub.
- `.github/workflows/publish-winget.yml` : squelette calqué sur celui de
  `beammeup`, déclenchement manuel uniquement. **Prérequis non rempli** :
  la première soumission à `microsoft/winget-pkgs` doit être faite à la
  main (`wingetcreate new`, PR ouverte et mergée) avant que ce workflow
  puisse fonctionner (voir le squelette de manifeste ci-dessous).
- `.github/workflows/publish-apt.yml` : squelette calqué sur celui de
  `beammeup`, **ne fonctionne pas tel quel**. beammeup publie via une clé
  SSH dédiée et restreinte côté serveur (commande forcée dans
  `authorized_keys` sur axolotl, limitée à un paquet nommé `beammeup`, sans
  shell ni lecture de fichiers). Hublot n'a pas encore cet accès configuré ;
  même discipline à reproduire (clé à part, jamais réutiliser celle de
  beammeup) avant d'activer ce workflow.

### Manifeste winget (squelette)

`manifests/b/Breizhzion/Hublot/0.1.0/` contient un squelette de manifeste
winget à 3 fichiers (version / installer / locale en-US), au format habituel
de `microsoft/winget-pkgs`. **Non soumis, non validé** : chaque fichier
contient un commentaire décrivant ce qu'il reste à faire (premier tag +
Release signée, `wingetcreate new` pour générer/valider proprement, PR
manuelle sur `microsoft/winget-pkgs`). Une fois cette première PR mergée,
`publish-winget.yml` peut prendre le relais à chaque nouveau tag.

## Limites connues (v0.1)

- Windows uniquement pour cette première version.
- `hublot type` utilise `locator.fill()` (remplacement direct de la valeur
  du champ), pas une saisie touche par touche : suffisant pour l'immense
  majorité des formulaires, mais ne déclenchera pas les gestionnaires
  `keydown`/`keypress` d'un champ qui en dépendrait spécifiquement.
- Le repli sur le Chromium téléchargé par Playwright (`npx playwright
  install chromium`) n'a pas pu être testé en conditions réelles sur la
  machine de développement (ni Chrome ni ce binaire n'y étaient
  disponibles) ; le repli sur Edge, lui, a été testé avec succès.
