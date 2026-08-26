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
  autofill, mots de passe enregistrés — tout ça vient gratuitement d'un
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
puis se rabat sur le Chromium Playwright — ce dernier cas n'a pas été testé
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
