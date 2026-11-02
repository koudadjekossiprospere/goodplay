/* Théorie : notes, noms, qualités d'accords, degrés, Transpose. Sans DOM. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  const mod = n => ((n % 12) + 12) % 12;

  const NOMS = {
    fr: { d: ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'], b: ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'], maj: 'majeur', min: 'mineur' },
    en: { d: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], b: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'], maj: 'major', min: 'minor' }
  };
  const bemols = k => !!k && (k.mode === 'maj' ? [5, 10, 3, 8, 1, 6] : [2, 7, 0, 5, 10, 3]).includes(mod(k.tonic));
  const nomNote = (pc, k, notation = 'fr') => NOMS[notation][bemols(k) ? 'b' : 'd'][mod(pc)];
  const nomTonalite = (k, notation = 'fr') => nomNote(k.tonic, k, notation) + ' ' + NOMS[notation][k.mode];

  /* Intervalles depuis la fondamentale. Le 11 s'entend sans tierce, comme le 4 sur 5. */
  const Q = {
    maj: [0, 4, 7], min: [0, 3, 7], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], add2: [0, 2, 4, 7], add9: [0, 4, 7, 14],
    '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '69': [0, 4, 7, 9, 14], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], mmaj7: [0, 3, 7, 11],
    '7sus4': [0, 5, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14],
    '7b9': [0, 4, 7, 10, 13], '7s9': [0, 4, 7, 10, 15], '7s5s9': [0, 4, 8, 10, 15], '11': [0, 7, 10, 14, 17], m11: [0, 3, 7, 10, 14, 17],
    '13': [0, 4, 7, 10, 14, 21], '13b9': [0, 4, 10, 13, 21], maj13: [0, 4, 7, 11, 14, 21]
  };
  const SUFFIXE = {
    maj: '', min: 'm', aug: '+', sus2: 'sus2', sus4: 'sus4', add2: 'add2', add9: 'add9', '6': '6', m6: 'm6', '69': '6/9', maj7: '7M', m7: 'm7', '7': '7', mmaj7: 'm7M',
    '7sus4': '7sus4', m7b5: 'm7♭5', dim7: '°7', maj9: '9M', m9: 'm9', '9': '9', '7b9': '7♭9', '7s9': '7♯9', '7s5s9': '7♯5♯9', '11': '11', m11: 'm11',
    '13': '13', '13b9': '13♭9', maj13: '13M'
  };

  /* Degrés : demi-tons depuis la tonique et qualité. En mineur, 5 est majeur à cause de la sensible. */
  const DEGRES = {
    maj: { 1: [0, 'maj'], 2: [2, 'min'], 3: [4, 'min'], 4: [5, 'maj'], 5: [7, 'maj'], 6: [9, 'min'], 7: [11, 'm7b5'] },
    min: { 1: [0, 'min'], 2: [2, 'm7b5'], 3: [3, 'maj'], 4: [5, 'min'], 5: [7, 'maj'], 6: [8, 'maj'], 7: [10, 'maj'] }
  };
  const SIX = { maj: [1, 2, 3, 4, 5, 6], min: [1, 3, 4, 5, 6, 7] };
  const GAMMES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10, 11] };
  const ROMAINS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

  const accordDeDegre = (k, deg) => { const d = DEGRES[k.mode][deg]; if (!d) return null; const racine = mod(k.tonic + d[0]); return { deg, racine, q: d[1], basse: racine }; };
  const diatonique = k => SIX[k.mode].map(d => accordDeDegre(k, d));
  const notesAccord = (racine, q) => Q[q].map(i => mod(racine + i));
  const relatif = (a, b) => a.mode !== b.mode && mod(a.tonic + (a.mode === 'maj' ? 9 : 3)) === mod(b.tonic);

  /* Transpose. jeu = null : je joue dans la tonalité du chant. jeu = 0..11 : tonique choisie en majeur ; chant mineur : sa relative mineure.
     Le clavier sonne pk + sh : tout ce que le pianiste lit passe par ici. */
  function vue(k, jeu) {
    if (!k) return { pk: null, sh: 0 };
    if (jeu == null) return { pk: { tonic: k.tonic, mode: k.mode }, sh: 0 };
    const pk = { tonic: k.mode === 'maj' ? mod(jeu) : mod(jeu + 9), mode: k.mode };
    let sh = mod(k.tonic - pk.tonic); if (sh > 6) sh -= 12;
    return { pk, sh };
  }
  /* Une fondamentale hors gamme s'écrit par sa fonction : La♭ et Si♭ en Do majeur, pas Sol♯ et La♯. Un diminué de passage monte vers son accord : Fa♯°7 en Fa majeur, pas Sol♭°7. */
  const nomAccord = (racine, q, k, jeu = null, notation = 'fr') => {
    const v = vue(k, jeu), pc = mod(racine - v.sh); if (!v.pk) return nomNote(pc, v.pk, notation) + SUFFIXE[q];
    const rel = mod(pc - v.pk.tonic), maj = v.pk.mode === 'maj', dieses = q === 'dim7' || (maj && rel === 6), bemol = maj && [1, 3, 8, 10].includes(rel);
    return (dieses ? NOMS[notation].d[pc] : bemol ? NOMS[notation].b[pc] : nomNote(pc, v.pk, notation)) + SUFFIXE[q];
  };
  const texteTranspose = (k, jeu) => { const s = vue(k, jeu).sh; return 'Transpose ' + (s > 0 ? '+' : '') + s; };

  Object.assign(GP, { mod, Q, SUFFIXE, DEGRES, SIX, GAMMES, ROMAINS, bemols, nomNote, nomTonalite, accordDeDegre, diatonique, notesAccord, relatif, vue, nomAccord, texteTranspose });
})();
