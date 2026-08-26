import * as net from 'net';
import { BROKER_HOST, BROKER_PORT } from '../shared/paths';
import { BrokerRequest, BrokerResponse } from '../shared/types';

const CONNECT_TIMEOUT_MS = 2000;
const RESPONSE_TIMEOUT_MS = 30000;

export function sendRequest(req: BrokerRequest): Promise<BrokerResponse> {
  return new Promise((resolve, reject) => {
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
