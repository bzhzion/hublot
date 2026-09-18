import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_PREFIX_SCRIPT } from '../dist/broker/branding.js';

// Le script de marquage s'exécute dans la page et non dans Node : on lui
// fabrique le strict minimum de DOM dont il se sert, puis on l'évalue. On
// IMPORTE la constante réellement injectée par le broker plutôt que d'en
// recopier la logique ici, sans quoi le test protégerait une copie et pas le
// code livré.
function runInFakeDom(initialTitle, { readyState = 'complete' } = {}) {
  const observers = [];
  const doc = {
    title: initialTitle,
    readyState,
    head: {},
    addEventListener(event, handler) {
      if (event === 'DOMContentLoaded') this._domContentLoaded = handler;
    },
  };
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
  }
  const run = new Function('document', 'MutationObserver', TITLE_PREFIX_SCRIPT);
  run(doc, FakeMutationObserver);
  // Rejoue ce que ferait le navigateur quand la page change son propre titre.
  const notifyTitleChanged = () => observers.forEach((o) => o.callback());
  return { doc, notifyTitleChanged, fireDomContentLoaded: () => doc._domContentLoaded?.() };
}

test('prefixe le titre d une page ordinaire', () => {
  const { doc } = runInFakeDom('GitHub');
  assert.equal(doc.title, '◉ Hublot — GitHub');
});

test('une page sans titre affiche le marqueur seul, sans separateur orphelin', () => {
  const { doc } = runInFakeDom('');
  assert.equal(doc.title, '◉ Hublot');
});

test('reappliquer n empile pas le prefixe (idempotent)', () => {
  const { doc, notifyTitleChanged } = runInFakeDom('GitHub');
  const apresPremierPassage = doc.title;
  notifyTitleChanged();
  notifyTitleChanged();
  assert.equal(doc.title, apresPremierPassage);
  assert.equal(doc.title, '◉ Hublot — GitHub');
});

test('un titre reecrit par la page est reprefixe', () => {
  const { doc, notifyTitleChanged } = runInFakeDom('Chargement');
  doc.title = 'Tableau de bord';
  notifyTitleChanged();
  assert.equal(doc.title, '◉ Hublot — Tableau de bord');
});

test('un titre deja prefixe n est pas dedouble apres reecriture partielle', () => {
  // Cas réel : une SPA lit document.title (déjà préfixé) et le réécrit en y
  // ajoutant un suffixe. Le marqueur ne doit apparaître qu'une fois.
  const { doc, notifyTitleChanged } = runInFakeDom('Boite');
  doc.title = doc.title + ' (3)';
  notifyTitleChanged();
  assert.equal(doc.title, '◉ Hublot — Boite (3)');
});

test('attend DOMContentLoaded quand le document est encore en chargement', () => {
  const { doc, fireDomContentLoaded } = runInFakeDom('Page', { readyState: 'loading' });
  assert.equal(doc.title, 'Page', 'rien ne doit etre pose avant DOMContentLoaded');
  fireDomContentLoaded();
  assert.equal(doc.title, '◉ Hublot — Page');
});
