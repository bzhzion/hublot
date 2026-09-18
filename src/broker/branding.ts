// Marquage visuel de la fenêtre Hublot.
//
// Motif : le navigateur de Hublot est un Chrome ordinaire, visuellement
// indistinguable du Chrome personnel de l'utilisateur. Constaté sur le poste :
// la fenêtre Hublot s'intitule `about:blank - Google Chrome` et la fenêtre
// personnelle `... - Google Chrome`, donc plus d'une fois la fenêtre Hublot a
// été fermée à la main par erreur, en plein travail d'un agent.
//
// ⚠️ Deux pistes ont été essayées et MESURÉES SANS EFFET, ne pas les
// reproposer sans preuve du contraire :
//   - renommer `profile.name` en « Hublot » : la clé s'écrit bien, mais aucune
//     pastille de profil n'apparaît dans la barre d'outils (la place est prise
//     par la pilule « Synchroniser l'historique ? » du compte connecté) ;
//   - se reposer sur le bandeau natif « Chrome est contrôlé par un logiciel de
//     test automatisé » : il porte une croix de fermeture, donc il disparaît au
//     premier clic.

// Le marqueur est U+25C9 (cercle pointé, qui évoque le hublot) suivi du nom,
// séparé du titre de la page par U+2014. Écrits en littéral UTF-8, comme le
// reste du dépôt. ⚠️ Si un jour ce fichier ressort avec un marqueur en
// mojibake, la cause est l'encodage d'un outil intermédiaire et non le code :
// le contrôle qui tranche est de relancer le broker et de lire le titre de la
// fenêtre, pas de relire le source.
const MARK = '◉ Hublot';
const SEP = ' — ';

// Script injecté dans CHAQUE page du contexte (pages futures comprises).
//
// Pourquoi le titre plutôt qu'un bandeau dans la page : le titre remonte tout
// seul là où l'utilisateur regarde avant de fermer une fenêtre — barre de
// titre, étiquette d'onglet, aperçu de barre des tâches, Alt-Tab — et il ne
// touche PAS au contenu rendu, donc il ne pollue ni les captures d'écran des
// agents ni leurs clics.
export const TITLE_PREFIX_SCRIPT = `(() => {
  const MARK = ${JSON.stringify(MARK)};
  const SEP = ${JSON.stringify(SEP)};

  // Retire un préfixe déjà posé, pour que réappliquer ne l'empile pas.
  const strip = (t) => {
    if (!t.startsWith(MARK)) return t;
    const rest = t.slice(MARK.length);
    return rest.startsWith(SEP) ? rest.slice(SEP.length) : rest;
  };

  const apply = () => {
    const base = strip(document.title || '');
    // Une page sans titre (about:blank, onglet technique) affiche le marqueur
    // seul plutôt qu'un séparateur orphelin.
    const want = base ? MARK + SEP + base : MARK;
    // ⚠️ Le garde-fou contre la boucle infinie est cette comparaison, pas un
    // drapeau : écrire document.title déclenche l'observateur, mais au second
    // passage la valeur voulue est déjà en place et on n'écrit plus.
    if (document.title !== want) document.title = want;
  };

  const observe = () => {
    apply();
    const head = document.head;
    if (!head) return;
    // On observe <head> entier et pas le seul <title> : beaucoup de SPA
    // REMPLACENT l'élément <title> au lieu d'en modifier le texte, auquel cas
    // un observateur attaché à l'ancien élément ne verrait plus rien.
    new MutationObserver(apply).observe(head, { childList: true, subtree: true, characterData: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, { once: true });
  } else {
    observe();
  }
})()`;
