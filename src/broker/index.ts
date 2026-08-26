// Process broker Hublot : lance un unique Chromium visible avec un profil
// persistant, et l'expose via un petit protocole IPC (JSON ligne par ligne
// sur socket TCP localhost) à n'importe quel nombre d'agents CLI.
//
// Ce fichier est le point d'entrée lancé en détaché par `hublot start`. Il
// n'est jamais censé être exécuté interactivement par un humain.

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { chromium, BrowserContext, Page, ConsoleMessage } from './playwrightCore';
import { BROKER_HOST, BROKER_PORT, PROFILE_DIR, TABS_FILE, TOKEN_FILE, screenshotsDir, HUBLOT_HOME } from '../shared/paths';
import { BrokerRequest, BrokerResponse, ConsoleLogEntry, TabInfo } from '../shared/types';
import { ensureAuthToken, isAuthorized } from './auth';
import { isValidLabel } from '../shared/validate';

const MAX_CONSOLE_ENTRIES = 500;
// Une requete legitime (label/selector/texte/URL) ne depasse jamais quelques
// Ko ; ce plafond n'existe que pour qu'un client (bugue ou non authentifie)
// qui n'envoie jamais de saut de ligne ne fasse pas grossir le buffer du
// process sans limite (DoS memoire trivial sinon).
const MAX_LINE_BYTES = 1_048_576;
let authToken = '';

interface TabEntry {
  label: string;
  tabId: string;
  page: Page;
  consoleLogs: ConsoleLogEntry[];
}

const tabs = new Map<string, TabEntry>();
let context: BrowserContext | null = null;
let tabCounter = 0;

function nextTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function persistTabs(): void {
  const data: TabInfo[] = [...tabs.values()].map((t) => ({
    label: t.label,
    tabId: t.tabId,
    url: safeUrl(t.page),
  }));
  try {
    ensureDir(HUBLOT_HOME);
    fs.writeFileSync(TABS_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Persistance best-effort : une écriture ratée ne doit jamais faire tomber le broker.
  }
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}

function attachConsoleCapture(entry: TabEntry): void {
  entry.page.on('console', (msg: ConsoleMessage) => {
    entry.consoleLogs.push({ type: msg.type(), text: msg.text(), timestamp: Date.now() });
    if (entry.consoleLogs.length > MAX_CONSOLE_ENTRIES) {
      entry.consoleLogs.splice(0, entry.consoleLogs.length - MAX_CONSOLE_ENTRIES);
    }
  });
  entry.page.on('close', () => {
    if (tabs.get(entry.label) === entry) {
      tabs.delete(entry.label);
      persistTabs();
    }
  });
}

async function launchContext(): Promise<BrowserContext> {
  ensureDir(PROFILE_DIR);
  // headless: false est une exigence produit, pas une option : painteau doit
  // pouvoir cliquer/taper dans n'importe quel onglet à tout moment (ex.
  // mot de passe pendant qu'un agent travaille sur un autre onglet).
  const commonOptions = {
    headless: false,
    viewport: null,
  };
  // Ordre de repli : Chrome système (le plus courant) -> Edge système
  // (toujours présent sur Windows) -> Chromium téléchargé par Playwright
  // (nécessite `npx playwright install chromium`, voir README). Évite de
  // dépendre d'un téléchargement de binaire tant qu'un Chromium-based
  // existe déjà sur la machine.
  const channels: Array<'chrome' | 'msedge'> = ['chrome', 'msedge'];
  for (const channel of channels) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { ...commonOptions, channel });
    } catch (err) {
      console.error(`[hublot] channel "${channel}" indisponible:`, (err as Error).message);
    }
  }
  console.error('[hublot] aucun Chrome/Edge système trouvé, tentative avec le Chromium Playwright (npx playwright install chromium si cet essai échoue aussi).');
  return chromium.launchPersistentContext(PROFILE_DIR, commonOptions);
}

async function restorePersistedTabs(ctx: BrowserContext): Promise<void> {
  if (!fs.existsSync(TABS_FILE)) return;
  let previous: TabInfo[] = [];
  try {
    previous = JSON.parse(fs.readFileSync(TABS_FILE, 'utf-8'));
  } catch {
    return;
  }
  for (const info of previous) {
    try {
      const page = await ctx.newPage();
      const entry: TabEntry = { label: info.label, tabId: info.tabId, page, consoleLogs: [] };
      attachConsoleCapture(entry);
      tabs.set(info.label, entry);
      if (info.url) {
        await page.goto(info.url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      }
      const idNum = parseInt(info.tabId.replace('tab-', ''), 10);
      if (!Number.isNaN(idNum) && idNum > tabCounter) tabCounter = idNum;
    } catch {
      // Un onglet qui ne se restaure pas ne doit pas empêcher les autres/le démarrage.
    }
  }
  persistTabs();
}

async function getOrCreateTab(label: string): Promise<TabEntry> {
  const existing = tabs.get(label);
  if (existing) return existing;
  if (!context) throw new Error('contexte navigateur non initialisé');
  const page = await context.newPage();
  const entry: TabEntry = { label, tabId: nextTabId(), page, consoleLogs: [] };
  attachConsoleCapture(entry);
  tabs.set(label, entry);
  persistTabs();
  return entry;
}

function requireTab(label: string): TabEntry {
  const entry = tabs.get(label);
  if (!entry) throw new Error(`aucun onglet pour le label "${label}" (utiliser "hublot open --label ${label}" d'abord)`);
  return entry;
}

async function handle(req: BrokerRequest): Promise<BrokerResponse> {
  if ('label' in req && !isValidLabel(req.label)) {
    return { ok: false, error: 'label invalide : lettres/chiffres/tirets/underscores uniquement, 64 caracteres max, doit commencer par un caractere alphanumerique' };
  }
  switch (req.cmd) {
    case 'ping':
      return { ok: true, message: 'pong' };

    case 'status': {
      const list: TabInfo[] = [...tabs.values()].map((t) => ({ label: t.label, tabId: t.tabId, url: safeUrl(t.page) }));
      return { ok: true, tabs: list };
    }

    case 'open': {
      const alreadyOpen = tabs.has(req.label);
      const entry = await getOrCreateTab(req.label);
      await entry.page.bringToFront();
      if (req.url) {
        await entry.page.goto(req.url, { waitUntil: 'domcontentloaded' });
      }
      persistTabs();
      return { ok: true, message: alreadyOpen ? 'onglet réutilisé' : 'onglet créé', tabs: [{ label: entry.label, tabId: entry.tabId, url: safeUrl(entry.page) }] };
    }

    case 'navigate': {
      const entry = requireTab(req.label);
      await entry.page.goto(req.url, { waitUntil: 'domcontentloaded' });
      persistTabs();
      return { ok: true };
    }

    case 'click': {
      const entry = requireTab(req.label);
      await entry.page.click(req.selector);
      return { ok: true };
    }

    case 'type': {
      const entry = requireTab(req.label);
      await entry.page.locator(req.selector).fill(req.text);
      return { ok: true };
    }

    case 'extract': {
      const entry = requireTab(req.label);
      const text = req.selector
        ? await entry.page.locator(req.selector).innerText()
        : await entry.page.evaluate(() => document.body.innerText);
      return { ok: true, text };
    }

    case 'screenshot': {
      const entry = requireTab(req.label);
      const dir = screenshotsDir();
      ensureDir(dir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(dir, `${req.label}-${stamp}.png`);
      await entry.page.screenshot({ path: filePath });
      return { ok: true, path: filePath };
    }

    case 'console': {
      const entry = requireTab(req.label);
      return { ok: true, logs: entry.consoleLogs };
    }

    case 'close': {
      const entry = requireTab(req.label);
      await entry.page.close();
      tabs.delete(req.label);
      persistTabs();
      return { ok: true };
    }

    case 'stop': {
      setTimeout(() => shutdown(0), 50);
      return { ok: true, message: 'arrêt en cours' };
    }

    default:
      return { ok: false, error: `commande inconnue: ${JSON.stringify(req)}` };
  }
}

function startServer(): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';
    // Le CLI ferme sa connexion dès qu'il a sa réponse ; un client qui
    // raccroche brutalement (ECONNRESET) ne doit jamais faire tomber le
    // broker entier, seulement cette connexion.
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      if (buffer.length > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let idx: number;
      // Protocole ligne par ligne : une requête JSON par ligne, une réponse JSON par ligne.
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        void (async () => {
          let response: BrokerResponse;
          try {
            const req: BrokerRequest = JSON.parse(line);
            // Le port TCP loopback est joignable par tout compte Windows sur
            // cette machine, pas seulement celui qui a lance le broker : le
            // jeton est ce qui restreint reellement l'acces au meme
            // utilisateur (voir broker/auth.ts).
            if (!isAuthorized(req.token, authToken)) {
              response = { ok: false, error: 'unauthorized' };
            } else {
              response = await handle(req);
            }
          } catch (err) {
            response = { ok: false, error: (err as Error).message };
          }
          socket.write(JSON.stringify(response) + '\n');
        })();
      }
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Idempotence : un broker tourne déjà, celui-ci s'efface sans erreur.
      console.error('[hublot] port déjà occupé, un broker tourne probablement déjà, arrêt.');
      process.exit(0);
    }
    console.error('[hublot] erreur serveur IPC:', err);
    process.exit(1);
  });

  server.listen(BROKER_PORT, BROKER_HOST);
  return server;
}

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (context) await context.close();
  } catch {
    // rien à faire de plus, on quitte quand même
  }
  process.exit(code);
}

// Exportée (plutôt qu'un simple `main()` local) pour pouvoir être appelée en
// process depuis le CLI : c'est le chemin utilisé par l'exécutable unique
// (SEA), qui ne peut pas spawn un fichier dist/broker/index.js séparé
// puisqu'il n'existe qu'en tant que blob embarqué dans le binaire. Voir la
// commande cachée "__broker" dans cli/index.ts.
export async function runBroker(): Promise<void> {
  ensureDir(HUBLOT_HOME);
  authToken = ensureAuthToken(TOKEN_FILE);
  const server = startServer();
  context = await launchContext();

  // Onglet technique jamais exposé aux labels : sans lui, fermer le dernier
  // onglet d'un agent (`hublot close`) ferme la fenêtre du navigateur, donc
  // le contexte, donc le broker entier. Chrome/Edge quittent quand leur
  // dernière fenêtre se ferme, comportement natif qu'on ne peut pas désactiver
  // depuis Playwright.
  const keepAlive = await context.newPage();
  await keepAlive.goto('about:blank').catch(() => undefined);

  await restorePersistedTabs(context);

  context.on('close', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  server.on('close', () => shutdown(0));
}

// Point d'entrée classique : ce fichier compilé (dist/broker/index.js) est
// spawné directement par `node` dans la distribution npm-install habituelle
// (voir cli/index.ts, cas non-SEA). `require.main === module` garde cet
// auto-démarrage réservé à cet usage : quand ce module est simplement importé
// (empaqueté dans le bundle SEA de la commande "__broker"), rien ne doit se
// lancer tout seul au chargement.
if (require.main === module) {
  runBroker().catch((err) => {
    console.error('[hublot] échec au démarrage du broker:', err);
    process.exit(1);
  });
}
