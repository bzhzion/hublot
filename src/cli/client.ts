import * as net from 'net';
import { BROKER_HOST, BROKER_PORT, TOKEN_FILE } from '../shared/paths.js';
import { BrokerCommand, BrokerResponse } from '../shared/types.js';
import { readAuthToken } from '../broker/auth.js';

const CONNECT_TIMEOUT_MS = 2000;
const RESPONSE_TIMEOUT_MS = 30000;
// Meme plafond que le broker (defense en profondeur si jamais une reponse
// venait a grossir sans jamais envoyer son saut de ligne final).
const MAX_LINE_BYTES = 1_048_576;

export function sendRequest(cmd: BrokerCommand): Promise<BrokerResponse> {
  return new Promise((resolve, reject) => {
    const token = readAuthToken(TOKEN_FILE);
    if (!token) {
      reject(new Error('jeton d\'authentification introuvable, lancer "hublot start" d\'abord'));
      return;
    }
    const req = { ...cmd, token };
    const socket = net.createConnection({ host: BROKER_HOST, port: BROKER_PORT });
    let buffer = '';
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('timeout', () => fail(new Error('délai de connexion au broker dépassé')));
    socket.once('error', (err) => fail(err));

    socket.once('connect', () => {
      socket.setTimeout(RESPONSE_TIMEOUT_MS);
      socket.write(JSON.stringify(req) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      if (buffer.length > MAX_LINE_BYTES) {
        fail(new Error('réponse du broker anormalement volumineuse'));
        return;
      }
      const idx = buffer.indexOf('\n');
      if (idx >= 0 && !settled) {
        settled = true;
        const line = buffer.slice(0, idx).trim();
        socket.end();
        try {
          resolve(JSON.parse(line) as BrokerResponse);
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

export async function isBrokerRunning(): Promise<boolean> {
  try {
    const res = await sendRequest({ cmd: 'ping' });
    return res.ok;
  } catch {
    return false;
  }
}

// Distinct de isBrokerRunning() : le serveur TCP accepte des connexions des
// qu'il ecoute, avant meme que le navigateur soit lance (voir
// broker/index.ts, variable `ready`). Une commande qui a besoin d'un onglet
// doit attendre ready=true, pas juste un ping qui reussit.
export async function isBrokerReady(): Promise<boolean> {
  try {
    const res = await sendRequest({ cmd: 'ping' });
    return res.ok && res.ready === true;
  } catch {
    return false;
  }
}
