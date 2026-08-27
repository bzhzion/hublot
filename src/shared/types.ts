// Types partagés entre le broker et le CLI (protocole IPC en JSON, une ligne par message).

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkLogEntry {
  method: string;
  url: string;
  status: number | null;
  timestamp: number;
}

export interface FindMatch {
  tag: string;
  text: string;
}

export interface TabInfo {
  label: string;
  tabId: string;
  url: string;
}

export interface RemoteWebStatus {
  enabled: boolean;
  bind?: string;
  hasToken?: boolean;
}

export type BrokerCommand =
  | { cmd: 'ping' }
  | { cmd: 'status' }
  | { cmd: 'open'; label: string; url?: string }
  | { cmd: 'navigate'; label: string; url: string }
  | { cmd: 'back'; label: string }
  | { cmd: 'click'; label: string; selector: string }
  | { cmd: 'hover'; label: string; selector: string }
  | { cmd: 'type'; label: string; selector: string; text: string }
  | { cmd: 'press'; label: string; selector?: string; key: string }
  | { cmd: 'select'; label: string; selector: string; value: string }
  | { cmd: 'drag'; label: string; source: string; target: string }
  | { cmd: 'upload'; label: string; selector: string; files: string }
  | { cmd: 'dialog'; label: string; action: 'accept' | 'dismiss'; text?: string }
  | { cmd: 'wait'; label: string; selector?: string; text?: string; timeoutMs?: number }
  | { cmd: 'find'; label: string; text: string }
  | { cmd: 'evaluate'; label: string; expression: string }
  // DANGER volontaire : execute du code Playwright arbitraire dans le
  // process du broker (Node complet : fs, child_process, reseau...), pas
  // seulement dans le bac a sable JS de la page comme "evaluate". Choix
  // assume pour un usage personnel sur une machine deja controlee par
  // painteau, jamais destine a un environnement partage. Voir
  // docs/hublot.md, registre d'audit, section "risque accepte".
  | { cmd: 'run_unsafe'; label: string; code: string }
  | { cmd: 'resize'; label: string; width: number; height: number }
  | { cmd: 'extract'; label: string; selector?: string }
  | { cmd: 'snapshot'; label: string }
  | { cmd: 'screenshot'; label: string }
  | { cmd: 'console'; label: string }
  | { cmd: 'network'; label: string }
  | { cmd: 'close'; label: string }
  // Acces web distant optionnel (voir broker/remoteWeb.ts), meme principe
  // que "beammeup web on/off/status" : ferme par defaut, jeton auto-genere
  // sauf --no-token explicite, aucune restriction sur l'adresse d'ecoute
  // (0.0.0.0 accepte si c'est le choix explicite de l'utilisateur).
  | { cmd: 'web_on'; bind: string; noToken?: boolean }
  | { cmd: 'web_off' }
  | { cmd: 'web_status' }
  | { cmd: 'stop' };

// Le jeton d'auth (voir broker/auth.ts) est ajoute par le client au moment de
// l'envoi, pas par chaque appelant : BrokerCommand reste le type que le CLI
// manipule, BrokerRequest est ce qui transite reellement sur le socket.
export type BrokerRequest = BrokerCommand & { token: string };

export type BrokerResponse =
  | {
      ok: true;
      tabs?: TabInfo[];
      text?: string;
      path?: string;
      logs?: ConsoleLogEntry[];
      requests?: NetworkLogEntry[];
      matches?: FindMatch[];
      result?: string;
      message?: string;
      ready?: boolean;
      web?: RemoteWebStatus;
    }
  | { ok: false; error: string };
