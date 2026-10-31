# goodplay

Application web pour pianistes débutants : elle écoute un chant (une voix ou un chœur), trouve la tonalité en quelques secondes, puis **souffle le degré de basse à jouer** (« le 4 », « le 5 »…), à l'écran et/ou à l'oreille. Elle construit la grille de la chanson, propose des accords enrichis et des accords de passage, et montre les doigtés main gauche / main droite.

## Essayer
- En ligne : `https://koudadjekossiprospere.github.io/goodplay/`
- Sur PC : ouvrir l'adresse dans Chrome ou Edge, puis **Écouter** (ou la touche **Espace**). `N` démarre un nouveau chant.
- Sur iPhone : ouvrir dans **Safari**, toucher **Écouter**, autoriser. Partager → « Sur l'écran d'accueil » pour l'utiliser comme une appli.
- Sans micro : **Analyser un enregistrement** (un mémo vocal où tu chantes) ou **Voir la démo**.
- En local : `python -m http.server 8830` dans ce dossier, puis `http://localhost:8830`.

## Fonctions
- Détection de tonalité (majeur/mineur) et des changements de tonalité en cours de chant
- Degré de basse à jouer + prédiction du prochain accord
- Grille par phrases et par sections (A, B…), plusieurs chants par session
- Enrichissement : base, 7e, 9e + accords de passage
- Clavier illustré avec doigtés
- Option « Je joue en Do et je transpose »
- Sortie : écran + voix, voix seule (lunettes sans écran), écran seul
- Ligne mélodique, paroles (expérimental)

## Structure
- `index.html` — toute l'application
- `manifest.webmanifest`, `icon*.png`, `icon.svg` — installation sur l'écran d'accueil
- `tests/` — tests de la logique de tonalité (`node tests/…`)
