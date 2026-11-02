/* Choisit quoi proposer en live pour un enchaînement et un style. Le squelette reste affiché en grand : on propose peu. Sans DOM. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  if (typeof require === 'function') { if (!GP.mod) require('./theorie.js'); if (!GP.voicing) require('./doigtes.js'); if (!GP.catalogue) require('./catalogue.js'); }
  const { mod, Q } = GP;
  const REPOS = 4, MEMOIRE = 12; // 4 cases de silence au début et après une proposition, soit une par phrase environ ; une entrée vue ne revient pas avant 12 cases
  /* L'ordre d'un professeur : à nombre de passages égal, le geste le plus simple et le plus entendu d'abord. */
  const D_ABORD = ['slash-4-sur-5', 'slash-1-sur-3', 'passage-dim-sharp4', 'passage-dim-sharp1', 'sub-4m-avant-1', 'slash-5-sur-7', 'couleur-sus4-sur-5', 'couleur-add2-sur-1', 'passage-2-5-vers-1', 'passage-3dom-vers-6', 'passage-6dom-vers-2', 'passage-2dom-vers-5', 'passage-1dom-vers-4', 'rel-6m-pour-1', 'rel-2m-pour-4', 'couleur-7-sur-5', 'couleur-m7-sur-2', 'couleur-m7-sur-6', 'couleur-add2-sur-4',
    'min-couleur-sus4-sur-5', 'min-couleur-m7-sur-1', 'min-passage-1dom-vers-4', 'min-passage-7dom-vers-3', 'min-rel-3-pour-1', 'min-couleur-m7-sur-4'];
  const rang = e => { const i = D_ABORD.indexOf(e.id); return i < 0 ? D_ABORD.length : i; };

  /* Une proposition ne doit pas contredire la note que le chantre tient (docs/recherche/pianiste.md). */
  function compatible(e, note) {
    if (note == null) return true;
    const a = e.accords[0], rel = mod(note - a.rac);
    if (rel === 0 && ['maj7', 'maj9', 'maj13'].includes(a.q)) return false;
    return Q[a.q].some(i => mod(i) === rel) || mod(note) === mod(a.basse); // la basse d'un slash compte : sol tenu sur le 4 sur 5
  }

  /* dejaVus est le journal de la grille, tenu ici : l'appelant garde le même tableau d'un appel à l'autre. Une case par appel, null si rien n'est proposé. */
  function suggestions({ deg, suivant = null, mode = 'maj', style = null, niveau = 1, dejaVus = [], noteChantee = null }) {
    const recents = dejaVus.slice(-REPOS), passe = dejaVus.slice(-MEMOIRE);
    const rien = () => { dejaVus.push(null); return []; };
    if (!niveau || dejaVus.length < REPOS || recents.some(x => x)) return rien(); // le squelette d'abord
    // Une couleur n'annonce pas l'accord qui suit : pas de 6 mineur pour le 1 juste avant le 6.
    const cible = suivant != null && GP.DEGRES[mode][suivant], redite = e => e.quand.sur != null && cible && mod(e.accords[0].rac) === cible[0] && cible[0] !== GP.DEGRES[mode][deg][0];
    const ok = e => e.live && e.mode === mode && e.niveau <= niveau && (!style || e.style.includes(style)) && !passe.includes(e.id) && !redite(e) && compatible(e, noteChantee);
    const liens = suivant == null ? [] : GP.catalogue.filter(e => ok(e) && e.quand.de === deg && e.quand.vers === suivant);
    const couleurs = GP.catalogue.filter(e => ok(e) && e.quand.sur === deg);
    if (!liens.length && !couleurs.length) return rien();
    // Le moins entendu dans cette grille passe d'abord : deux passages au même endroit ne proposent pas la même chose. Un lien n'écrase plus une couleur, sinon le 4 sur 5 ne sort jamais avant un 1.
    const vu = e => dejaVus.filter(x => x === e.id).length;
    const ordre = l => l.slice().sort((x, y) => vu(x) - vu(y) || y.niveau - x.niveau || rang(x) - rang(y));
    const a = ordre([...liens, ...couleurs])[0], b = ordre(couleurs.filter(e => e !== a && e.famille !== a.famille))[0];
    const res = b && niveau >= 2 ? [a, b] : [a];
    dejaVus.push(res[0].id); res.slice(1).forEach(e => dejaVus.push(e.id));
    return res;
  }

  /* Convertit une entrée en accords réels et midi. Les demi-tons du catalogue partent de la tonique. */
  function jouerEntree(entree, tonalite) {
    let prec = null;
    return entree.accords.map(a => {
      const racine = mod(tonalite.tonic + a.rac), basse = mod(tonalite.tonic + a.basse), v = GP.placerForme(a, tonalite.tonic, prec, entree.accords.length === 1);
      prec = v.md;
      return { racine, q: a.q, basse, ...v };
    });
  }

  Object.assign(GP, { suggestions, jouerEntree });
})();
