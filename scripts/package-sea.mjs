// Empaquette Hublot en exécutable unique (+ un dossier node_modules a cote)
// via le mode natif Node.js "Single Executable Applications" (SEA, depuis
// Node 20+).
//
// Étapes (documentées aussi dans le README, section Distribution) :
//   1. Bundle dist/cli/index.js (+ tout ce qu'il importe, SAUF playwright-core,
//      voir plus bas pourquoi) en un seul fichier CommonJS via esbuild.
//   2. Génère la config SEA (sea-config.json) et le blob (sea-prep.blob) via
//      `node --experimental-sea-config`.
//   3. Copie le binaire node courant (process.execPath) pour servir de socle
//      à l'exécutable final.
//   4. Injecte le blob dans cette copie via postject (API programmatique,
//      pas la CLI, pour rester un simple `node scripts/package-sea.mjs`).
//   5. Copie node_modules/playwright-core a cote de l'exécutable : plusieurs
//      fichiers internes de playwright-core font un require() relatif a leur
//      propre __dirname pour relire leur package.json (ex.
//      packageJSON = require(path.join(__dirname, '..', 'package.json'))).
//      Ca marche tel quel tant que le fichier reste a sa vraie place sur
//      disque, mais casse (ERR_UNKNOWN_BUILTIN_MODULE) si esbuild le fond
//      dans un seul fichier bundle : __dirname devient alors celui du bundle,
//      plus celui du paquet. Constaté a la fois dans lib/package.js ET dans
//      une deuxieme copie interne du meme motif a l'intérieur de
//      lib/coreBundle.js (playwright-core embarque son propre bundle
//      interne) — pas un cas isolé qu'on peut patcher fichier par fichier,
//      donc on ne bundle pas playwright-core du tout : il reste un vrai
//      module sur disque, require() le retrouve normalement au runtime
//      (Node resout un `require("playwright-core")` non bundlé en
//      remontant les node_modules a partir du dossier de l'executable).
//
// Resultat : hublot.exe + node_modules/ (playwright-core uniquement, ce
// paquet n'a aucune dependance propre) doivent etre distribues ensemble
// (meme dossier / meme zip de release). Toujours zero `npm install` pour
// l'utilisateur final, juste un fichier de plus a cote de l'executable.
//
// Idempotent : chaque exécution repart de zéro dans build/, jamais d'état
// résiduel qui fausserait un nouveau packaging.

import { build } from 'esbuild';
import { inject } from 'postject';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
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
    // Voir l'explication en tete de fichier : playwright-core ne survit pas
    // au bundling (require() internes relatifs a __dirname).
    external: ['playwright-core'],
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
  cpSync(process.execPath, exePath);

  console.log('[package-sea] injection du blob (postject) ...');
  const blob = readFileSync(blobPath);
  await inject(exePath, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    // Signature macOS non applicable ici (pas de build macOS pour Hublot),
    // et sans objet sur Windows/Linux : postject l'ignore sur ces plateformes.
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });

  console.log('[package-sea] copie de node_modules/playwright-core a cote de l\'executable ...');
  const nodeModulesOut = path.join(buildDir, 'node_modules');
  rmSync(nodeModulesOut, { recursive: true, force: true });
  mkdirSync(nodeModulesOut, { recursive: true });
  cpSync(
    path.join(root, 'node_modules', 'playwright-core'),
    path.join(nodeModulesOut, 'playwright-core'),
    { recursive: true },
  );

  console.log(`[package-sea] OK -> ${exePath} (+ ${nodeModulesOut})`);
  console.log(
    '[package-sea] note : ce binaire n\'est PAS signé (Azure Trusted Signing). ' +
      'Voir le TODO dans .github/workflows/release-windows.yml pour la CI.',
  );
  console.log(
    '[package-sea] a distribuer ensemble : hublot.exe + node_modules/ (meme dossier).',
  );
}

main().catch((err) => {
  console.error('[package-sea] échec:', err);
  process.exit(1);
});
