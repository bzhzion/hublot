import * as path from 'path';
import * as os from 'os';

// Port fixe volontaire (pas de découverte dynamique) : le CLI doit pouvoir
// joindre le broker sans fichier de coordination ni variable d'environnement.
// 127.0.0.1 uniquement : jamais exposé au réseau.
export const BROKER_PORT = 47563;
export const BROKER_HOST = '127.0.0.1';

function localAppData(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

export const HUBLOT_HOME = path.join(localAppData(), 'hublot');
export const PROFILE_DIR = path.join(HUBLOT_HOME, 'profile');
export const TABS_FILE = path.join(HUBLOT_HOME, 'tabs.json');
export const BROKER_LOG_FILE = path.join(HUBLOT_HOME, 'broker.log');

export function screenshotsDir(): string {
  const tempDir = process.env.TEMP || process.env.TMP || os.tmpdir();
  return path.join(tempDir, 'hublot-screenshots');
}
