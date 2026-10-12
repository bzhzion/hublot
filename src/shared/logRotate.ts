import * as fs from 'fs';

// Le journal du broker est ouvert en ajout à chaque démarrage et n'était
// jamais borné. Au-delà de maxBytes, on le met de côté en `.1` (une seule
// génération, l'ancienne est écrasée) : au plus ~2 x maxBytes sur le disque.
export const LOG_MAX_BYTES = 1024 * 1024;

export function rotateLog(file: string, maxBytes: number = LOG_MAX_BYTES): boolean {
  try {
    if (fs.statSync(file).size <= maxBytes) return false;
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}
