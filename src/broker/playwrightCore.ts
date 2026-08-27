// playwright-core ne peut pas etre fondu dans le bundle SEA (voir
// scripts/package-sea.mjs pour le detail) : il reste un vrai module sur
// disque, copie a cote de hublot.exe (build/node_modules/playwright-core).
// Le require() standard passe par le chargeur restreint de SEA, qui
// n'accepte que les modules embarques et les builtins Node meme pour un
// specificateur "bare" comme "playwright-core" (pas de resolution disque
// automatique). createRequire, ancre sur le dossier de l'executable,
// declenche la resolution CommonJS normale et retrouve node_modules a cote.
// En distribution npm-install classique (pas de mode SEA), un require()
// ordinaire suffit : node_modules/playwright-core existe reellement a cote
// de ce fichier compile.
import { createRequire } from 'module';

function isRunningAsSea(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sea = require('node:sea') as { isSea: () => boolean };
    return sea.isSea();
  } catch {
    return false;
  }
}

function loadPlaywrightCore(): typeof import('playwright-core') {
  if (isRunningAsSea()) {
    return createRequire(process.execPath)('playwright-core');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('playwright-core');
}

export const { chromium } = loadPlaywrightCore();
export type { BrowserContext, Page, Frame, ConsoleMessage, Dialog, Request } from 'playwright-core';
