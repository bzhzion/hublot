import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveHublotHome, migrateLegacyHome } from '../dist/shared/paths.js';
import { rotateLog } from '../dist/shared/logRotate.js';
import { writeRemoteConfig } from '../dist/broker/remoteWeb.js';

function temp() {
  return mkdtempSync(path.join(tmpdir(), 'hublot-stockage-'));
}

test('resolveHublotHome : Windows garde LOCALAPPDATA, Linux suit XDG puis ~/.config', () => {
  assert.equal(
    resolveHublotHome({ platform: 'win32', env: { LOCALAPPDATA: path.join('C:', 'L') }, homedir: 'h' }),
    path.join('C:', 'L', 'hublot'),
  );
  assert.equal(
    resolveHublotHome({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' }, homedir: '/home/a' }),
    path.join('/x', 'hublot'),
  );
  assert.equal(
    resolveHublotHome({ platform: 'linux', env: {}, homedir: '/home/a' }),
    path.join('/home/a', '.config', 'hublot'),
  );
});

test('migrateLegacyHome : deplace l ancien dossier Linux, profil compris, une seule fois', () => {
  const home = temp();
  try {
    const ctx = { platform: 'linux', env: {}, homedir: home };
    const old = path.join(home, 'AppData', 'Local', 'hublot');
    mkdirSync(path.join(old, 'profile'), { recursive: true });
    writeFileSync(path.join(old, 'profile', 'cookies'), 'session');
    assert.equal(migrateLegacyHome(ctx), true);
    assert.equal(existsSync(old), false);
    assert.equal(readFileSync(path.join(home, '.config', 'hublot', 'profile', 'cookies'), 'utf-8'), 'session');
    assert.equal(migrateLegacyHome(ctx), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('migrateLegacyHome : ne touche pas a un dossier neuf deja present, ni sous Windows', () => {
  const home = temp();
  try {
    const old = path.join(home, 'AppData', 'Local', 'hublot');
    mkdirSync(old, { recursive: true });
    mkdirSync(path.join(home, '.config', 'hublot'), { recursive: true });
    assert.equal(migrateLegacyHome({ platform: 'linux', env: {}, homedir: home }), false);
    assert.equal(existsSync(old), true);
    assert.equal(migrateLegacyHome({ platform: 'win32', env: {}, homedir: home }), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('rotateLog : met de cote au-dela du seuil, laisse un petit journal tranquille', () => {
  const dir = temp();
  try {
    const log = path.join(dir, 'broker.log');
    writeFileSync(log, 'abc');
    assert.equal(rotateLog(log, 10), false);
    assert.equal(existsSync(log), true);
    writeFileSync(log, 'x'.repeat(50));
    assert.equal(rotateLog(log, 10), true);
    assert.equal(existsSync(log), false);
    assert.equal(statSync(`${log}.1`).size, 50);
    assert.equal(rotateLog(path.join(dir, 'absent.log'), 10), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRemoteConfig : proprietaire seul, y compris sur un fichier deja ouvert en 0644', { skip: process.platform === 'win32' }, () => {
  const dir = temp();
  try {
    const file = path.join(dir, 'remote.json');
    writeFileSync(file, '{}', { mode: 0o644 });
    writeRemoteConfig(file, { enabled: true, bind: '127.0.0.1:9871', token: 'abc' });
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
