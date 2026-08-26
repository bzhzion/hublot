// Empaquette Hublot en exécutable unique via le mode natif Node.js "Single
// Executable Applications" (SEA, disponible depuis Node 20+ ; sur des
// versions plus récentes le warning "experimental" peut ne plus apparaître).
//
// Étapes (documentées aussi dans le README, section Distribution) :
//   1. Bundle dist/cli/index.js (+ tout ce qu'il importe, y compris le
//      broker et ses dépendances node_modules) en un seul fichier CommonJS
//      via esbuild (SEA exige un point d'entrée autonome, sans résolution
//      de node_modules au runtime).
//   2. Génère la config SEA (sea-config.json) et le blob (sea-prep.blob) via
//      `node --experimental-sea-config`.
//   3. Copie le binaire node courant (process.execPath) pour servir de socle
//      à l'exécutable final.
//   4. Injecte le blob dans cette copie via postject (API programmatique,
//      pas la CLI, pour rester un simple `node scripts/package-sea.mjs`).
//
// Aucune dépendance à `npm install` sur la machine cible : l'exécutable
// produit embarque Node lui-même + tout le code applicatif.
//
// Idempotent : chaque exécution repart de zéro dans build/ (rm -rf implicite
// via écrasement des fichiers), jamais d'état résiduel qui fausserait un
// nouveau packaging.

import { build } from 'esbuild';
import { inject } from 'postject';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const bundlePath = path.join(buildDir, 'sea-bundle.cjs');
const configPath = path.join(buildDir, 'sea-config.json');
const blobPath = path.join(buildDir, 'sea-prep.blob');
const exeName = process.platform === 'win32' ? 'hublot.exe' : 'hublot';
const exePath = path.join(buildDir, exeName);

async function main() {
  mkdirSync(buildDir, { recursive: true });

  console.log('[package-sea] bundling dist/cli/index.js -> sea-bundle.cjs ...');
  await build({
    entryPoints: [path.join(root, 'dist', 'cli', 'index.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: bundlePath,
    // playwright-core référence conditionnellement le protocole BiDi
    // (chromium-bidi), require() paresseux dans un bloc jamais atteint par
    // le chemin CDP qu'Hublot utilise (channel chrome/msedge). Le paquet
    // chromium-bidi n'est pas installé (dépendance optionnelle non tirée) :
    // sans ce passage en "external", esbuild échoue à résoudre le chemin au
    // moment du bundle même s'il n'est jamais exécuté. Marquer external
    // laisse le require() tel quel dans le bundle ; il ne pourrait échouer
    // qu'au runtime, et seulement si le code BiDi était un jour exercé (pas
    // le cas aujourd'hui).
    external: [
      'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
      'chromium-bidi/lib/cjs/cdp/CdpConnection',
    ],
  });

  const seaConfig = {
    main: path.relative(buildDir, bundlePath),
    output: path.relative(buildDir, blobPath),
    disableExperimentalSEAWarning: true,
  };
  writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));

  console.log('[package-sea] génération du blob SEA ...');
  execFileSync(
    process.execPath,
    ['--experimental-sea-config', path.basename(configPath)],
    { cwd: buildDir, stdio: 'inherit' },
  );

  console.log(`[package-sea] copie du binaire node -> ${exeName}`);
  rmSync(exePath, { force: true });
  copyFileSync(process.execPath, exePath);

  console.log('[package-sea] injection du blob (postject) ...');
  const blob = readFileSync(blobPath);
  await inject(exePath, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    // Signature macOS non applicable ici (pas de build macOS pour Hublot),
    // et sans objet sur Windows/Linux : postject l'ignore sur ces plateformes.
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });

  console.log(`[package-sea] OK -> ${exePath}`);
  console.log(
    '[package-sea] note : ce binaire n\'est PAS signé (Azure Trusted Signing). ' +
      'Voir le TODO dans .github/workflows/release-windows.yml pour la CI.',
  );
}

main().catch((err) => {
  console.error('[package-sea] échec:', err);
  process.exit(1);
});
