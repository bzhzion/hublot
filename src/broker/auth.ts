// Le socket IPC ecoute sur 127.0.0.1, jamais sur le reseau, mais un port TCP
// loopback reste joignable par N'IMPORTE QUEL utilisateur Windows sur la
// meme machine, pas seulement celui qui a lance le broker (a la difference
// d'un named pipe scope par SID, cf. l'incident deja corrige sur BeamMeUp).
// Sans jeton, un autre compte local pourrait piloter le navigateur du profil
// persistant (screenshot/extract sur des sessions authentifiees, navigation,
// arret). Le jeton est stocke dans un fichier sous %LOCALAPPDATA%\hublot, qui
// herite des ACL NTFS standard du profil utilisateur (proprietaire + SYSTEM +
// Administrateurs, pas "Tout le monde") : lire ce fichier revient donc a
// prouver qu'on tourne sous le meme compte Windows que le broker.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN_BYTES = 32;

export function ensureAuthToken(tokenFile: string): string {
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  try {
    const existing = fs.readFileSync(tokenFile, 'utf-8').trim();
    if (existing) return existing;
  } catch {
    // Pas de jeton existant, on en genere un.
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  return token;
}

export function readAuthToken(tokenFile: string): string | null {
  try {
    const token = fs.readFileSync(tokenFile, 'utf-8').trim();
    return token || null;
  } catch {
    return null;
  }
}

// Comparaison a temps constant (regle "secrets compares en temps constant") :
// meme si la fenetre de timing n'a de valeur reelle que face a un attaquant
// distant, on applique la meme discipline que sur le reste du parc plutot
// que de la reserver aux API exposees sur Internet.
export function isAuthorized(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const a = Buffer.from(candidate, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) {
    // Comparaison factice de meme forme pour ne pas retourner immediatement
    // sur un mismatch de longueur (petit garde-fou, pas une garantie absolue).
    crypto.timingSafeEqual(Buffer.alloc(a.length), Buffer.alloc(a.length));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
