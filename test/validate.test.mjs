import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidLabel } from '../dist/shared/validate.js';

test('accepte les labels normaux', () => {
  assert.equal(isValidLabel('claude-main'), true);
  assert.equal(isValidLabel('agent_debug_2'), true);
  assert.equal(isValidLabel('a'), true);
});

test('rejette la traversee de chemin (finding secu-audit)', () => {
  assert.equal(isValidLabel('../../../../Windows/System32/evil'), false);
  assert.equal(isValidLabel('..\\..\\evil'), false);
  assert.equal(isValidLabel('foo/bar'), false);
  assert.equal(isValidLabel('foo\\bar'), false);
});

test('rejette les types et formes invalides', () => {
  assert.equal(isValidLabel(''), false);
  assert.equal(isValidLabel('-starts-with-dash'), false);
  assert.equal(isValidLabel('a'.repeat(65)), false);
  assert.equal(isValidLabel(42), false);
  assert.equal(isValidLabel(null), false);
  assert.equal(isValidLabel(undefined), false);
});
