/* Chant écrit : titre, paroles, accords et mélodie, en cases. Sans DOM.
   Le texte est la seule source : une ligne par phrase, l'accord entre crochets juste avant les mots qu'il couvre.
     [Sol]Amazing [Sol7]grace              chaque accord dure une mesure
     [Fa:2] deux mesures, [Sol:½] une demi-mesure
     ♪ mi mi ré | do ré:2                   mélodie de la ligne au-dessus, une case par |, durée en temps après :
   Une case : { accord: {racine, q, basse} | null, nom, temps, paroles, melodie: [[midi, debut, duree]] } (debut et duree en temps). */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  if (typeof require === 'function' && !GP.Q) require('./theorie.js');
  const { mod, Q, SUFFIXE, DEGRES, GAMMES } = GP;

  /* ---------- Noms de notes et d'accords, en français ou en anglais ---------- */
  const FR = [['do', 0], ['ré', 2], ['re', 2], ['mi', 4], ['fa', 5], ['sol', 7], ['la', 9], ['si', 11]];
  const EN = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ALT = { '#': 1, '♯': 1, b: -1, '♭': -1 };

  /* La note en tête de s : { pc, reste } ou null. langue 'fr', 'en', ou 'tout' : le français d'abord (Fa, pas F suivi de « a »). */
  function lireNote(s, langue = 'tout') {
    const bas = s.toLowerCase();
    let pc = null, n = 0;
    if (langue !== 'en') for (const [nom, v] of FR) if (bas.startsWith(nom)) { pc = v; n = nom.length; break; }
    if (pc == null && langue !== 'fr' && EN[s[0]] != null) { pc = EN[s[0]]; n = 1; }
    if (pc == null) return null;
    while (s[n] && ALT[s[n]] != null && !(s[n] === 'b' && /^b(5|9|13)/.test(s.slice(n)))) { pc += ALT[s[n]]; n++; }
    return { pc: mod(pc), reste: s.slice(n) };
  }

  // Suffixes lus : ceux qu'on affiche (SUFFIXE), plus les écritures courantes.
  const SUF = {};
  for (const q in SUFFIXE) SUF[SUFFIXE[q]] = q;
  Object.assign(SUF, {
    M: 'maj', maj: 'maj', min: 'min', mi: 'min', '-': 'min', m7: 'm7', min7: 'm7', '-7': 'm7', maj7: 'maj7', M7: 'maj7', '7M': 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', ma7: 'maj7',
    dim: 'dim7', '°': 'dim7', o: 'dim7', dim7: 'dim7', o7: 'dim7', m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', aug: 'aug', '#5': 'aug', '♯5': 'aug',
    sus: 'sus4', '69': '69', m7M: 'mmaj7', mM7: 'mmaj7', mmaj7: 'mmaj7', 'm(maj7)': 'mmaj7', '7sus': '7sus4', maj9: 'maj9', M9: 'maj9', '7#9': '7s9', '7b9': '7b9',
    '7#5#9': '7s5s9', maj13: 'maj13', M13: 'maj13', add11: 'sus4'
  });

  /* Un accord écrit : { racine, q, basse } ou null s'il ne se lit pas (jamais deviné). */
  function lireAccord(texte) {
    const s = String(texte || '').trim().replace(/\s+/g, '');
    if (!s) return null;
    const [tete, sous] = s.split('/');
    for (const langue of ['fr', 'en']) { // « Fadd9 » : Fa ne va pas avec « dd9 », F avec « add9 »
      const n = lireNote(tete, langue); if (!n) continue;
      const q = SUF[n.reste] ?? SUF[n.reste.toLowerCase()];
      if (q == null || !Q[q]) continue;
      if (sous == null) return { racine: n.pc, q, basse: n.pc };
      const b = lireNote(sous); if (!b || b.reste) return null;
      return { racine: n.pc, q, basse: b.pc };
    }
    return null;
  }

  /* Une note de mélodie : « la », « Si♭4 », « mi:2 » (2 temps). L'octave manque : la plus proche de la note d'avant. */
  function lireNoteMelodie(texte, prec) {
    const [nom, d] = texte.split(':'), m = /^(.*?)(-?\d)?$/.exec(nom), n = m && lireNote(m[1]);
    if (!n || n.reste) return null;
    let midi;
    if (m[2] != null) midi = 12 * (+m[2] + 1) + n.pc;
    else { midi = 60 + n.pc; if (prec != null) { while (midi - prec > 6) midi -= 12; while (prec - midi > 6) midi += 12; } }
    const duree = d == null ? null : lireDuree(d, 1);
    return { midi, duree };
  }

  /* « 2 », « ½ », « 1/2 », « 1,5 » en mesures (ou en temps pour la mélodie) ; null s'il ne se lit pas. */
  function lireDuree(t, unite) {
    const s = String(t).trim().replace(',', '.').replace('½', '.5').replace('¼', '.25').replace('¾', '.75');
    const f = /^(\d+)\/(\d+)$/.exec(s), v = f ? +f[1] / +f[2] : +s;
    return isFinite(v) && v > 0 ? v * unite : null;
  }

  /* ---------- Le texte vers les cases ---------- */
  function lireTexte(texte, { mesure = 4 } = {}) {
    const lignes = [], erreurs = [];
    String(texte || '').replace(/\r/g, '').split('\n').forEach((brut, i) => {
      const l = brut.trimEnd();
      if (/^\s*♪/.test(l)) { // la mélodie de la ligne d'avant, case par case
        const cases = lignes[lignes.length - 1]?.filter(c => c.accord || c.paroles);
        if (!cases) return;
        l.replace(/^\s*♪/, '').split('|').forEach((bloc, k) => {
          const c = cases[k]; if (!c) return;
          let prec = null, t = 0; const ns = [];
          for (const mot of bloc.trim().split(/\s+/).filter(Boolean)) {
            const n = lireNoteMelodie(mot, prec); if (!n) { erreurs.push({ ligne: i + 1, texte: mot }); continue; }
            ns.push([n.midi, t, n.duree]); prec = n.midi; if (n.duree) t += n.duree;
          }
          // Sans durées, les notes se partagent la case.
          const libres = ns.filter(n => n[2] == null).length, reste = Math.max(0, c.temps - t);
          let u = 0; for (const n of ns) { n[1] = u; if (n[2] == null) n[2] = libres ? +(reste / libres).toFixed(3) || 1 : 1; u += n[2]; }
          c.melodie = ns;
        });
        return;
      }
      const cases = [], re = /\[([^\]]*)\]/g; let m, fin = 0, cour = null;
      const ajoute = txt => { if (cour) cour.paroles += txt; else if (txt.trim()) cases.push(cour = { accord: null, nom: '', temps: 0, paroles: txt, melodie: [] }); };
      while ((m = re.exec(l))) {
        ajoute(l.slice(fin, m.index)); fin = re.lastIndex;
        const [nom, d] = m[1].split(':'), accord = lireAccord(nom), duree = d == null ? mesure : lireDuree(d, mesure);
        if (!accord) erreurs.push({ ligne: i + 1, texte: nom });
        if (d != null && duree == null) erreurs.push({ ligne: i + 1, texte: m[1] });
        cases.push(cour = { accord, nom: nom.trim(), temps: duree || mesure, paroles: '', melodie: [] });
      }
      ajoute(l.slice(fin));
      lignes.push(cases);
    });
    while (lignes.length && !lignes[lignes.length - 1].length) lignes.pop();
    return { lignes, erreurs };
  }

  /* Les cases vers le texte : ce qu'on modifie case par case revient dans le texte, seule source. */
  function texteDe(lignes, { mesure = 4, notation = 'fr' } = {}) {
    return lignes.map(cases => {
      let t = cases.map(c => {
        if (!c.accord && !c.nom) return c.paroles;
        const nom = c.accord ? nomEcrit(c.accord, notation) : c.nom, mes = c.temps / mesure;
        return `[${nom}${mes === 1 ? '' : ':' + (mes === .5 ? '½' : +mes.toFixed(3))}]${c.paroles}`;
      }).join('');
      const avecMel = cases.filter(c => c.accord || c.paroles);
      if (avecMel.some(c => c.melodie.length)) {
        t += '\n♪ ' + avecMel.map(c => { let prec = null; return c.melodie.map(([midi, , d]) => { const s = nomNoteMel(midi, prec, notation) + ':' + +d.toFixed(3); prec = midi; return s; }).join(' '); }).join(' | ').replace(/[\s|]+$/, ''); // les cases muettes de la fin ne s'écrivent pas
      }
      return t;
    }).join('\n');
  }
  const NOMS_FR = ['do', 'do♯', 'ré', 'mi♭', 'mi', 'fa', 'fa♯', 'sol', 'la♭', 'la', 'si♭', 'si'], NOMS_EN = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  // L'octave ne s'écrit que si la plus proche de la note d'avant ne suffit pas à la retrouver.
  const nomNoteMel = (midi, prec, notation) => {
    const nom = (notation === 'en' ? NOMS_EN : NOMS_FR)[mod(midi)], sans = lireNoteMelodie(nom.replace('♯', '#').replace('♭', 'b'), prec);
    return sans && sans.midi === midi ? nom : nom + (Math.floor(midi / 12) - 1);
  };
  // Hors contexte, les altérations les plus courantes sur une grille : Do♯ Mi♭ Fa♯ La♭ Si♭.
  const ECRIT = { fr: ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'], en: ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] };
  const nomEcrit = (a, notation) => ECRIT[notation][a.racine] + SUFFIXE[a.q] + (a.basse !== a.racine ? '/' + ECRIT[notation][a.basse] : '');

  /* ---------- Tonalité écrite : celle où les accords sont chez eux ---------- */
  const famille = q => (['min', 'm6', 'm7', 'mmaj7', 'm9', 'm11'].includes(q) ? 'min' : ['m7b5', 'dim7'].includes(q) ? 'dim' : 'maj');
  function tonaliteDe(lignes) {
    const cs = lignes.flat().filter(c => c.accord && c.temps > 0);
    if (!cs.length) return null;
    let best = null;
    for (let i = 0; i < 24; i++) {
      const k = { tonic: i >> 1, mode: i & 1 ? 'min' : 'maj' }, D = DEGRES[k.mode];
      let s = 0;
      for (const c of cs) {
        const rel = mod(c.accord.racine - k.tonic), deg = Object.values(D).find(([r]) => r === rel), f = famille(c.accord.q);
        // En mineur, le 5 mineur (naturel) est aussi chez lui.
        const ok = deg && (famille(deg[1]) === f || (k.mode === 'min' && rel === 7 && f === 'min'));
        s += Math.min(c.temps, 8) * (ok ? 1 : deg ? .3 : GAMMES[k.mode].includes(rel) ? .1 : -.5);
      }
      const tonique = c => c && mod(c.accord.racine - k.tonic) === 0 && famille(c.accord.q) === (k.mode === 'maj' ? 'maj' : 'min');
      s += (tonique(cs[0]) ? 4 : 0) + (tonique(cs[cs.length - 1]) ? 6 : 0);
      if (!best || s > best.s) best = { k, s };
    }
    return best.k;
  }

  /* De combien la grille écrite monte pour la tonalité chantée. Le relatif chanté a la même armure : il ne déplace rien. Entre -5 et +6. */
  function decalage(ecrit, chante) {
    if (!ecrit || !chante) return 0;
    const t = chante.mode === ecrit.mode ? chante.tonic : chante.mode === 'min' ? chante.tonic + 3 : chante.tonic + 9;
    const d = mod(t - ecrit.tonic); return d > 6 ? d - 12 : d;
  }
  const transposer = (k, d) => (k ? { tonic: mod(k.tonic + d), mode: k.mode } : null);

  /* Le Transpose en clair. jeu : tonique majeure où le pianiste est à l'aise (null : il joue comme le chant). */
  function texteJeu(k, jeu, notation = 'fr') {
    if (!k) return '';
    const v = GP.vue(k, jeu), nk = x => GP.nomTonalite(x, notation);
    if (jeu == null || v.sh === 0) return `Tu joues en ${nk(v.pk)}, sans Transpose.`;
    const touches = k.mode === 'min' ? ` (touches de ${nk({ tonic: mod(jeu), mode: 'maj' })})` : '';
    return `Tu joues en ${nk(v.pk)}${touches}. Transpose ${v.sh > 0 ? '+' : '−'}${Math.abs(v.sh)}.`;
  }

  /* Les cases jouables, à plat, avec leur place : pour avancer case par case. Une case sans accord ni durée suit la précédente. */
  function aPlat(lignes) {
    const out = []; let t = 0;
    lignes.forEach((cases, l) => cases.forEach((c, i) => { if (c.accord && c.temps > 0) { out.push({ l, i, c, t0: t }); t += c.temps; } }));
    return out;
  }

  /* Une mélodie chantée sur l'horloge : notes [midi entendu, temps, durée en temps] rangées dans les cases à plat de depart à jusque.
     Elles passent dans la tonalité écrite (decal : de l'écrit au chanté), arrondies au quart de temps ; une case sans note entendue devient muette. */
  function placerMelodie(notes, plat, { depart, jusque, decal = 0 }) {
    const q = x => Math.round(x * 4) / 4, par = new Map(), fin = plat[jusque].t0 + plat[jusque].c.temps;
    for (let j = depart; j <= jusque; j++) par.set(j, []);
    for (const [midi, b, d] of notes) {
      if (b < plat[depart].t0 - .25 || b >= fin) continue; // une note à peine en avance compte pour sa case
      let j = depart; while (j < jusque && plat[j + 1].t0 <= b + .125) j++;
      const x = plat[j], d0 = Math.max(0, q(b - x.t0));
      if (d0 >= x.c.temps) continue;
      par.get(j).push([midi - decal, d0, Math.max(.25, Math.min(q(d), x.c.temps - d0))]);
    }
    for (const [j, ns] of par) plat[j].c.melodie = ns;
  }

  /* Un chant enregistré par l'ancien Live (Labs, Mes chants) : accords et mélodie, sans paroles, quatre mesures par ligne. */
  function depuisAncien(ch) {
    const mesure = ch.mesure || 4, lignes = []; let ligne = [], temps = 0, t = 0;
    const mel = []; let u = 0; for (const [midi, d] of ch.melodie || []) { if (midi != null) mel.push([midi, u, d]); u += d; }
    for (const c of ch.cases || []) {
      const notes = mel.filter(([, d0]) => d0 >= t && d0 < t + c.t).map(([midi, d0, d]) => [midi, +(d0 - t).toFixed(3), d]);
      ligne.push({ accord: { racine: c.racine, q: c.q, basse: c.basse ?? c.racine }, nom: '', temps: c.t, paroles: c.mots || '', melodie: notes });
      temps += c.t; t += c.t;
      if (temps >= 4 * mesure) { lignes.push(ligne); ligne = []; temps = 0; }
    }
    if (ligne.length) lignes.push(ligne);
    return { titre: ch.titre, bpm: ch.bpm || 72, mesure, texte: texteDe(lignes, { mesure }) };
  }

  Object.assign(GP, { Chant: { lireAccord, lireNoteMelodie, lireTexte, texteDe, tonaliteDe, decalage, transposer, texteJeu, aPlat, placerMelodie, depuisAncien, famille } });
})();
