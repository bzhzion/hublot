# Hublot

Un navigateur Chromium **visible**, partagé en temps réel entre vous et un ou plusieurs agents IA.
Chaque agent travaille dans son propre onglet, vous voyez tout ce qu'il fait et pouvez reprendre la
main à tout moment, par exemple pour saisir un mot de passe.

Hublot est un programme en ligne de commande ordinaire, comme `git` ou `curl` : un agent l'appelle
depuis son shell quand il en a besoin, sans serveur MCP à déclarer avant le lancement de sa session.

## Installation

### Windows

Téléchargez l'installateur depuis [hublot.breizhzion.com](https://hublot.breizhzion.com) ou la
[dernière release](https://github.com/bzhzion/hublot/releases/latest). Il ajoute `hublot` au `PATH`.

### Linux (Debian/Ubuntu)

```bash
sudo curl -fsSL https://apt.breizhzion.com/KEY.gpg -o /usr/share/keyrings/breizhzion.asc
echo "deb [signed-by=/usr/share/keyrings/breizhzion.asc] https://apt.breizhzion.com stable main" \
  | sudo tee /etc/apt/sources.list.d/breizhzion.list
sudo apt update && sudo apt install hublot
```

### Navigateur utilisé

Hublot utilise Google Chrome s'il est installé, sinon Microsoft Edge. À défaut, installez le
Chromium de Playwright :

```bash
npx playwright install chromium
```

## Utilisation

Chaque commande (sauf `start`, `status`, `stop` et `web`) prend un `--label` qui désigne l'onglet de
l'appelant. Un agent choisit un label qui l'identifie et le garde pendant tout son travail : deux
agents ne peuvent ainsi jamais agir sur le même onglet.

```bash
hublot start                       # démarre le navigateur (ne fait rien s'il tourne déjà)
hublot status                      # état et liste des onglets (alias : list)
hublot open --label moi --url "https://example.com"
hublot close --label moi           # ferme l'onglet, le navigateur reste ouvert
hublot stop                        # ferme tout
```

### Naviguer et agir

```bash
hublot navigate --label moi --url "https://example.com/page2"
hublot back     --label moi
hublot click    --label moi --selector "button.submit"
hublot hover    --label moi --selector "nav .menu"
hublot type     --label moi --selector "input[name=q]" --text "recherche"
hublot press    --label moi --selector "input[name=q]" --key Enter
hublot select   --label moi --selector "#pays" --value "FR"
hublot drag     --label moi --source "#carte-1" --target "#colonne-2"
hublot upload   --label moi --selector "input[type=file]" --files "C:\chemin\fichier.pdf"
hublot dialog   --label moi --action accept     # réponse aux alert/confirm/prompt (défaut : dismiss)
hublot wait     --label moi --text "Terminé"    # ou --selector, avec --timeout-ms
hublot resize   --label moi --width 1280 --height 800
```

Les sélecteurs sont ceux de Playwright. Pour viser un élément dans une `<iframe>`, ajoutez
`--frame` suivi d'un morceau de l'URL de la frame.

`hublot type` remplace la valeur du champ d'un coup au lieu de taper touche par touche : un champ
qui réagit à chaque frappe peut ne pas le voir.

### Lire la page

```bash
hublot find       --label moi --text "Ajouter au panier"   # trouve un élément par son texte
hublot extract    --label moi --selector ".result"         # texte d'un élément (ou de la page)
hublot snapshot   --label moi                              # arbre d'accessibilité
hublot screenshot --label moi                              # écrit un PNG et affiche son chemin
hublot console    --label moi                              # derniers messages de la console JS
hublot network    --label moi                              # dernières requêtes réseau
hublot evaluate   --label moi --expression "document.title"
```

### `run-code-unsafe`

```bash
hublot run-code-unsafe --label moi --code "async (page) => await page.title()"
hublot run-code-unsafe --label moi --file mon-script.js
```

⚠️ Contrairement à `evaluate`, qui s'exécute dans la page, ce code tourne dans le processus de
Hublot avec l'API Playwright complète et tous les droits de Node.js (fichiers, processus, réseau).
À réserver à du code que vous avez écrit ou relu.

### Accès web distant (désactivé par défaut)

Une petite page web, pensée pour le téléphone, affiche la capture de l'onglet choisi.

```bash
hublot web on --bind 100.x.x.x:9871    # jeton généré et affiché dans l'URL
hublot web status
hublot web off
```

⚠️ Choisissez une adresse privée, typiquement votre IP Tailscale, jamais `0.0.0.0`. L'accès est en
HTTP, sans chiffrement, et le jeton circule dans l'adresse (`?token=...`) : il peut finir dans un
historique de navigateur ou un journal de serveur. `--no-token` désactive le jeton : n'importe qui
joignant l'adresse voit alors vos onglets. Le réglage survit au redémarrage de Hublot, avec le même
jeton ; `hublot web off` l'arrête et **efface le jeton**.

## Où sont les fichiers

Tout est dans un seul dossier : `%LOCALAPPDATA%\hublot` sous Windows. Sous Linux, où `LOCALAPPDATA`
n'est pas définie, c'est `~/AppData/Local/hublot`.

| Quoi | Fichier |
|------|---------|
| Profil du navigateur (cookies, mots de passe enregistrés) | `profile\` |
| Jeton qui autorise le CLI à parler au broker (créé au premier démarrage, jamais renouvelé) | `token` |
| Onglets ouverts (étiquette et URL), pour les retrouver après un plantage | `tabs.json` |
| Réglages de l'accès web distant, jeton compris | `remote.json` |
| Journal, utile si `hublot start` ne répond pas | `broker.log` |
| Captures d'écran, jamais supprimées par Hublot | `%TEMP%\hublot-screenshots\<étiquette>-<horodatage>.png` |

Hublot n'écoute que sur `127.0.0.1` et exige le jeton à chaque commande : il n'est pas joignable depuis
le réseau tant que vous n'activez pas l'accès web distant. Il n'envoie rien à personne : pas de
télémétrie, pas de recherche de mise à jour.

**Désinstaller Hublot ne supprime pas ces fichiers.** Pour tout effacer : `hublot stop`, puis supprimez
le dossier `hublot` et `hublot-screenshots`. Le détail, y compris les permissions de chaque fichier, est
dans la [politique de confidentialité](https://hublot.breizhzion.com/privacy).

## Compiler soi-même

Prérequis : Node.js 20 ou plus.

```bash
npm install
npm run build      # version de développement : node dist/cli/index.js
npm run package    # exécutable autonome dans build/
```

L'exécutable de `build/` doit rester accompagné du dossier `build/node_modules/playwright-core`.

## Licence

[BZ-1.1](LICENSE.md) : BREIZHZION Personal Use License. Usage personnel uniquement ; fabrication ou
usage commercial pour un tiers interdits sans licence commerciale écrite.
