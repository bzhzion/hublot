#!/usr/bin/env python3
"""Garde-fou : la politique de confidentialite doit decrire ce que Hublot ecrit et ouvre.

Deux controles, derives du code et non declares a la main :

1. Chaque nom de fichier ou de dossier construit dans `src/shared/paths.ts`, et chaque nom de
   fichier ecrit en dur ailleurs dans `src/`, doit apparaitre dans `site/privacy.html`.
2. L'inventaire des points d'ecriture, d'ecoute et de connexion (`writeFileSync`, `listen(`,
   `fetch(`...) est compare a `scripts/ecritures-disque.json`. Un ecart ne dit pas que la
   politique est fausse, il dit qu'il faut la RELIRE. Apres relecture, `--maj` enregistre le
   nouvel inventaire.

Pourquoi : la politique de BeamMeUp avait affirme deux fois des choses fausses sur ce que
l'application ecrit, relevees par un moderateur winget puis par une relecture du code. Celle de
Hublot a ete ecrite d'apres le code le 2026-10-08, et ce controle empeche qu'elle redevienne fausse
sans que personne le voie, y compris quand une version part sur winget sans relecture.

Limite assumee : il ne voit pas ce que le navigateur pilote ecrit dans son profil, ni un chemin
construit dynamiquement. C'est pourquoi le controle 2 existe.
"""
import html
import json
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SOURCES = RACINE / "src"
CHEMINS = SOURCES / "shared" / "paths.ts"
POLITIQUE = RACINE / "site" / "privacy.html"
REFERENCE = Path(__file__).resolve().parent / "ecritures-disque.json"

MOTIFS = [
    "writeFileSync", "writeFile(", "appendFile", "createWriteStream", "openSync", "mkdirSync",
    "copyFileSync", "renameSync", "rmSync", "unlinkSync", "tmpdir()", "homedir()", "LOCALAPPDATA",
    "process.env.TEMP", "launchPersistentContext", "screenshot(", "createServer(", ".listen(",
    "createConnection(", "fetch(", "http.request", "http.get", "https.", "WebSocket", "dns.",
    "spawn(", "execFile(", "exec(",
]
NOM_EN_DUR = re.compile(r"[`'\"]([\w.${}\-]*\.(?:json|log|png|txt|db|sqlite))[`'\"]")
APPEL_CHEMIN = re.compile(r"path\.join\(\s*(?:HUBLOT_HOME|tempDir)\s*,\s*'([^']+)'\s*\)")


def fichiers_ts():
    return sorted(SOURCES.rglob("*.ts"))


def lignes_de_code(chemin: Path):
    """Lignes hors commentaires : un commentaire qui cite un motif ne l'execute pas."""
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        s = ligne.strip()
        if not (s.startswith("//") or s.startswith("*") or s.startswith("/*")):
            yield ligne


def inventaire():
    resultat = {}
    for fichier in fichiers_ts():
        compte = {}
        for ligne in lignes_de_code(fichier):
            for motif in MOTIFS:
                if motif in ligne:
                    compte[motif] = compte.get(motif, 0) + 1
        if compte:
            resultat[fichier.relative_to(SOURCES).as_posix()] = compte
    return resultat


def noms():
    trouves = set(APPEL_CHEMIN.findall(CHEMINS.read_text(encoding="utf-8")))
    for fichier in fichiers_ts():
        for ligne in lignes_de_code(fichier):
            trouves.update(NOM_EN_DUR.findall(ligne))
    return trouves


def fragments(nom: str):
    """`${label}-${stamp}.png` -> ['.png'] : chaque morceau fixe utile doit etre dans la politique."""
    return [f for f in re.split(r"\$\{[^}]*\}", nom) if len(f) >= 3]


def texte_visible(page: str) -> str:
    """Le texte du corps de la page, sans balises ni scripts.

    Comparer a la page entiere laissait un nom generique comme `.png` etre « cite » par un lien
    d'icone de l'en-tete : le controle passait au vert sans que la politique dise quoi que ce soit.
    """
    corps = re.search(r"<body[^>]*>(.*)</body>", page, re.S)
    texte = corps.group(1) if corps else page
    texte = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", texte, flags=re.S)
    return html.unescape(re.sub(r"<[^>]+>", " ", texte))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    politique = texte_visible(POLITIQUE.read_text(encoding="utf-8"))
    erreurs = []

    for nom in sorted(noms()):
        manquants = [f for f in fragments(nom) if f not in politique]
        if manquants:
            erreurs.append(f"le code nomme « {nom} » mais site/privacy.html ne cite pas {manquants}")

    courant = inventaire()
    if "--maj" in sys.argv:
        REFERENCE.write_text(json.dumps(courant, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"reference mise a jour : {REFERENCE.relative_to(RACINE)}")
    elif not REFERENCE.exists():
        erreurs.append("pas de reference : lancer `python scripts/verifier-ecritures-disque.py --maj`")
    else:
        attendu = json.loads(REFERENCE.read_text(encoding="utf-8"))
        for fichier in sorted(set(attendu) | set(courant)):
            if attendu.get(fichier) != courant.get(fichier):
                erreurs.append(
                    f"{fichier} : les points d'ecriture, d'ecoute ou de connexion ont change "
                    f"(reference {attendu.get(fichier)}, code {courant.get(fichier)})"
                )

    if erreurs:
        print("ECRITURES ET RESEAU : la politique de confidentialite est peut-etre devenue fausse.")
        for e in erreurs:
            print(f"  - {e}")
        print(
            "Relire site/privacy.html contre le code, la corriger si besoin, puis "
            "`python scripts/verifier-ecritures-disque.py --maj`."
        )
        return 1

    print(f"ecritures et reseau : conforme ({len(noms())} noms cites, "
          f"{sum(len(v) for v in courant.values())} motifs inventories).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
