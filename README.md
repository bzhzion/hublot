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

# Revient a la page precedente
hublot back --label claude-main

# Clique sur un élément (sélecteur CSS Playwright)
hublot click --label claude-main --selector "button.submit"

# Survole un élément (hover, ex: pour faire apparaitre un menu)
hublot hover --label claude-main --selector "nav .menu-trigger"

# Saisit du texte dans un champ
hublot type --label claude-main --selector "input[name=q]" --text "recherche"

# Presse une touche (Enter, Tab, Escape...), sur un élément ou globalement
hublot press --label claude-main --selector "input[name=q]" --key Enter

# Sélectionne une option dans un <select>
hublot select --label claude-main --selector "#pays" --value "FR"

# Glisse-dépose un élément vers un autre
hublot drag --label claude-main --source "#carte-1" --target "#colonne-2"

# Envoie un fichier dans un <input type=file>
hublot upload --label claude-main --selector "input[type=file]" --files "C:\chemin\fichier.pdf"

# Definit comment cet onglet repond aux dialogues JS (alert/confirm/prompt).
# Par defaut : dismiss (comportement natif Playwright sans ecouteur explicite).
hublot dialog --label claude-main --action accept

# Attend explicitement l'apparition d'un élément ou d'un texte
hublot wait --label claude-main --text "Chargement termine"
hublot wait --label claude-main --selector ".result" --timeout-ms 10000

# Trouve les éléments contenant un texte, sans deviner un sélecteur CSS
hublot find --label claude-main --text "Ajouter au panier"

# Exécute du JavaScript arbitraire dans la page et affiche le résultat (JSON)
hublot evaluate --label claude-main --expression "document.title"

# Redimensionne le viewport de cet onglet
hublot resize --label claude-main --width 1280 --height 800

# Extrait le texte (innerText) d'un élément, ou de tout le body si --selector omis
hublot extract --label claude-main --selector ".result"

# Arbre d'accessibilité de la page (rôles/noms) : plus fiable qu'un
# screenshot pour qu'un agent repère un élément sans deviner un sélecteur
hublot snapshot --label claude-main

# Capture d'écran : écrit un PNG horodaté et affiche son chemin absolu
hublot screenshot --label claude-main

# Derniers logs console JS capturés depuis l'ouverture de l'onglet (borné à 500 entrées)
hublot console --label claude-main

# Dernières requêtes réseau capturées (méthode, statut, URL — borné à 500 entrées)
hublot network --label claude-main

# Ferme l'onglet de ce label (le navigateur, lui, reste ouvert)
hublot close --label claude-main

# Arrête complètement le broker et ferme le navigateur
hublot stop
```

Toutes ces commandes ont été testées en conditions réelles (pas juste compilées) sur une page
locale : `select`/`hover`/`press`/`drag`/`upload`/`dialog`/`wait`/`find`/`evaluate`/`back`/
`resize`/`network`/`snapshot` produisent bien l'effet attendu sur un vrai Chromium.

### Accès web distant (optionnel, fermé par défaut)

Même principe que `beammeup web on|off|status` : une petite page mobile qui affiche la capture
d'écran de l'onglet choisi, rafraîchie en boucle (polling, pas de WebSocket, pour rester simple
et auditable).

```bash
# Active l'accès sur cette adresse:port (jeton auto-généré, imprimé dans l'URL affichée)
hublot web on --bind 100.x.x.x:9871

# Désactive un jeton (accès ouvert à qui joint cette adresse — à vos risques)
hublot web on --bind 100.x.x.x:9871 --no-token

# État actuel
hublot web status

# Coupe l'accès
hublot web off
```

Testé en conditions réelles : rejet `401` sans jeton, page/`/tabs`/`/screenshot` accessibles avec
le bon jeton, sélecteur d'onglet fonctionnel, et l'accès **redémarre automatiquement dans le même
état** (même bind, même jeton) si le broker est relancé — les réglages persistent dans
`%LOCALAPPDATA%\hublot\remote.json`, même mécanisme que `beammeup`.

⚠️ Aucune restriction côté code sur l'adresse d'écoute (`0.0.0.0` fonctionnerait si demandé
explicitement), mais ni ce README ni un agent ne doivent choisir ça à ta place : utilise ton IP
Tailscale, jamais `0.0.0.0`, sauf besoin explicite et assumé.

### ⚠️ `run-code-unsafe` : accès Node complet, pas juste au DOM de la page

```bash
# Le code recoit (page, context) et tourne dans le process du broker lui-meme
hublot run-code-unsafe --label claude-main --code "async (page) => { return await page.title(); }"
hublot run-code-unsafe --label claude-main --file mon-script.js
```

À la différence d'`evaluate` (JS confiné au bac à sable de la page, aucun accès au système),
`run-code-unsafe` exécute le code **dans le process Node du broker** : accès complet à l'API
Playwright (`page`, `context`, `BrowserContext` entier) et, par transitivité, à tout ce que Node
peut faire (`fs`, `child_process`, réseau arbitraire...). Testé en conditions réelles : `page.title()`
(API Playwright) et un vrai `require('fs').existsSync(...)` fonctionnent tous les deux. C'est un
choix assumé pour un usage personnel sur une machine déjà de confiance — quiconque détient le
jeton d'auth peut exécuter du code arbitraire sous le compte Windows du broker. Voir
`docs/hublot.md` (registre d'audit, section "risque accepté") dans le repo admin.

### Ce qui manque encore par rapport à Playwright MCP

Volontairement pas repris : le remplissage groupé multi-champs (`browser_fill_form` — `type`/
`select` un par un couvrent le même besoin, juste sans le batching). `browser_tabs` n'a pas
d'équivalent direct non plus : le modèle de Hublot (un onglet = un `--label` choisi par
l'appelant) remplace déjà le besoin de lister/nommer les onglets dynamiquement.

### Convention d'usage multi-agents

Chaque agent doit utiliser un `--label` stable qui l'identifie (pas
seulement la tâche en cours), et le réutiliser pour toute la durée de son
travail plutôt que d'ouvrir un nouvel onglet à chaque commande. Objectif :
plusieurs agents en parallèle ne se marchent jamais dessus, même sur la
même machine.

## Distribution

Contrairement à BeamMeUp (Rust/Tauri), Hublot est du Node.js et utilise le
mode natif Node.js **Single Executable Applications (SEA)**, disponible
depuis Node 20 (marqué expérimental sur certaines versions ; testé ici avec
succès sur Node 25) pour produire `build/hublot.exe`. Ce dernier doit
toujours être accompagné d'un dossier `build/node_modules/playwright-core`
(voir "Limite du bundling" ci-dessous pour pourquoi) — jamais l'exe seul.

Un installateur Windows (`installer.iss`, **Inno Setup**, même outil que
`justmakeQ`, pas de toolchain Rust/Tauri à introduire) embarque les deux
dans un seul fichier `hublot-<version>-x64-setup.exe` : ajoute Hublot au
PATH utilisateur (case cochée par défaut, décochable), fournit un
désinstalleur propre. Construit et testé en conditions réelles (installation
silencieuse `/CURRENTUSER /VERYSILENT`, exécution de l'exe installé,
désinstallation avec retrait effectif du PATH et des fichiers) :

```powershell
npm run package
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
# -> build\hublot-0.0.0-dev-x64-setup.exe (APP_VERSION non défini localement)
```

Piège rencontré en testant réellement une installation silencieuse (pas
une hypothèse) : `PrivilegesRequiredOverridesAllowed` doit inclure
`commandline` en plus de `dialog`, sinon `/CURRENTUSER`/`/ALLUSERS` sont
ignorés et l'installateur affiche quand même la boîte "Select Setup Install
Mode" même avec `/VERYSILENT` — le processus reste bloqué indéfiniment sans
qu'aucune erreur n'apparaisse. Piège Git Bash à part (pas Inno Setup) :
un argument commençant par `/` s'y fait convertir en chemin Windows,
d'où `MSYS_NO_PATHCONV=1` nécessaire pour tester `/CURRENTUSER` depuis
ce shell précis.

Les métadonnées Windows de l'exe (société, produit, description, copyright,
icône) sont réécrites via **rcedit** dans `scripts/package-sea.mjs` — sans
ça, l'exécutable affiche "Node.js" partout (Explorateur, gestionnaire des
tâches) puisqu'il n'est au départ qu'une copie renommée du binaire `node`.
`hublot.exe` et l'installateur sont signés (**Azure Trusted Signing**, même
Service Principal partagé que `beammeup`/`justmakeQ`/`hae-app`).

Sur Linux, même dépôt apt maison que `beammeup` (`apt.breizhzion.com`) :

```bash
sudo curl -fsSL https://apt.breizhzion.com/KEY.gpg -o /usr/share/keyrings/breizhzion.asc
echo "deb [signed-by=/usr/share/keyrings/breizhzion.asc] https://apt.breizhzion.com stable main" \
  | sudo tee /etc/apt/sources.list.d/breizhzion.list
sudo apt update && sudo apt install hublot
```

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
  build + package + signe `hublot.exe` puis l'installateur produit par Inno
  Setup (**Azure Trusted Signing**, même Service Principal partagé que
  `beammeup`/`justmakeq`/`hae-app` — `breizhzion-signing` /
  `breizhzion-public`, voir `docs/azure.md` du repo admin) + publie une
  Release GitHub avec l'installateur signé en asset.
- `.github/workflows/release-linux.yml` : même déclencheur, construit un
  `.deb` minimal (juste le binaire SEA copié dans `/usr/bin/hublot`, pas de
  dépendances) et le publie dans la même Release GitHub.
- `.github/workflows/publish-winget.yml` : squelette calqué sur celui de
  `beammeup`, déclenchement manuel uniquement. **Prérequis non rempli** :
  la première soumission à `microsoft/winget-pkgs` doit être faite à la
  main (`wingetcreate new`, PR ouverte et mergée) avant que ce workflow
  puisse fonctionner (voir le squelette de manifeste ci-dessous).
- `.github/workflows/publish-apt.yml` : publie le `.deb` sur
  `apt.breizhzion.com` via une clé SSH **dédiée et restreinte côté
  serveur** (commande forcée `~/bin/hublot-apt-publish.sh` dans
  `authorized_keys` sur axolotl, limitée au paquet `hublot`, sans shell ni
  lecture de fichiers — même discipline que `beammeup`, clé distincte).
  Testé en conditions réelles le 2026-08-27 : `apt install hublot`
  fonctionnel.

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
