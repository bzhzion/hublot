import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Port fixe volontaire (pas de découverte dynamique) : le CLI doit pouvoir
// joindre le broker sans fichier de coordination ni variable d'environnement.
// 127.0.0.1 uniquement : jamais exposé au réseau.
export const BROKER_PORT = 47563;
export const BROKER_HOST = '127.0.0.1';

export interface HomeEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
}

// Windows : %LOCALAPPDATA%\hublot. Ailleurs : $XDG_CONFIG_HOME/hublot, sinon
// ~/.config/hublot. Avant 0.1.13, Linux utilisait ~/AppData/Local/hublot, un
// chemin de style Windows (LOCALAPPDATA n'y existe pas).
export function resolveHublotHome(ctx: HomeEnv): string {
  if (ctx.platform === 'win32') {
    return path.join(ctx.env.LOCALAPPDATA || path.join(ctx.homedir, 'AppData', 'Local'), 'hublot');
  }
  return path.join(ctx.env.XDG_CONFIG_HOME || path.join(ctx.homedir, '.config'), 'hublot');
}

export function legacyHublotHome(ctx: HomeEnv): string {
  return path.join(ctx.homedir, 'AppData', 'Local', 'hublot');
}

// Reprend un dossier créé au mauvais endroit sous Linux, profil et connexions
// compris : on le DÉPLACE (jamais de copie qui laisserait deux profils), et
// seulement si le nouvel emplacement n'existe pas encore. Renvoie true si déplacé.
export function migrateLegacyHome(ctx: HomeEnv): boolean {
  if (ctx.platform === 'win32') return false;
  const next = resolveHublotHome(ctx);
  const old = legacyHublotHome(ctx);
  if (next === old || fs.existsSync(next) || !fs.existsSync(old)) return false;
  try {
    fs.mkdirSync(path.dirname(next), { recursive: true });
    fs.renameSync(old, next);
    return true;
  } catch {
    return false;
  }
}

const CTX: HomeEnv = { platform: process.platform, env: process.env, homedir: os.homedir() };
migrateLegacyHome(CTX);

export const HUBLOT_HOME = resolveHublotHome(CTX);
export const PROFILE_DIR = path.join(HUBLOT_HOME, 'profile');
export const TABS_FILE = path.join(HUBLOT_HOME, 'tabs.json');
export const TOKEN_FILE = path.join(HUBLOT_HOME, 'token');
export const BROKER_LOG_FILE = path.join(HUBLOT_HOME, 'broker.log');
// Reglages de l'acces web distant optionnel (voir broker/remoteWeb.ts),
// meme pattern que remote.json cote beammeup : persiste pour redemarrer
// automatiquement dans le meme etat si le broker est relance.
export const REMOTE_CONFIG_FILE = path.join(HUBLOT_HOME, 'remote.json');

export function screenshotsDir(): string {
  const tempDir = process.env.TEMP || process.env.TMP || os.tmpdir();
  return path.join(tempDir, 'hublot-screenshots');
}
