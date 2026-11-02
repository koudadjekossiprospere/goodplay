# goodplay

Application web pour pianistes débutants : elle écoute un chant (une voix ou un chœur), trouve la tonalité en quelques secondes, puis **souffle le degré de basse à jouer** (« le 4 », « le 5 »…). Elle construit la grille de la chanson, propose des enrichissements et montre les doigtés sur un clavier avec les deux mains.

## Essayer
- En ligne : `https://koudadjekossiprospere.github.io/goodplay/`
- Sur PC : ouvrir l'adresse dans Chrome ou Edge, puis **Écouter** (ou la touche **Espace**). `N` démarre un nouveau chant.
- Sur iPhone : ouvrir dans **Safari**, toucher **Écouter**, autoriser. Partager → « Sur l'écran d'accueil » pour l'utiliser comme une appli.
- Sans micro : **Analyser un enregistrement** (un mémo vocal où tu chantes) ou **Voir la démo**.
- En local : `python -m http.server 8830` dans ce dossier, puis `http://localhost:8830`.

## Fonctions
**Live**
- Tonalité avec trois états (hypothèse, probable, sûre) et preuve forte avant d'annoncer une modulation
- Reconnaissance du chant par sa mélodie : la grille enregistrée remplace les accords devinés, et un chant corrigé entre dans ta base
- Grille de basse : le squelette du chant, une ligne par phrase, lettres de section
- Maintenant et Ensuite, anticipation sur les reprises, correction d'une case d'un toucher (réutilisée aux reprises)
- Transpose : tu choisis la tonalité où tu joues, la vraie tonalité du chant reste affichée, le son reste celui du chant
- Grille mélodique : accords en haut, chaque note avec son trait et son nom
- Clavier avec mains animées et doigtés enseignés, orange à gauche, bleu à droite
- Enrichissements proposés à petite dose, selon le style

**Labs, « Enrichir mon jeu »**
- Parcours de leçons courtes, catalogue de techniques (Gospel par défaut), avant et après à écouter, 12 tonalités
- Apprendre un chant en trois étapes : squelette, accords, enrichissement

## Structure
- `index.html`, `css/` : page et styles
- `js/moteur.js` : hauteur, accordage, tonalité, accords, mémoire de phrase (sans DOM, testé sous node)
- `js/reconnaissance.js`, `js/base-hymnes.js` : reconnaissance du chant et base de cantiques, mélodies et basses seulement, sans paroles
- `js/theorie.js`, `js/doigtes.js`, `js/enrichir.js`, `js/catalogue.js` : théorie, voicings, enrichissements
- `js/audio.js`, `js/worklet-capture.js` : micro, fichier, démo, écoute
- `js/app.js`, `js/clavier.js`, `js/labs.js`, `js/chants.js` : interface
- `manifest.webmanifest`, `icon*.png`, `icon.svg` : installation sur l'écran d'accueil
- `tests/` : `node tests/test-*.js` pour les contrôles, `node tests/mesure.js` pour la mesure sur le corpus (20 min)

## Sources
- Base de chants : Open Hymnal Project, édition 2014.06, récupérée via l'archive du web. Seuls les airs dont la musique et l'arrangement sont indiqués libres selon le droit américain sont gardés, sans paroles. Détail à vérifier hors des États-Unis.
- Démo : Amazing Grace, Vera Hall, Dock Reed, Jesse Allison, Alabama, 1937, domaine public selon Wikimedia Commons.
