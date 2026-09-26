// Patches JS injectés dans chaque page pour réduire l'empreinte d'automatisation.
//
// Couvre les signaux JS-level que rebrowser-playwright-core ne patch pas (il
// couvre la couche CDP). L'arg --disable-blink-features=AutomationControlled
// (posé dans launchContext) retire navigator.webdriver au niveau Chrome ; ce
// script est un filet de sécurité pour les cas où l'arg n'a pas d'effet
// (ex. repli Chromium Playwright sans channel).

export const STEALTH_SCRIPT = `(() => {
  // navigator.webdriver : le signal de détection le plus basique.
  // Présent uniquement dans les navigateurs pilotés, toujours absent chez un
  // vrai utilisateur.
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // window.chrome : l'objet chrome.runtime est présent dans Chrome réel et
  // absent dans Chrome piloté par défaut. Beaucoup de scripts de détection
  // testent typeof window.chrome.
  if (!window.chrome) {
    Object.defineProperty(window, 'chrome', {
      writable: true,
      enumerable: true,
      configurable: false,
      value: { runtime: {} },
    });
  }

  // navigator.languages : parfois vide dans les contextes automatisés.
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['fr-FR', 'fr', 'en-US', 'en'],
    });
  }
})()`;
