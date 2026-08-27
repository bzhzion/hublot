#!/usr/bin/env node
// CLI Hublot : invoqué par n'importe quel agent depuis son outil Bash/PowerShell
// standard. Parle au broker via le client IPC, ne contient aucune logique
// Playwright elle-même.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { isBrokerReady, isBrokerRunning, sendRequest } from './client.js';
import { BrokerResponse } from '../shared/types.js';
import { HUBLOT_HOME, BROKER_LOG_FILE } from '../shared/paths.js';
import { isValidLabel } from '../shared/validate.js';

// Meme regle que le broker (defense en profondeur) : echouer tot avec un
// message clair plutot que de laisser le broker renvoyer une erreur generique
// apres un aller-retour reseau.
function requireValidLabel(label: string): void {
  if (!isValidLabel(label)) {
    console.error('Label invalide : lettres/chiffres/tirets/underscores uniquement, 64 caractères max, doit commencer par un caractère alphanumérique.');
    process.exit(1);
  }
}

// Détection best-effort du mode "exécutable unique" (Node SEA). Le module
// `node:sea` n'existe que sur les runtimes récents (Node 20.12+/21.7+) : sur
// une distribution npm-install classique avec un Node plus ancien, l'appel
// échoue et on retombe sur le chemin habituel (spawn d'un fichier séparé).
function runningAsSea(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sea = require('node:sea') as { isSea: () => boolean };
    return sea.isSea();
  } catch {
    return false;
  }
}

const program = new Command();
program.name('hublot').description('Broker + CLI pour un Chromium visible partagé entre agents').version('0.1.0');

// Commande cachée, jamais documentée ni appelée à la main : c'est le point
// d'entrée que le binaire empaqueté (SEA) utilise pour lancer la logique
// broker DANS le process qu'il vient de spawn (voir "start" ci-dessous). Le
// module broker n'existe pas en fichier séparé une fois embarqué dans le
// binaire, donc on ne peut pas le spawn par chemin de fichier comme dans la
// distribution npm-install classique.
program
  .command('__broker', { hidden: true })
  .description('(interne, ne pas utiliser) lance la logique broker dans le process courant')
  .action(async () => {
    const { runBroker } = await import('../broker/index.js');
    await runBroker().catch((err: Error) => {
      console.error('[hublot] échec au démarrage du broker:', err);
      process.exit(1);
    });
  });

function printResultAndExit(res: BrokerResponse): never {
  if (!res.ok) {
    console.error(`Erreur: ${res.error}`);
    process.exit(1);
  }
  process.exit(0);
}

async function callBroker(req: Parameters<typeof sendRequest>[0]): Promise<BrokerResponse> {
  if (!(await isBrokerReady())) {
    console.error('Le broker Hublot ne répond pas. Lancer "hublot start" d\'abord.');
    process.exit(1);
  }
  return sendRequest(req);
}

program
  .command('start')
  .description('Démarre le broker (Chromium visible + profil persistant) si pas déjà lancé')
  .action(async () => {
    if (await isBrokerReady()) {
      console.log('Le broker Hublot tourne déjà.');
      return;
    }
    // isBrokerRunning() (juste un ping) ne suffit pas pour decider s'il faut
    // spawner : le serveur TCP accepte des connexions avant que le
    // navigateur soit pret (voir broker/index.ts, variable `ready`). Si un
    // autre "start" est deja en cours de demarrage, ne pas en spawner un
    // deuxieme (ecraserait le meme profil Chromium) : la boucle d'attente
    // ci-dessous suffit dans ce cas.
    if (!(await isBrokerRunning())) {
      // Distribution npm-install classique : on spawn le fichier compilé
      // dist/broker/index.js séparément. Binaire empaqueté (SEA) : ce fichier
      // n'existe pas à côté de l'exécutable, on respawn donc l'exécutable
      // lui-même avec la commande cachée "__broker", qui exécute la même
      // logique dans le nouveau process.
      const brokerArgs = runningAsSea() ? ['__broker'] : [path.join(__dirname, '..', 'broker', 'index.js')];
      fs.mkdirSync(HUBLOT_HOME, { recursive: true });
      const logFd = fs.openSync(BROKER_LOG_FILE, 'a');
      const child = spawn(process.execPath, brokerArgs, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: false,
      });
      child.unref();
    }

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isBrokerReady()) {
        console.log('Broker Hublot démarré.');
        return;
      }
    }
    console.error('Le broker ne répond pas après 15s. Vérifier %LOCALAPPDATA%/hublot/broker.log ou relancer manuellement.');
    process.exit(1);
  });

program
  .command('stop')
  .description('Arrête le broker et ferme Chromium')
  .action(async () => {
    if (!(await isBrokerRunning())) {
      console.log('Le broker Hublot ne tourne pas.');
      return;
    }
    await sendRequest({ cmd: 'stop' });
    console.log('Arrêt du broker demandé.');
  });

program
  .command('status')
  .alias('list')
  .description('Affiche l\'état du broker et la liste des onglets ouverts')
  .action(async () => {
    if (!(await isBrokerRunning())) {
      console.log('Broker Hublot: arrêté.');
      return;
    }
    const res = await callBroker({ cmd: 'status' });
    if (!res.ok) return printResultAndExit(res);
    console.log('Broker Hublot: en ligne.');
    if (!res.tabs || res.tabs.length === 0) {
      console.log('Aucun onglet ouvert.');
      return;
    }
    for (const tab of res.tabs) {
      console.log(`${tab.label}\t${tab.tabId}\t${tab.url}`);
    }
  });

program
  .command('open')
  .requiredOption('--label <label>', 'identifiant de l\'onglet (par agent)')
  .option('--url <url>', 'URL à charger à l\'ouverture')
  .description('Ouvre un nouvel onglet pour ce label, ou réutilise l\'existant')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'open', label: opts.label, url: opts.url });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.message ?? 'ok');
    if (res.tabs) for (const t of res.tabs) console.log(`${t.label}\t${t.tabId}\t${t.url}`);
  });

program
  .command('navigate')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--url <url>', 'URL à charger')
  .description('Navigue vers une URL dans l\'onglet du label')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'navigate', label: opts.label, url: opts.url });
    printResultAndExit(res);
  });

program
  .command('back')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .description('Revient a la page precedente dans l\'historique de l\'onglet')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'back', label: opts.label });
    printResultAndExit(res);
  });

program
  .command('click')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS Playwright')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Clique sur un élément')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'click', label: opts.label, selector: opts.selector, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('hover')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS Playwright')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Survole un élément (hover)')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'hover', label: opts.label, selector: opts.selector, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('type')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS Playwright')
  .requiredOption('--text <text>', 'texte à saisir')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Saisit du texte dans un champ (remplace la valeur, ne simule pas de vraies frappes clavier)')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'type', label: opts.label, selector: opts.selector, text: opts.text, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('press')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .option('--selector <selector>', 'sélecteur CSS Playwright (sinon l\'élément actuellement focus)')
  .requiredOption('--key <key>', 'touche a presser, ex: Enter, Tab, Escape, ArrowDown')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Presse une touche clavier, sur un élément ou globalement')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'press', label: opts.label, selector: opts.selector, key: opts.key, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('select')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS Playwright (élément <select>)')
  .requiredOption('--value <value>', 'valeur de l\'option a sélectionner')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Sélectionne une option dans un menu déroulant')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'select', label: opts.label, selector: opts.selector, value: opts.value, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('drag')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--source <selector>', 'sélecteur CSS de l\'élément a glisser')
  .requiredOption('--target <selector>', 'sélecteur CSS de la cible du dépôt')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Glisse-dépose un élément vers un autre (drag and drop)')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'drag', label: opts.label, source: opts.source, target: opts.target, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('upload')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS de l\'input file')
  .requiredOption('--files <files>', 'chemin(s) de fichier, separes par des virgules')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Envoie un ou plusieurs fichiers dans un champ <input type=file>')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'upload', label: opts.label, selector: opts.selector, files: opts.files, frame: opts.frame });
    printResultAndExit(res);
  });

program
  .command('dialog')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--action <action>', 'accept ou dismiss')
  .option('--text <text>', 'texte a renvoyer si le dialogue est un prompt() accepte')
  .description('Definit comment cet onglet doit repondre aux dialogues JS (alert/confirm/prompt). Par defaut : dismiss.')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    if (opts.action !== 'accept' && opts.action !== 'dismiss') {
      console.error('--action doit valoir "accept" ou "dismiss".');
      process.exit(1);
    }
    const res = await callBroker({ cmd: 'dialog', label: opts.label, action: opts.action, text: opts.text });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.message ?? 'ok');
  });

program
  .command('wait')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .option('--selector <selector>', 'attend que cet élément soit visible')
  .option('--text <text>', 'attend que ce texte apparaisse sur la page')
  .option('--timeout-ms <ms>', 'délai maximum en millisecondes (defaut: 30000)')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Attend explicitement l\'apparition d\'un élément ou d\'un texte')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    if (!opts.selector && !opts.text) {
      console.error('Fournir --selector ou --text.');
      process.exit(1);
    }
    const res = await callBroker({
      cmd: 'wait',
      label: opts.label,
      selector: opts.selector,
      text: opts.text,
      timeoutMs: opts.timeoutMs ? Number(opts.timeoutMs) : undefined,
      frame: opts.frame,
    });
    printResultAndExit(res);
  });

program
  .command('find')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--text <text>', 'texte a rechercher (correspondance partielle)')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Trouve les éléments contenant ce texte, sans avoir a deviner un sélecteur CSS')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'find', label: opts.label, text: opts.text, frame: opts.frame });
    if (!res.ok) return printResultAndExit(res);
    for (const m of res.matches ?? []) {
      console.log(`<${m.tag}> ${m.text}`);
    }
    if (!res.matches || res.matches.length === 0) console.log('Aucun élément trouvé.');
  });

program
  .command('evaluate')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--expression <expression>', 'expression JavaScript a évaluer dans la page')
  .description('Exécute une expression JavaScript arbitraire dans le contexte de la page et affiche le résultat (JSON)')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'evaluate', label: opts.label, expression: opts.expression });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.result ?? '');
  });

program
  .command('run-code-unsafe')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .option('--code <code>', 'fonction Playwright, ex: "async (page, context) => { return await page.title(); }"')
  .option('--file <file>', 'charger le code depuis ce fichier plutôt que --code (utile pour du code multi-lignes)')
  .description(
    'DANGER (assumé) : exécute du code Playwright arbitraire dans le process du broker lui-même, ' +
      'pas seulement dans le bac à sable JS de la page (accès Node complet : fs, child_process, ' +
      'BrowserContext entier). Réservé à un usage personnel sur une machine déjà de confiance.',
  )
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const code = opts.file ? fs.readFileSync(opts.file, 'utf-8') : opts.code;
    if (!code) {
      console.error('Fournir --code ou --file.');
      process.exit(1);
    }
    const res = await callBroker({ cmd: 'run_unsafe', label: opts.label, code });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.result ?? '');
  });

program
  .command('resize')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--width <width>', 'largeur en pixels')
  .requiredOption('--height <height>', 'hauteur en pixels')
  .description('Redimensionne le viewport de cet onglet')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'resize', label: opts.label, width: Number(opts.width), height: Number(opts.height) });
    printResultAndExit(res);
  });

program
  .command('extract')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .option('--selector <selector>', 'sélecteur CSS Playwright (sinon tout le body)')
  .option('--frame <urlSubstring>', 'cibler l\'iframe dont l\'URL contient cette sous-chaîne, plutôt que la page principale')
  .description('Extrait le texte (innerText) d\'un élément ou de la page')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'extract', label: opts.label, selector: opts.selector, frame: opts.frame });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.text ?? '');
  });

program
  .command('snapshot')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .description('Arbre d\'accessibilité de la page (rôles/noms), plus fiable qu\'un screenshot pour repérer un élément sans deviner un sélecteur')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'snapshot', label: opts.label });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.text ?? '');
  });

program
  .command('screenshot')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .description('Prend une capture d\'écran et écrit le chemin du PNG en stdout')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'screenshot', label: opts.label });
    if (!res.ok) return printResultAndExit(res);
    console.log(res.path ?? '');
  });

program
  .command('console')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .description('Affiche les derniers logs console JS capturés pour cet onglet')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'console', label: opts.label });
    if (!res.ok) return printResultAndExit(res);
    for (const log of res.logs ?? []) {
      console.log(`[${new Date(log.timestamp).toISOString()}] ${log.type}: ${log.text}`);
    }
  });

program
  .command('network')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .description('Affiche les requêtes réseau capturées pour cet onglet (méthode, URL, statut)')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'network', label: opts.label });
    if (!res.ok) return printResultAndExit(res);
    for (const r of res.requests ?? []) {
      console.log(`${r.method}\t${r.status ?? '?'}\t${r.url}`);
    }
  });

program
  .command('close')
  .requiredOption('--label <label>', 'label de l\'onglet à fermer')
  .description('Ferme l\'onglet de ce label')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'close', label: opts.label });
    printResultAndExit(res);
  });

program
  .command('web')
  .argument('<action>', 'on, off ou status')
  .option('--bind <addr>', 'adresse:port d\'écoute (défaut: 127.0.0.1:9871)')
  .option('--no-token', 'désactive le jeton (accès ouvert à qui joint cette adresse, à vos risques)')
  .description(
    'Active/désactive l\'accès web distant : une page mobile qui affiche la capture d\'écran ' +
      'de l\'onglet choisi, rafraîchie en boucle. Fermé par défaut, jeton auto-généré sauf --no-token. ' +
      'Redémarre automatiquement dans le même état si le broker est relancé.',
  )
  .action(async (action, opts) => {
    if (action === 'on') {
      const bind = opts.bind || '127.0.0.1:9871';
      const res = await callBroker({ cmd: 'web_on', bind, noToken: !!opts.noToken });
      if (!res.ok) return printResultAndExit(res);
      console.log(res.message ?? 'ok');
    } else if (action === 'off') {
      const res = await callBroker({ cmd: 'web_off' });
      if (!res.ok) return printResultAndExit(res);
      console.log(res.message ?? 'ok');
    } else if (action === 'status') {
      const res = await callBroker({ cmd: 'web_status' });
      if (!res.ok) return printResultAndExit(res);
      if (res.web?.enabled) {
        console.log(`Actif sur ${res.web.bind}${res.web.hasToken ? ' (jeton requis)' : ' (SANS jeton)'}`);
      } else {
        console.log('Accès web distant : inactif.');
      }
    } else {
      console.error('Action invalide : utiliser "on", "off" ou "status".');
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
