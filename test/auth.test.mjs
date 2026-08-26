import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureAuthToken, readAuthToken, isAuthorized } from '../dist/broker/auth.js';

test('ensureAuthToken genere un jeton et le reutilise (idempotent)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hublot-auth-test-'));
  const tokenFile = path.join(dir, 'token');
  try {
    const first = ensureAuthToken(tokenFile);
    assert.equal(first.length, 64); // 32 octets en hex
    const second = ensureAuthToken(tokenFile);
    assert.equal(first, second);
    assert.equal(readAuthToken(tokenFile), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAuthToken renvoie null si le fichier n\'existe pas', () => {
  assert.equal(readAuthToken('/chemin/qui/n/existe/pas/token'), null);
});

test('isAuthorized : le mauvais jeton echoue (finding secu-audit : IPC sans auth)', () => {
  const real = 'a'.repeat(64);
  assert.equal(isAuthorized('b'.repeat(64), real), false);
  assert.equal(isAuthorized('trop-court', real), false);
  assert.equal(isAuthorized('', real), false);
  assert.equal(isAuthorized(undefined, real), false);
  assert.equal(isAuthorized(123, real), false);
});

test('isAuthorized : le bon jeton passe', () => {
  const real = 'c'.repeat(64);
  assert.equal(isAuthorized('c'.repeat(64), real), true);
});
