// Types partagés entre le broker et le CLI (protocole IPC en JSON, une ligne par message).

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
}

export interface TabInfo {
  label: string;
  tabId: string;
  url: string;
}

export type BrokerCommand =
  | { cmd: 'ping' }
  | { cmd: 'status' }
  | { cmd: 'open'; label: string; url?: string }
  | { cmd: 'navigate'; label: string; url: string }
  | { cmd: 'click'; label: string; selector: string }
  | { cmd: 'type'; label: string; selector: string; text: string }
  | { cmd: 'extract'; label: string; selector?: string }
  | { cmd: 'screenshot'; label: string }
  | { cmd: 'console'; label: string }
  | { cmd: 'close'; label: string }
  | { cmd: 'stop' };

// Le jeton d'auth (voir broker/auth.ts) est ajoute par le client au moment de
// l'envoi, pas par chaque appelant : BrokerCommand reste le type que le CLI
// manipule, BrokerRequest est ce qui transite reellement sur le socket.
export type BrokerRequest = BrokerCommand & { token: string };

export type BrokerResponse =
  | { ok: true; tabs?: TabInfo[]; text?: string; path?: string; logs?: ConsoleLogEntry[]; message?: string }
  | { ok: false; error: string };
