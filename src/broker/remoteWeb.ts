// Acces web distant optionnel, meme principe que "beammeup web on/off/status" :
// un serveur HTTP en polling (pas de WebSocket, choix volontaire pour rester
// simple et auditable), ferme par defaut, jeton bearer auto-genere sauf
// --no-token explicite, aucune restriction cote code sur l'adresse d'ecoute
// (0.0.0.0 fonctionnerait si l'appelant le demande explicitement, mais ni ce
// module ni un agent ne doit choisir ça a la place de painteau).
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as url from 'url';
import { TabInfo } from '../shared/types.js';

export interface RemoteConfig {
  enabled: boolean;
  bind: string;
  token: string | null;
}

const DEFAULT_CONFIG: RemoteConfig = { enabled: false, bind: '127.0.0.1:9871', token: null };

export function readRemoteConfig(file: string): RemoteConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, 'utf-8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeRemoteConfig(file: string, config: RemoteConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

export function generateToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function isAuthorizedQuery(expected: string | null, provided: string | null): boolean {
  if (!expected) return true; // --no-token : acces ouvert, choix explicite de l'utilisateur
  if (!provided) return false;
  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(provided, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function renderPage(token: string | null): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hublot - acces distant</title>
<style>
  body { background:#0a141c; color:#f3ecd8; font-family: system-ui, sans-serif; margin:0; padding:1rem; }
  select, img { width:100%; box-sizing:border-box; }
  select { padding:0.5rem; background:#0f1e29; color:#f3ecd8; border:1px solid #caa03f; border-radius:6px; }
  img { border-radius:8px; margin-top:0.75rem; background:#000; display:block; min-height:200px; }
  p { color:#c3b89a; font-size:0.85rem; }
</style></head>
<body>
<select id="label"><option>(chargement...)</option></select>
<img id="shot" alt="capture de l'onglet selectionne" />
<p>Rafraichi automatiquement. Lecture seule pour l'instant.</p>
<script>
  const token = ${JSON.stringify(token)};
  function withToken(path) { return token ? path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : path; }
  async function refreshTabs() {
    const res = await fetch(withToken('/tabs'));
    if (!res.ok) return;
    const tabs = await res.json();
    const sel = document.getElementById('label');
    const current = sel.value;
    sel.innerHTML = tabs.length
      ? tabs.map((t) => '<option value="' + t.label + '">' + t.label + ' - ' + t.url + '</option>').join('')
      : '<option value="">(aucun onglet ouvert)</option>';
    if (tabs.some((t) => t.label === current)) sel.value = current;
  }
  async function refreshShot() {
    const label = document.getElementById('label').value;
    if (!label) return;
    const res = await fetch(withToken('/screenshot?label=' + encodeURIComponent(label)));
    if (!res.ok) return;
    const blob = await res.blob();
    document.getElementById('shot').src = URL.createObjectURL(blob);
  }
  refreshTabs();
  setInterval(refreshTabs, 4000);
  setInterval(refreshShot, 1500);
</script>
</body></html>`;
}

export interface RemoteWebDeps {
  listTabs: () => TabInfo[];
  screenshotBuffer: (label: string) => Promise<Buffer>;
}

export function startRemoteWeb(bind: string, token: string | null, deps: RemoteWebDeps): http.Server {
  const idx = bind.lastIndexOf(':');
  const host = idx > 0 ? bind.slice(0, idx) : bind;
  const port = idx > 0 ? Number(bind.slice(idx + 1)) : 9871;

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url || '', true);
    const provided = typeof parsed.query.token === 'string' ? parsed.query.token : null;
    const authorized = isAuthorizedQuery(token, provided);

    if (parsed.pathname === '/') {
      if (!authorized) { res.writeHead(401).end('unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage(token));
      return;
    }
    if (parsed.pathname === '/tabs') {
      if (!authorized) { res.writeHead(401).end('unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(deps.listTabs()));
      return;
    }
    if (parsed.pathname === '/screenshot') {
      if (!authorized) { res.writeHead(401).end('unauthorized'); return; }
      const label = typeof parsed.query.label === 'string' ? parsed.query.label : '';
      deps
        .screenshotBuffer(label)
        .then((buf) => res.writeHead(200, { 'Content-Type': 'image/png' }).end(buf))
        .catch((err) => res.writeHead(500).end((err as Error).message));
      return;
    }
    res.writeHead(404).end('not found');
  });

  server.listen(port, host);
  return server;
}

export function stopRemoteWeb(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
