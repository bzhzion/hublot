# Changelog

Toutes les évolutions notables de `hublot` sont documentées ici.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage
[SemVer](https://semver.org/lang/fr/). La section `[Unreleased]` accumule au fil de l'eau et
est renommée en numéro de version au moment de poser le tag.

Ce fichier est créé le 2026-09-05, après la mise en service : les évolutions antérieures ne sont
pas reconstituées, ce qui serait de la réécriture d'historique plutôt que de la documentation.
L'historique git reste la source de vérité pour ce qui précède.

## [Unreleased]

### Corrigé

- **L'installateur ne créait aucun raccourci vers Hublot, seulement vers son
  désinstalleur.** Sa section `[Icons]` ne contenait que l'entrée de désinstallation, et il
  n'y avait aucune section `[Run]`, donc après installation le seul « programme » que le
  système connaissait de Hublot était `unins000.exe`.
  - **C'est l'explication la plus plausible du `Validation-No-Executables`** posé par le
    pipeline de validation de winget sur la PR
    [#430896](https://github.com/microsoft/winget-pkgs/pull/430896) : il énumère les points
    d'entrée après installation et n'en trouvait aucun. Trouvé en comparant avec les deux
    paquets du parc qui passent la validation, dont les installateurs en créent un.
  - Le raccourci lance `hublot start` et pas l'exécutable nu : sans commande, `hublot`
    imprime son aide et rend un code non nul, donc un clic aurait ouvert une console pour
    la refermer aussitôt. `start` est le premier geste documenté, il est idempotent, et il
    ouvre le Chromium visible qui est la raison d'être de l'outil.
  - ⚠️ **Le correctif ne débloque pas la PR à lui seul** : elle référence l'installateur de
    la 0.1.1, qui porte le défaut. Il faut une release qui embarque ce correctif, puis
    mettre le manifest à jour vers cette version.

## [0.1.4] - 2026-09-07

### Corrigé

- **La publication apt est appelée par le workflow de release**, et non plus déclenchée par
  un événement. Le fichier reste séparé, avec ses droits et sa clé SSH dédiée : seul le
  mécanisme d'enchaînement change.
  - ⚠️ **`workflow_run` a été essayé d'abord et ne tire pas sur ce dépôt.** Trois
    tentatives, **zéro run déclenché** : depuis un tag, depuis une branche, et avec le
    déclencheur en place depuis longtemps sur la branche par défaut. Les noms de workflow
    correspondaient au caractère près, le fichier était bien sur `main` (vérifié via
    l'API, pas seulement sur le disque), et le run amont finissait en succès. **La cause
    n'a pas pu être établie de l'extérieur.**
  - Deux hypothèses écartées par l'expérience plutôt que par le raisonnement : un délai
    d'enregistrement du déclencheur, le premier tag ayant été posé 21 secondes après le
    commit qui l'ajoutait ; et l'idée que `workflow_run` ignore les runs issus d'un tag,
    réfutée par un lancement manuel depuis une branche qui n'a pas tiré davantage.
  - `workflow_call` ne repose sur aucun événement à observer : l'appelant nomme l'appelé,
    donc **soit le job existe dans le run, soit il n'existe pas**. C'est vérifiable d'un
    coup d'œil, contrairement à un déclenchement qui échoue en ne produisant rien.
  - `needs: build` remplace l'ancien `if` : un build en échec n'atteint jamais ce job.
  - ⚠️ `secrets: inherit` est obligatoire, un workflow appelé ne reçoit **aucun** secret
    sans cela. L'échec aurait été une clé SSH vide, que le contrôle préalable de l'appelé
    nomme correctement au lieu de laisser `ssh` buter sur une clé illisible.

## [0.1.3] - 2026-09-07

## [0.1.2] - 2026-09-07

### Modifié

- **`publish-apt.yml` est désormais déclenché à la suite du build** (`workflow_run`), tout en
  restant un workflow **séparé** : fichier distinct, droits distincts, et surtout une clé SSH
  dédiée qui n'a rien à voir avec les autres secrets du build.
  - ⚠️ Il était « manuel uniquement », et la conséquence était que **le dépôt apt dérivait en
    silence** : ce paquet y est resté en **0.1.0** pendant que ses releases passaient à 1.0.1
    puis 1.0.2, sans que rien ne le signale. C'est le même motif que winget — **l'unique
    étape manuelle d'une chaîne automatisée est celle qui ne se fait pas.**
  - Le déclenchement manuel ne protégeait d'ailleurs pas de grand-chose : pousser un tag et
    lancer un workflow demandent le **même** droit d'écriture, donc il évitait les
    lancements accidentels et pas les malveillants. La vraie protection reste la clé
    restreinte côté serveur par sa commande forcée, inchangée.
  - Deux garde-fous nécessaires ensemble : `conclusion == 'success'` pour qu'un build en
    échec ne publie rien, et `startsWith(head_branch, 'v')` pour qu'un push de branche ne
    déclenche rien. L'un sans l'autre laisse passer un cas.
  - ⚠️ Piège de `workflow_run` : il ne se déclenche que si le fichier est sur la branche par
    défaut, et son contexte est celui de cette branche **et non du tag**. La version se lit
    donc dans `head_branch` de l'événement, pas dans `github.ref`.

### Modifié

- Le manifeste `latest.json` déclare désormais **`linux_apt`**, qui renvoie vers
  `apt.breizhzion.com`. Le dépôt apt fait autorité et versionne lui-même dans son pool, son
  index `Packages` épinglant déjà les SHA256 : une copie versionnée sur R2 serait une
  seconde source de vérité pour le même fait.

### Corrigé

- ⚠️ **L'étape de publication R2 échouait alors que ses envois réussissaient.** À la
  première release le manifeste n'existe pas encore, donc `aws s3 cp` pour le lire échoue,
  ce qui est normal et traité. Mais **le wrapper pwsh de GitHub Actions termine par
  `exit $LASTEXITCODE`**, et `Set-Content` ne remet pas cette variable à zéro : le 1 d'`aws`
  survivait jusqu'à la fin du script.
  - Le symptôme trompait complètement : les deux envois d'installateur apparaissaient en
    succès dans le journal, juste avant un `exit code 1`, donc l'échec se lisait comme un
    problème d'envoi alors qu'il venait d'une variable rémanente.
  - La version bash du même motif, sur `noisecrypt`, n'a pas ce défaut : son `||` remet le
    code de retour à zéro de lui-même. **Le même code traduit d'un shell à l'autre n'a pas
    le même comportement d'erreur**, et c'est le genre d'écart qu'on ne voit qu'à
    l'exécution.

## [0.1.1] - 2026-09-07

### Ajouté
- **Publication sur `dl.breizhzion.com`** : l'installateur Windows part désormais aussi sur
  le bucket R2 partagé `breizhzion-releases`, sous le préfixe de l'appli, en **nom fixe et
  en copie versionnée immuable**, accompagné d'un `latest.json`.
  - Les trois formes d'URL ne servent pas à la même chose : le nom fixe pour les boutons de
    site et les `curl`, la copie versionnée pour les gestionnaires de paquets qui épinglent
    un SHA256 par version, le `latest.json` pour qu'un site affiche la version courante sans
    redéploiement. Confondre les deux premières est ce qui casse un manifest winget déjà
    accepté, et c'est arrivé pour de vrai (`microsoft/winget-pkgs#399072`).
  - ⚠️ Via l'**API S3** et non `wrangler r2 object`, et ce n'est pas une préférence : les
    permissions R2 **par bucket** ne valent que pour l'API S3, l'API Cloudflare exigeant une
    permission à l'échelle du compte. Ce dépôt étant **public**, un jeton capable d'écrire
    dans les photos de production ou les sauvegardes Portainer n'y a pas sa place. Le jeton
    employé est restreint au seul bucket des releases, et ce refus a été **prouvé** avant
    qu'il soit distribué.
  - Le lire-modifier-écrire de `latest.json` est protégé par le `concurrency` posé juste
    avant, sans lequel une version plus ancienne finissant en dernier écraserait la nouvelle.


### Ajouté
- **`concurrency` posé sur les workflows de release**, `cancel-in-progress: false`.
  - **Préventif, et le commentaire le dit** : aujourd'hui chaque exécution publie sur le tag
    de sa propre version, donc une ancienne qui finirait en dernier n'écrase rien. Le
    garde-fou est posé **avant** la chose qu'il protège, à savoir l'alignement en cours qui
    va ajouter un manifeste et un fichier au nom générique partagés entre versions.
  - Un premier jet de ce commentaire décrivait la panne comme déjà possible ici. C'était
    faux, et corrigé avant commit : un commentaire qui décrit une défaillance inexistante
    finit par se lire comme un état de fait.
  - Le défaut a bien frappé ailleurs : sur `justmakeq` le 2026-09-06, une version partie
    34 minutes avant la suivante a fini 14 minutes après elle et l'a écrasée.


### Corrigé

- **`release-windows.yml` créait un tag git nommé `main`** quand il était lancé à la main.
  Il passait `tag_name: ${{ github.ref_name }}` à `action-gh-release`, ce qui vaut le tag
  sur un push de tag mais vaut **`main`** sur un `workflow_dispatch` depuis la branche par
  défaut. L'action crée alors le tag et y attache la release.
  - Ce n'est pas théorique : ce dépôt porte un tag `main` à côté de `v0.1.0`, et sa release
    courante y est posée. Son installateur est donc servi sous
    `/releases/download/main/...`, une URL **qui n'est pas immuable par version**, ce qui
    interdit la publication sur winget.
  - Le piège est double, et c'est ce qui l'a rendu invisible : le bug ne tire **que** sur le
    chemin manuel, qui existe précisément pour rejouer une release. Il frappe donc au
    moment où on est déjà en train de réparer autre chose, et il passe pour une
    conséquence de la panne qu'on répare.
  - **La bonne réponse était déjà dans ce dépôt** : `release-linux.yml` reconstruit le tag
    depuis la version. Aligné dessus plutôt que d'introduire une troisième façon de nommer
    un tag. Deux workflows du même dépôt qui ne s'accordent pas sur la façon de nommer un
    tag, c'est le signe qu'un des deux a été écrit sans regarder l'autre.
  - Reste à faire à la main, hors du code : supprimer le tag `main` et sa release, puis
    republier proprement sur un tag de version.

### Corrigé

- **Convention de fins de ligne du parc posée dans `.gitattributes`.** Le bloc `run:` d'un
  workflow GitHub Actions est un script shell exécuté sur un runner Linux : un antislash de
  continuation suivi d'un retour chariot **ne continue pas** la ligne, la commande est coupée en
  deux, et le message d'erreur ne parle jamais de fins de ligne.
- Cas réel du 2026-09-07 sur `bzhzion/cabanon` : un `.yml` recommité en CRLF depuis une machine
  Windows (où `core.autocrlf` est actif) a fait échouer le déploiement de l'API sur un
  `usage: ssh`, la destination de la commande ayant disparu avec la continuation.
- LF forcé sur ce qu'exécute Linux (`*.sh`, `*.yml`, `*.yaml`, `Dockerfile`), CRLF sur ce
  qu'exécute Windows (`*.ps1`, `*.bat`, `*.cmd`), et `* text=auto` comme filet général.
  Référence : `admin/.claude/gitattributes-parc`.


### Ajouté

- **Convention changelog du parc posée sur ce dépôt** : ce fichier, les hooks `pre-commit` et
  `pre-push` dans `.githooks/`, et le workflow `changelog-guard.yml` qui rejoue les mêmes
  contrôles en CI au moment du tag. Ce dépôt en était dépourvu alors qu'il est déployé, ce qui
  le laissait hors de la garantie que les autres ont.

