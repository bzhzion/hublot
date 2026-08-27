#!/usr/bin/env node
// CLI Hublot : invoqué par n'importe quel agent depuis son outil Bash/PowerShell
// standard. Parle au broker via le client IPC, ne contient aucune logique
// Playwright elle-même.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { isBrokerReady, isBrokerRunning, sendRequest } from './client';
import { BrokerResponse } from '../shared/types';
import { HUBLOT_HOME, BROKER_LOG_FILE } from '../shared/paths';
import { isValidLabel } from '../shared/validate';

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
    const { runBroker } = await import('../broker');
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
  .command('click')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS Playwright')
  .description('Clique sur un élément')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'click', label: opts.label, selector: opts.selector });
    printResultAndExit(res);
  });

program
  .command('type')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .requiredOption('--selector <selector>', 'sélecteur CSS Playwright')
  .requiredOption('--text <text>', 'texte à saisir')
  .description('Saisit du texte dans un champ')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'type', label: opts.label, selector: opts.selector, text: opts.text });
    printResultAndExit(res);
  });

program
  .command('extract')
  .requiredOption('--label <label>', 'label de l\'onglet')
  .option('--selector <selector>', 'sélecteur CSS Playwright (sinon tout le body)')
  .description('Extrait le texte (innerText) d\'un élément ou de la page')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'extract', label: opts.label, selector: opts.selector });
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
  .command('close')
  .requiredOption('--label <label>', 'label de l\'onglet à fermer')
  .description('Ferme l\'onglet de ce label')
  .action(async (opts) => {
    requireValidLabel(opts.label);
    const res = await callBroker({ cmd: 'close', label: opts.label });
    printResultAndExit(res);
  });

program.parseAsync(process.argv);
