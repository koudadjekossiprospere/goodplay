/* Labs « Enrichir mon jeu » : leçons, catalogue, fiche d'une technique, apprendre un chant.
   GP.Labs.monter(el) est le point d'entrée. La partie musicale (construire, versionChant, propositions) tourne aussi sous node, voir tests/test-labs.js. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  if (typeof require === 'function' && !GP.jouerEntree) { require('./theorie.js'); require('./doigtes.js'); require('./catalogue.js'); require('./enrichir.js'); require('./chants.js'); }
  const mod = n => ((n % 12) + 12) % 12;
  const parId = id => GP.catalogue.find(e => e.id === id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const sansAccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const STYLES = [['gospel', 'Gospel'], ['louange', 'Louange'], ['soul', 'Soul'], ['jazz', 'Jazz'], ['pop', 'Pop']];
  const FAMILLES = { couleur: 'Couleurs', passage: 'Passages', substitution: 'Substitutions', relative: 'Relatives', slash: 'Basses décalées', turnaround: 'Retours au 1', marche: 'Marches', ending: 'Fins', fill: 'Traits', voicing: 'Voicings', rythme: 'Rythmes' };
  const QUARTES = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7]; // on travaille les tonalités de quarte en quarte, comme au piano
  const g = d => ({ d, g: 1 }); // un degré qui fait partie du geste

  const PALIERS = ['Les mains', 'La couleur sans risque', 'Septièmes et 2-5-1', 'La basse qui chante', 'Les passages', 'Le gospel moderne'];
  /* Les leçons de docs/recherche/parcours-labs.md. avant et apres durent le même nombre de temps : la bascule reste à sa place. */
  const LECONS = [
    { p: 0, titre: 'Bons doigts', geste: 'La main reste en place, seuls les doigts changent', objectif: 'Enchaîner 1, 4, 5 sans sauter, en renversements proches.', exercice: "1, 4, 5, 1 en Do, puis en Sol. L'auriculaire prend la note du haut, le pouce celle du bas, la note commune ne bouge pas.", pourquoi: 'Un renversement proche garde les notes communes sous les doigts : moins de sauts, moins de fausses notes.', a_ecouter: "Le squelette saute d'une position à l'autre, l'enrichi reste lié.", tons: [0, 7], avant: [{ d: 1, f: 1 }, { d: 4, f: 1 }, { d: 5, f: 1 }, { d: 1, f: 1 }], apres: [g(1), g(4), g(5), g(1)] },
    { p: 0, titre: 'Basse pleine', id: 'rythme-octaves-noires', geste: 'Octave à gauche, accord à droite', objectif: 'Donner du poids à la gauche sans charger la droite.', exercice: '1, 4, 1, 5 en Do, puis en Fa. Octave sur le 1 de la mesure, accord sur chaque temps.', tons: [0, 5], avant: [1, 4, 1, 5], apres: [{ d: 1, g: 1, niv: 1 }, { d: 4, g: 1, niv: 1 }, { d: 1, g: 1, niv: 1 }, { d: 5, g: 1, niv: 1 }], liens: ['rythme-basse-1-5'] },
    { p: 1, titre: 'Le 2 ajouté', id: 'couleur-add2-sur-1', geste: 'Un doigt de plus entre le pouce et la tierce', objectif: 'Adoucir le 1 et le 4 sans changer leur rôle.', exercice: '1, 4 en boucle, en Do, puis en Ré : add2 puis add9.', tons: [0, 2], avant: [1, 4, 1, 4], apres: ['couleur-add2-sur-1', 'couleur-add2-sur-4', 'couleur-add9-sur-1', 'couleur-add9-sur-4'], liens: ['couleur-add9-sur-1', 'couleur-add2-sur-4', 'couleur-add9-sur-4'] },
    { p: 1, titre: 'Le retard', id: 'couleur-sus4-sur-5', geste: 'Une seule note descend', objectif: 'Faire attendre le 5, puis le résoudre.', exercice: '1, 5sus4, 5, 1 en Sol, puis en Fa.', tons: [7, 5], avant: [1, { d: 5, n: 2 }, 1], apres: [1, 'couleur-sus4-sur-5', 1], liens: ['couleur-7sus4-sur-5', 'couleur-sus4-sur-1'] },
    { p: 1, titre: 'Le 4 sur 5', id: 'slash-4-sur-5', geste: 'Droite sur le 4, gauche sur le 5', objectif: 'Faire planer le 5 en fin de phrase.', exercice: '1, 4, 4 sur 5, 1 en Do, puis en Mi bémol. Les noires choisissent le renversement.', tons: [0, 3], avant: [1, 4, 5, 1], apres: [1, 4, 'slash-4-sur-5', 1], liens: ['voicing-4-sur-5-coquille', 'slash-2m-sur-5'] },
    { p: 1, titre: 'Main droite fixe', id: 'voicing-main-droite-fixe', geste: 'La droite bouge à peine, la gauche fait le chemin', objectif: 'Colorer quatre accords avec presque une seule forme.', exercice: '1, 6, 4, 5 en Do, puis en Sol.', tons: [0, 7], avant: [1, 6, 4, 5], apres: ['voicing-main-droite-fixe'] },
    { p: 2, titre: 'Septièmes', id: 'couleur-maj7-sur-1', geste: 'Une note de plus dans chaque accord', objectif: 'Reconnaître 7M, m7 et 7 sous les doigts.', exercice: 'Monte les degrés de 1 à 6 en Do, puis en Fa, avec la septième de chacun.', pourquoi: "La septième ajoute une couleur sans changer le rôle de l'accord.", a_ecouter: 'Le même chemin, en plus rond.', tons: [0, 5], avant: [1, 2, 3, 4, 5, 6], apres: ['couleur-maj7-sur-1', 'couleur-m7-sur-2', 'couleur-m7-sur-3', 'couleur-maj7-sur-4', 'couleur-7-sur-5', 'couleur-m7-sur-6'], liens: ['couleur-m7-sur-2', 'couleur-7-sur-5', 'couleur-m7-sur-6'] },
    { p: 2, titre: 'Le 2-5-1', id: 'passage-2-5-vers-1', geste: "Deux notes descendent d'un cran, la droite bouge à peine", objectif: 'Préparer le retour au 1 par le 2 et le 5.', exercice: '1, 4, 2, 5, 1 en Do, puis en Si bémol.', tons: [0, 10], avant: [1, { d: 4, n: 3 }, 1], apres: [1, 4, 'passage-2-5-vers-1', 1], liens: ['passage-5-7-vers-1', 'couleur-m7-sur-2', 'couleur-7-sur-5'] },
    { p: 3, titre: 'Basses conjointes', id: 'marche-descente-1-7-6-5-4', geste: 'La gauche chante, la droite suit', objectif: 'Faire descendre la basse note après note.', exercice: 'Descente 1, 7, 6, 5, 4 en Do, puis en Ré. Chante la basse avant de la jouer.', tons: [0, 2], avant: [1, 5, { d: 6, n: 2 }, 4], apres: [1, 'marche-descente-1-7-6-5-4', 4], liens: ['slash-5-sur-7', 'slash-1-sur-3'] },
    { p: 3, titre: 'Marche', id: 'marche-4-5-6-7-1', geste: "La basse monte note après note jusqu'au 1", objectif: 'Ramener le chant au 1 par une montée.', exercice: '4, 5, 6, 7, 1 en Sol, puis en Fa.', tons: [7, 5], avant: [{ d: 4, n: 4 }, 1], apres: [4, 'marche-4-5-6-7-1', 1], liens: ['marche-1-2-3-4', 'slash-4-sur-6-marche'] },
    { p: 3, titre: 'Relatives', id: 'rel-6m-pour-1', geste: 'La droite reste presque, la basse change', objectif: 'Remplacer le 1 par le 6 mineur, le 4 par le 2 mineur.', exercice: '1, 4, 1, 5 en Do, puis en Sol. Chante en jouant.', tons: [0, 7], avant: [1, 4, 1, 5], apres: ['rel-6m-pour-1', 'rel-2m-pour-4', 1, 5], liens: ['rel-2m-pour-4', 'rel-3m-pour-1'] },
    { p: 4, titre: 'Dominantes secondaires', id: 'passage-6dom-vers-2', geste: "Une note monte, tout s'éclaire", objectif: 'Rendre le 6 majeur pour tirer vers le 2.', exercice: '1, 6 rendu majeur, 2, 5 en Do, puis en La bémol. Le 3 rendu majeur vers le 6 suit la même idée.', tons: [0, 8], avant: [1, 6, 2, 5], apres: [1, 'passage-6dom-vers-2', 2, 5], liens: ['passage-3dom-vers-6', 'passage-2dom-vers-5'] },
    { p: 4, titre: 'Diminués', id: 'passage-dim-sharp1', geste: "La basse monte d'un demi-ton", objectif: 'Glisser du 1 au 2 par un diminué.', exercice: '1, dièse 1, 2, 5 en Do, puis en Fa.', tons: [0, 5], avant: [{ d: 1, n: 2 }, 2, 5], apres: [1, 'passage-dim-sharp1', 2, 5], liens: ['passage-dim-sharp4', 'passage-dim-sharp5'] },
    { p: 4, titre: 'Amen', id: 'end-amen', geste: "Une note descend d'un demi-ton", objectif: 'Finir un chant par la cadence Amen.', exercice: 'Finis un chant connu par 4, 4 mineur, 1, en Do, puis en Mi bémol.', tons: [0, 3], avant: [1, { d: 4, n: 2 }, 1], apres: [1, 'end-amen'], liens: ['sub-4m-avant-1', 'end-b6-b7-1'] },
    { p: 4, titre: 'Mineur', id: 'min-passage-2-5-vers-1', mode: 'min', geste: 'Le 2-5 du mineur, puis la descente andalouse', objectif: 'Retrouver le 2-5-1 quand le chant est mineur.', exercice: '1, 4, 2, 5, 1 en La mineur, puis en Ré mineur. Enchaîne avec la descente andalouse.', tons: [9, 2], avant: [1, { d: 4, n: 2 }, 5, 1], apres: [1, 4, 'min-passage-2-5-vers-1', 1], liens: ['min-ta-andalouse'] },
    { p: 5, titre: 'Chaîne', id: 'ta-1-7-3-6-2-5', geste: "De quinte en quinte jusqu'au 1", objectif: 'Apprendre le grand tour par morceaux.', exercice: '2-5-1, puis 6-2-5-1, puis 3-6-2-5-1, enfin toute la chaîne, en Do, puis en Sol.', tons: [0, 7], avant: [{ d: 1, n: 6 }, 1], apres: [1, 'ta-1-7-3-6-2-5', 1], liens: ['ta-1-6-2-5', 'ta-3-6-2-5'] },
    { p: 5, titre: 'Tensions', id: 'voicing-251-gospel', geste: 'Une tension sur le 5, puis le 2-5-1 complet', objectif: 'Mettre le 7 bémol 9 à sa place.', exercice: '7♭9 sur le 5, puis le 2-5-1 gospel, en Do, puis en Mi bémol.', tons: [0, 3], avant: [2, 5, 1], apres: ['voicing-251-gospel'], liens: ['couleur-7b9-sur-5'] },
    { p: 5, titre: 'Tritonique', id: 'sub-tritone-5-vers-1', geste: 'Le 5 remplacé, la basse descend par demi-ton', objectif: 'Remplacer le 5 par son accord à un triton.', exercice: '2, 5 remplacé, 1 en Do, puis en Fa.', tons: [0, 5], avant: [2, 5, 1], apres: [2, 'sub-tritone-5-vers-1', 1], liens: ['sub-tritone-6-vers-2'] },
    { p: 5, titre: 'Shout', id: 'marche-shout', geste: 'Une marche rapide et pleine', objectif: 'Tenir la marche du shout à toute vitesse.', exercice: 'Lentement, puis vite, en Si bémol.', tons: [10], avant: [{ d: 1, n: 6 }, 1], apres: [1, 'marche-shout'], liens: ['marche-basse-1-3-5-6-b7'] }
  ];

  /* ---------- Musique, sans DOM ---------- */
  const reglages = () => (GP.App && (GP.App.reglages || GP.App.S)) || {};
  const notation = () => reglages().notation || 'fr';

  const ORDRE = { fr: ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'], en: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] };
  const lettre = n => n.replace(/[♯♭]/g, '');
  const DIESES = { tonic: 0, mode: 'maj' }, BEMOLS = { tonic: 5, mode: 'maj' };
  const nomRacine = (a, k) => { const n = GP.nomAccord(a.racine, a.q, k, null, notation()), s = GP.SUFFIXE[a.q]; return s ? n.slice(0, -s.length) : n; };
  /* Une note s'écrit depuis la fondamentale de son accord : Do Mi♭ La♭ pour La♭ majeur, Fa♯ pour la basse de Ré7 sur Fa♯ (revue du pianiste). */
  function epeler(m, a, k) {
    const n = notation(), i = mod(m - a.racine), dim = a.q === 'dim7' || a.q === 'm7b5', s9 = a.q === '7s9' || a.q === '7s5s9';
    const pas = [0, 1, 1, s9 ? 1 : 2, 2, 3, dim ? 4 : 3, 4, a.q === 'aug' || a.q === '7s5s9' ? 4 : 5, a.q === 'dim7' ? 6 : 5, 6, 6][i];
    const cible = ORDRE[n][(ORDRE[n].indexOf(lettre(nomRacine(a, k))) + pas) % 7];
    for (const t of [k, DIESES, BEMOLS]) { const c = GP.nomNote(m, t, n); if (lettre(c) === cible) return c; }
    return GP.nomNote(m, k, n); // Do♭ ou Mi♯ n'existent pas dans nomNote : on garde le nom de la touche
  }
  const nomA = (a, k) => GP.nomAccord(a.racine, a.q, k, null, notation()) + (mod(a.basse) !== mod(a.racine) ? '/' + epeler(a.basse, a, k) : '');
  const CHIFFRES = { maj: ['1', '♯1', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'], min: ['1', '♭2', '2', '3', '♯3', '4', '♯4', '5', '6', '♯6', '7', '♯7'] };
  function chiffreBasse(a, k) { const r = mod(a.basse - k.tonic); if (k.mode === 'maj' && a.q === 'dim7' && r === 3) return '♯2'; if (k.mode === 'maj' && a.q === 'dim7' && r === 8) return '♯5'; return CHIFFRES[k.mode][r]; }
  /* Le clavier nomme ses touches par une tonalité : on lui en passe une qui écrit l'accord comme le texte, en dièses ou en bémols. */
  function tonEtiquettes(a, k) { const t = [...a.mg, ...a.md].map(m => epeler(m, a, k)).join(''); return t.includes('♭') ? BEMOLS : t.includes('♯') ? DIESES : k; }

  function fondamentale(a, prec) {
    const md = GP.Q[a.q].slice(0, 3).map(i => 60 + a.racine + i), v = GP.voicing(a.racine, a.q, { prec });
    return { mg: v.mg, dg: v.dg, md, dd: GP.doigter(md, 'd'), alertes: GP.toucheNoire(md[0]) ? ['pouce-noire'] : [] };
  }
  /* tokens : un degré, {d,n,g,niv,f} ou l'id d'une entrée. Les entrées restent telles que GP.jouerEntree les rend ; les degrés se placent autour d'elles. */
  function construire(tokens, k, amorce = null) {
    const l = [];
    for (const t of tokens) {
      if (typeof t === 'string') { GP.jouerEntree(parId(t), k).forEach(a => l.push({ ...a, k, n: 1, geste: true, entree: t })); continue; }
      const o = typeof t === 'number' ? { d: t } : t, [r, q] = GP.DEGRES[k.mode][o.d], racine = mod(k.tonic + r);
      l.push({ racine, q, basse: racine, k, n: o.n || 1, geste: !!o.g, o });
    }
    let prec = amorce || l.find(a => !a.o) || null;
    for (const a of l) { if (a.o) Object.assign(a, a.o.f ? fondamentale(a, prec) : GP.voicing(a.racine, a.q, { prec, niveau: a.o.niv || 0 })); prec = a; }
    return l;
  }

  /* Le cadre d'écoute d'une entrée : le squelette et le geste à sa place, sur la même durée. */
  const SUITE = { maj: { 1: 4, 2: 5, 3: 6, 4: 5, 5: 1, 6: 4, 7: 1 }, min: { 1: 4, 2: 5, 3: 6, 4: 5, 5: 1, 6: 7, 7: 3 } };
  const CADRES = {
    'voicing-main-droite-fixe': { avant: [1, 6, 4, 5], apres: ['voicing-main-droite-fixe'] },
    'voicing-251-gospel': { avant: [2, 5, 1], apres: ['voicing-251-gospel'] },
    'end-251-69': { avant: [2, 5, 1], apres: ['end-251-69'] },
    'sub-tritone-5-vers-1': { avant: [2, 5, 1], apres: [2, 'sub-tritone-5-vers-1', 1] },
    'min-slash-5-sur-7': { avant: [{ d: 1, n: 2 }, 1], apres: [1, 'min-slash-5-sur-7', 1] }
  };
  const debutSurDegre = (e, a, d) => a.basse === a.rac && a.rac === GP.DEGRES[e.mode][d][0];
  function cadre(e) {
    if (CADRES[e.id]) return CADRES[e.id];
    const q = e.quand, A = e.accords, m = A.length;
    if (q.sur != null) { const pre = q.sur === 1 ? [] : [1], post = [SUITE[e.mode][q.sur]]; return { avant: [...pre, { d: q.sur, n: m }, ...post], apres: [...pre, e.id, ...post] }; }
    const sansDe = debutSurDegre(e, A[0], q.de), sansVers = m > 1 && debutSurDegre(e, A[m - 1], q.vers) || (m === 1 && !sansDe && debutSurDegre(e, A[0], q.vers));
    const apres = [...(sansDe ? [] : [q.de]), e.id, ...(sansVers ? [] : [q.vers])], total = m + (sansDe ? 0 : 1) + (sansVers ? 0 : 1);
    return { avant: [{ d: q.de, n: total - 1 }, q.vers], apres };
  }

  /* ---------- Un chant : cases {deg,racine,q,basse,t,ton}, t en temps ---------- */
  function chantDuCorpus(c, i) {
    const k = { tonic: c.tonique, mode: c.mode };
    return { id: 'c' + i, titre: c.titre, ton: k, bpm: c.bpm, mesure: c.mesure, fiabilite: c.fiabilite, melodie: c.notes, cases: c.basse.map(([deg, t]) => { const [r, q] = GP.DEGRES[c.mode][deg], racine = mod(c.tonique + r); return { deg, racine, q, basse: racine, t, ton: k }; }) };
  }
  /* Le dernier chant de la grille Live. Pas de mélodie : la grille ne la garde pas. */
  function chantDeSession(s) {
    if (!s || !s.grille || !s.grille.length) return null;
    const dernier = s.grille[s.grille.length - 1].chant, cs = s.grille.filter(c => c.chant === dernier && c.racine != null && c.deg != null);
    const ton = s.tonalite || (cs[0] && cs[0].ton); if (!cs.length || !ton) return null;
    const bpm = Math.round(s.bpm || 60);
    return { id: 'live', titre: 'Grille du Live', ton, bpm, mesure: 4, melodie: null, cases: cs.map(c => ({ deg: c.deg, racine: c.racine, q: c.q, basse: c.basse ?? c.racine, t: Math.max(1, Math.round((c.dur || 2) * bpm / 60)), ton: c.ton || ton, mots: c.mots || '' })) };
  }
  /* La suite à jouer. gardes : {case: id d'entrée}, la version enrichie. Un lien garde sa case puis passe en fin de case ; une couleur la remplace. */
  function versionChant(ch, jeu, niv, gardes) {
    const out = []; let prec = null;
    ch.cases.forEach((c, i) => {
      const v = GP.vue(c.ton, jeu), k = v.pk, e = gardes && gardes[i] ? parId(gardes[i]) : null;
      const base = () => { const r = mod(c.racine - v.sh), b = mod(c.basse - v.sh); return { ...GP.voicing(r, c.q, { prec, niveau: niv, basse: b }), racine: r, q: c.q, basse: b, k, i, deg: c.deg }; };
      if (!e) { const a = base(); a.n = c.t; out.push(a); prec = a; return; }
      let acc = GP.jouerEntree(e, k).map(a => ({ ...a, k, i, deg: c.deg, geste: true, entree: e.id })), tete = 0;
      if (e.quand.sur == null) {
        const A = e.accords;
        if (acc.length > 1 && debutSurDegre(e, A[A.length - 1], e.quand.vers)) acc = acc.slice(0, -1); // l'accord d'arrivée est déjà la case suivante
        if (!debutSurDegre(e, A[0], e.quand.de)) { tete = c.t > acc.length ? c.t - acc.length : c.t / (acc.length + 1); const a = base(); a.n = tete; out.push(a); prec = a; }
      }
      acc.forEach(a => { a.n = (c.t - tete) / acc.length; out.push(a); prec = a; });
    });
    return out;
  }
  /* GP.suggestions ne parle qu'une fois toutes les 5 cases : on lui redonne 4 cases de silence pour tout ce qu'il proposerait sur celle-ci. */
  function propositions(ch, i, style) {
    const c = ch.cases[i], suivant = ch.cases[i + 1] ? ch.cases[i + 1].deg : null, vus = [null, null, null, null], out = [];
    for (const niveau of [1, 2]) for (let t = 0; t < 6 && out.length < 4; t++) {
      const r = GP.suggestions({ deg: c.deg, suivant, mode: c.ton.mode, style, niveau, dejaVus: vus });
      const neufs = r.filter(e => !out.includes(e)); if (!neufs.length) break;
      out.push(...neufs); vus.push(null, null, null, null);
    }
    return out.slice(0, 4);
  }

  /* ---------- Mémoire : tout passe par try/catch, Labs marche sans stockage ---------- */
  const CLE = 'goodplay.labs';
  const DEFAUT = () => ({ style: 'gospel', ton: null, lecons: [], acquis: {}, tons: {}, chants: [], versions: {}, mains: true });
  let P = DEFAUT(), stockageOk = true;
  function charger() {
    let lu = null;
    try { lu = JSON.parse(localStorage.getItem(CLE)); } catch (e) { lu = null; }
    if (!lu || typeof lu !== 'object') return;
    const d = DEFAUT();
    for (const k in d) if (lu[k] !== undefined && (typeof lu[k] === typeof d[k] || d[k] === null) && Array.isArray(lu[k]) === Array.isArray(d[k])) P[k] = lu[k];
    if (!STYLES.some(s => s[0] === P.style)) P.style = 'gospel';
    if (!Number.isInteger(P.ton) || P.ton < 0 || P.ton > 11) P.ton = null;
  }
  function sauver() { try { localStorage.setItem(CLE, JSON.stringify(P)); stockageOk = true; } catch (e) { stockageOk = false; annoncer('Ta progression ne peut pas être gardée sur cet appareil.', true); } }
  /* Export de Mes chants pour le jeu d'entraînement (tests/donnees/source-goodplay.js) : mélodie entendue, grille, cases corrigées. Ni son ni paroles : les mots reconnus en direct sont retirés. */
  const paquetExport = (chants, quand = new Date()) => ({ format: 'goodplay-mes-chants', version: 1, exporte: quand.toISOString(), chants: chants.map(c => ({ ...c, cases: (c.cases || []).map(({ mots, ...x }) => x) })) });

  /* ---------- Interface ---------- */
  let racine = null, gauche = null, travail = null, onglets = null, hote = null, toast = null, clavier = null, mq = null, minuteurToast = 0;
  const R = { ecran: 'accueil', sel: null, pile: 'g', d: 0 }; // route
  const U = { niv: null, q: '' }; // filtres du catalogue
  const O = [], PL = {}; // objets ouverts en onglets ; noeuds de l'arbre pliés ou ouverts à la main
  let F = null, C = null, annuler = null; // fiche et chant ouverts ; chant supprimé à rétablir
  const L = { h: null, h2: null, fin: 0, batt: 0, actif: false }; // lecture en cours
  const pc = () => mq.matches;
  const leTon = () => P.ton ?? 0;
  const styleNom = () => STYLES.find(s => s[0] === P.style)[1];
  const prochaine = () => LECONS.findIndex((_, i) => !P.lecons.includes(i + 1));

  function annoncer(texte, erreur = false, action = null) {
    if (!toast) return;
    toast.setAttribute('role', erreur ? 'alert' : 'status'); toast.classList.toggle('erreur', erreur);
    toast.innerHTML = `<span>${esc(texte)}</span>` + (action ? `<button class="lien" data-act="${action.act}">${esc(action.nom)}</button>` : '');
    toast.hidden = false; clearTimeout(minuteurToast); minuteurToast = setTimeout(() => { toast.hidden = true; }, action ? 8000 : 4000);
  }

  /* --- Lecture --- */
  function arreter() {
    clearTimeout(L.fin); clearInterval(L.batt);
    for (const h of [L.h, L.h2]) if (h) h.arreter();
    L.h = L.h2 = null; L.actif = false; peindreBoutonJeu();
  }
  function peindreBoutonJeu() { if (!racine) return; if (GP.App && GP.App.etatFab && document.body.dataset.onglet === 'labs') GP.App.etatFab(L.actif); for (const b of racine.querySelectorAll('[data-jeu]')) { const on = L.actif && L.quoi === b.dataset.jeu; b.setAttribute('aria-pressed', on); b.querySelector('use').setAttribute('href', on ? '#i-stop' : '#' + b.dataset.ic); b.querySelector('span').textContent = on ? 'Arrêter' : b.dataset.nom; } }
  function lecture(quoi, liste, base, { surAccord, surFin, melodie = null, volume } = {}) {
    arreter();
    try {
      const ctx = GP.Audio.contexte();
      L.h = GP.Audio.jouerSuite(liste.map(a => ({ mg: a.mg, md: a.md, midis: a.midis, dur: (a.n || 1) * base })), { dur: base, surAccord, volume });
      if (melodie) L.h2 = GP.Audio.jouerSuite(melodie, { dur: base, volume: .5 });
      L.actif = true; L.quoi = quoi; peindreBoutonJeu();
      L.fin = setTimeout(() => { L.actif = false; L.h = L.h2 = null; peindreBoutonJeu(); if (surFin) surFin(); }, (L.h.fin - ctx.currentTime) * 1000);
    } catch (e) { L.actif = false; peindreBoutonJeu(); annoncer("Le son ne démarre pas. Touche encore une fois, et vérifie le mode silencieux du téléphone.", true); }
  }
  function sonAccord(a) { try { GP.Audio.jouerAccord([...a.mg, ...a.md], { dur: 1.4 }); } catch (e) { annoncer('Le son ne démarre pas. Touche encore une fois.', true); } }

  /* --- Clavier : les touches du geste et le fantôme de l'accord d'avant --- */
  let decore = null;
  function decorer() {
    if (!hote) return;
    for (const r of hote.querySelectorAll('.lb-fantome,.lb-bouge')) r.classList.remove('lb-fantome', 'lb-bouge');
    if (!decore || !decore.prec) return;
    const av = [...decore.prec.mg, ...decore.prec.md], ap = [...decore.a.mg, ...decore.a.md], t = m => hote.querySelector(`[data-m="${m}"]`);
    for (const m of av) if (!ap.includes(m)) { const r = t(m); if (r) r.classList.add('lb-fantome'); }
    for (const m of ap) if (!av.includes(m)) { const r = t(m); if (r) r.classList.add('lb-bouge'); }
  }
  function montrer(a, prec = null) {
    if (!clavier) return;
    const etat = racine.querySelector('.lb-kb .kb-etat');
    if (!a) { decore = null; clavier.afficher(null); decorer(); etat.innerHTML = '<span>Aucun accord à montrer</span>'; return; }
    clavier.afficher({ mg: a.mg, md: a.md, dg: a.dg, dd: a.dd }, { tonalite: tonEtiquettes(a, a.k), notation: notation() });
    decore = { a, prec }; decorer();
    etat.innerHTML = `<b>${esc(nomA(a, a.k))}</b><span>Basse <span class="kb-basse">${esc(epeler(a.basse, a, a.k))}</span></span><span>Doigté MG ${a.dg.join('-')}${a.dd.length ? ' / MD ' + a.dd.join('-') : ''}</span>`;
  }

  /* --- Morceaux communs --- */
  const menuBtn = (act, lib, val) => `<button class="lb-menu" data-act="${act}" aria-haspopup="listbox" aria-expanded="false"><small>${esc(lib)}</small><b>${esc(val)}</b>${ic('chevron')}</button>`;
  /* La barre de commande de Labs : les mêmes segments que le Live, l'action à droite. */
  const barreCmd = (champ, sec, action) => `<div class="lb-cmd"><div class="cmd-champ">${champ}</div><div class="cmd-sec">${sec}</div>${action}</div>`;
  const boutonJeu = (quoi, nom, icone, classe = '') => `<button class="btn ${classe}" data-act="jeu-${quoi}" data-jeu="${quoi}" data-nom="${esc(nom)}" data-ic="i-${icone}" aria-pressed="false">${ic(icone)}<span>${esc(nom)}</span></button>`;
  const retour = nom => `<button class="lien lb-retour" data-act="retour">${ic('fleche')}${esc(R.retourNom || nom)}</button>`;
  function detail(a, prec, k) {
    const n = (m, d) => `<span class="lb-note" data-midi="${m}">${esc(epeler(m, a, k))}<i>${d}</i></span>`;
    const main = (nom, cls, ns, ds) => ns.length ? `<div class="lb-main ${cls}"><b>${nom}</b>${ns.map((m, i) => n(m, ds[i])).join('')}</div>` : '';
    let mvt = '';
    if (prec) {
      const nomP = m => epeler(m, prec, prec.k), part = prec.md.filter(m => !a.md.includes(m)), arr = a.md.filter(m => !prec.md.includes(m)), tient = a.md.filter(m => prec.md.includes(m));
      const bouge = part.slice(0, arr.length).map((m, i) => nomP(m) + ' vers ' + epeler(arr[i], a, k));
      if (a.md.length && prec.md.length) {
        if (!part.length && !arr.length) mvt = 'La droite ne bouge pas.';
        else if (!tient.length) mvt = 'La droite change de place.';
        else mvt = `Reste : ${tient.map(m => epeler(m, a, k)).join(', ')}.` + (bouge.length ? ` Bouge : ${bouge.join(', ')}.` : '');
      }
      if (a.mg[0] !== prec.mg[0]) mvt += ` Gauche : ${nomP(prec.mg[0])} vers ${epeler(a.mg[0], a, k)}.`;
    }
    const al = (a.alertes || []).map(x => ({ 'pouce-noire': 'Pouce sur une noire : ce doigté ne peut pas l\'éviter ici.', 'ecart-droite': "Écart large à droite : arpège si ta main ne l'atteint pas.", 'ecart-gauche': "Écart large à gauche : arpège si ta main ne l'atteint pas." }[x])).filter(Boolean);
    return main('Gauche', 'g', a.mg, a.dg) + main('Droite', 'd', a.md, a.dd) + (mvt ? `<p class="lb-mvt">${esc(mvt.trim())}</p>` : '') + [...new Set(al)].map(t => `<p class="lb-alerte">${ic('alert')}${esc(t)}</p>`).join('');
  }

  /* --- Routes --- */
  function rendre(nav = false) {
    arreter();
    if (pc() && R.ecran !== 'accueil' && R.sel == null) R.sel = R.ecran === 'parcours' ? Math.max(0, prochaine()) : R.ecran === 'catalogue' ? ((filtrees()[0] || {}).id ?? null) : listeChants()[0].id;
    racine.dataset.ecran = R.ecran; racine.dataset.pile = R.pile;
    rendreGauche();
    if (R.ecran === 'accueil') rendreApercu(); else rendreDroite();
    rendreOnglets();
    if (nav) {
      if (!pc()) { gauche.scrollTop = 0; travail.scrollTop = 0; const t = racine.querySelector(R.pile === 'd' ? '.lb-travail h2' : '.lb-gauche h2'); if (t) t.focus({ preventScroll: true }); }
      else { const t = racine.querySelector('.lb-travail h2'); if (t) t.focus({ preventScroll: true }); }
    }
  }
  function rendreDroite() {
    const voit = pc() || R.pile === 'd';
    if (R.ecran === 'parcours') { const n = R.sel ?? Math.max(0, prochaine()); if (voit) ouvrirLecon(n); }
    else if (R.ecran === 'catalogue') { const id = R.sel || (filtrees()[0] || {}).id; if (voit) { if (id) ouvrirTechnique(id); else { travail.innerHTML = `<div class="vide"><svg class="ic" aria-hidden="true"><use href="#i-grille"/></svg><b>Choisis une technique</b><span>Rien ne correspond à ces filtres.</span></div>`; montrer(null); } } }
    else if (R.ecran === 'chants') { const id = R.sel || listeChants()[0].id; if (voit) ouvrirChant(id); }
  }
  function aller(ecran, o = {}) {
    try { history.replaceState({ labs: { ...R, y: gauche.scrollTop } }, ''); } catch (e) { /* bac à sable : on navigue sans historique */ }
    R.ecran = ecran; R.sel = o.sel ?? null; R.pile = o.pile || 'g'; R.retourNom = o.retourNom || null; R.d++;
    try { history.pushState({ labs: { ...R } }, ''); } catch (e) { /* idem */ }
    rendre(true);
  }
  function retourner() {
    if (R.d > 0 && history.state && history.state.labs) { history.back(); return; }
    if (R.pile === 'd' && !pc()) { R.pile = 'g'; rendre(true); return; }
    R.ecran = 'accueil'; R.sel = null; R.pile = 'g'; rendre(true);
  }
  /* Ouvrir un objet : sur PC, un onglet de plus dans le panneau ; sur téléphone, l'écran suivant. */
  function ouvrirObjet(ecran, sel, retourNom) {
    if (!pc()) { if (ecran === 'parcours' && R.ecran !== 'parcours') aller('parcours'); aller(ecran, { sel, pile: 'd', retourNom }); return; }
    R.ecran = ecran; R.sel = sel; R.pile = 'd'; racine.dataset.ecran = ecran; racine.dataset.pile = 'd';
    try { history.replaceState({ labs: { ...R } }, ''); } catch (e) { /* idem */ }
    arreter(); rendreDroite(); gardeFocus(rendreGauche); rendreOnglets(); travail.scrollTop = 0;
  }
  const memeObjet = o => o.ecran === R.ecran && String(o.sel) === String(R.sel);
  const titreObjet = o => o.ecran === 'parcours' ? LECONS[o.sel].titre : o.ecran === 'catalogue' ? (parId(o.sel) || {}).nom || 'Technique' : (listeChants().find(c => c.id === o.sel) || {}).titre || 'Chant';
  function rendreOnglets() {
    if (!onglets) return;
    if (!pc()) { onglets.textContent = ''; return; }
    if (R.ecran !== 'accueil' && R.sel != null && !O.some(memeObjet)) O.push({ ecran: R.ecran, sel: R.sel });
    onglets.innerHTML = `<div class="ob"><button class="ob-t" role="tab" data-act="ob-apercu" aria-selected="${R.ecran === 'accueil'}">Aperçu</button></div>` + O.map((o, i) => `<div class="ob"><button class="ob-t" role="tab" data-act="ob-ouvrir" data-v="${i}" aria-selected="${memeObjet(o)}">${esc(titreObjet(o))}</button><button class="ob-x" data-act="ob-fermer" data-v="${i}" aria-label="Fermer ${esc(titreObjet(o))}">${ic('x')}</button></div>`).join('');
    const c = onglets.querySelector('[aria-selected="true"]'); if (c) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* --- Panneau de gauche : un seul arbre sur PC, une liste à la fois sur téléphone --- */
  function noeud({ k, def, force, nom, nb, corps, cls = 'ar-noeud' }) {
    const o = force || (k in PL ? PL[k] : def);
    return `<section class="ar-groupe"><button class="${cls}" data-act="plier" data-v="${k}" aria-expanded="${o}">${ic('chevron')}<span>${esc(nom)}</span>${nb != null ? `<small>${esc(nb)}</small>` : ''}</button>${o ? corps() : ''}</section>`;
  }
  function rendreGauche() {
    if (!gauche) return;
    const y = gauche.scrollTop;
    if (pc()) {
      gauche.innerHTML = outilsCatalogue() +
        noeud({ k: 'parcours', def: true, cls: 'ar-rac', nom: 'Parcours', nb: `${P.lecons.length}/${LECONS.length}`, corps: secParcours }) +
        noeud({ k: 'catalogue', def: true, force: !!U.q.trim(), cls: 'ar-rac', nom: 'Catalogue', nb: filtrees().length, corps: () => '<div id="lbListe"></div>' }) +
        noeud({ k: 'chants', def: true, cls: 'ar-rac', nom: 'Chants', nb: listeChants().length, corps: secChants });
      rendreListe(); gauche.scrollTop = y;
      return;
    }
    if (R.ecran === 'accueil') {
      const s = chantDeSession(session()), fait = P.lecons.length, nb = GP.catalogue.filter(e => e.style.includes(P.style)).length, acq = GP.catalogue.filter(e => e.style.includes(P.style) && P.acquis[e.id]).length;
      const entree = (act, icone, nom, sous) => `<button class="lb-entree" data-act="${act}">${ic(icone)}<span><b>${esc(nom)}</b><small>${esc(sous)}</small></span>${ic('fleche')}</button>`;
      gauche.innerHTML = `<nav class="lb-entrees" aria-label="Labs">
        ${entree('parcours', 'boucle', 'Parcours', `${fait} leçons faites sur ${LECONS.length}`)}
        ${entree('catalogue', 'grille', 'Catalogue', `${nb} techniques en ${styleNom()}, ${acq} acquises`)}
        ${entree('chants', 'music', 'Chants', s ? `${GP.chants.length} chants et ta grille du Live` : `${GP.chants.length} chants du domaine public`)}
      </nav>`;
    } else if (R.ecran === 'parcours') {
      gauche.innerHTML = `<div class="lb-ecran">${retour('Labs')}<h2 class="lb-titre" tabindex="-1">Parcours</h2><p class="note lb-chapo">${P.lecons.length} leçons faites sur ${LECONS.length}. Cinq minutes, un geste. Tu avances quand il sort sans regarder les mains.</p>${secParcours()}</div>`;
    } else if (R.ecran === 'catalogue') {
      gauche.innerHTML = `<div class="lb-ecran">${retour('Labs')}<h2 class="lb-titre" tabindex="-1">Catalogue</h2>${outilsCatalogue()}<div id="lbListe"></div></div>`;
      rendreListe();
    } else {
      gauche.innerHTML = `<div class="lb-ecran">${retour('Labs')}<h2 class="lb-titre" tabindex="-1">Chants</h2><p class="note lb-chapo">D'abord le squelette, puis les accords, puis tu enrichis.</p>${secChants()}</div>`;
    }
    gauche.scrollTop = y;
  }

  /* --- Aperçu : progression et prochaine leçon, sobrement --- */
  function rendreApercu() {
    GP.Audio.decalage = 0;
    const i = prochaine(), fait = P.lecons.length, dansStyle = GP.catalogue.filter(e => e.style.includes(P.style)), acq = dansStyle.filter(e => P.acquis[e.id]).length;
    const paliers = PALIERS.map((nom, p) => {
      const ls = LECONS.map((l, j) => ({ l, j })).filter(x => x.l.p === p), f = ls.filter(x => P.lecons.includes(x.j + 1)).length;
      return `<li><span class="lb-ap-nom">Palier ${p + 1} : ${esc(nom)}</span><span class="lb-ap-nb">${f}/${ls.length}</span><span class="lb-ap-barre" aria-hidden="true"><i style="width:${Math.round(f / ls.length * 100)}%"></i></span></li>`;
    }).join('');
    const l = i >= 0 ? LECONS[i] : null;
    const action = l ? `<button class="btn principal envoi" data-act="lecon" data-v="${i}">${ic('play')}<span>${fait ? 'Reprendre' : 'Commencer'}</span></button>` : `<button class="btn principal envoi" data-act="chants">${ic('music')}<span>Apprendre un chant</span></button>`;
    travail.innerHTML = `<div class="lb-ecran lb-apercu">
      ${barreCmd(menuBtn('menu-ton', 'Tonalité de travail', GP.nomNote(leTon(), { tonic: leTon(), mode: 'maj' }, notation())) + menuBtn('menu-style', 'Style', styleNom()), '', action)}
      <div class="lb-defile lb-ap-corps">
        <section class="lb-ap-prochaine">
          <p class="lb-sur">${l ? `Prochaine leçon, ${i + 1} sur ${LECONS.length}, palier ${l.p + 1} : ${esc(PALIERS[l.p])}` : 'Parcours terminé'}</p>
          <h2 tabindex="-1">${l ? esc(l.titre) : `Les ${LECONS.length} leçons sont faites`}</h2>
          <p>${l ? esc(l.geste) : 'Maintenant, garde ces gestes dans un vrai chant.'}</p>
          ${l ? `<p class="note">${esc(l.objectif)}</p>` : ''}
        </section>
        <section class="lb-ap-prog">
          <h3>Progression</h3>
          <dl><div><dt>Leçons faites</dt><dd>${fait} sur ${LECONS.length}</dd></div><div><dt>Techniques acquises en ${esc(styleNom())}</dt><dd>${acq} sur ${dansStyle.length}</dd></div></dl>
          <ol class="lb-ap-paliers">${paliers}</ol>
        </section>
      </div></div>`;
    if (!l) { montrer(null); return; }
    const k = { tonic: l.tons[0], mode: l.mode || 'maj' }, ap = construire(l.apres, k), n = ap.findIndex(a => a.geste);
    montrer(ap[Math.max(0, n)]);
  }

  /* --- Parcours --- */
  function secParcours() {
    const ici = prochaine(), sel = R.ecran === 'parcours' ? (R.sel ?? (pc() ? Math.max(0, ici) : -1)) : -1;
    return PALIERS.map((nom, p) => {
      const ls = LECONS.map((l, i) => ({ l, i })).filter(x => x.l.p === p), faits = ls.filter(x => P.lecons.includes(x.i + 1)).length;
      return noeud({ k: 'p' + p, def: !pc() || ls.some(x => x.i === sel || x.i === ici), nom: pc() ? `${p + 1}. ${nom}` : `Palier ${p + 1} : ${nom}`, nb: `${faits}/${ls.length}`, corps: () => `<ul>${ls.map(({ l, i }) => { const fait = P.lecons.includes(i + 1); return `<li><button class="lb-ligne" data-act="lecon" data-v="${i}" title="${esc(l.geste)}"${i === sel ? ' aria-current="true"' : ''}><span class="lb-num${fait ? ' fait' : ''}">${fait ? ic('check') : i + 1}</span><span class="lb-l-t"><b>${esc(l.titre)}</b><small>${esc(l.geste)}</small></span>${i === ici ? '<span class="lb-tag">Prochaine</span>' : ''}</button></li>`; }).join('')}</ul>` });
    }).join('');
  }

  /* --- Catalogue --- */
  function filtrees() {
    const q = sansAccent(U.q.trim());
    return GP.catalogue.filter(e => e.style.includes(P.style) && (!U.niv || e.niveau === U.niv) && (!q || sansAccent(e.nom + ' ' + e.pourquoi + ' ' + e.comment).includes(q)));
  }
  const outilsCatalogue = () => `<div class="lb-outils"><label class="lb-cherche">${ic('recherche')}<input id="lbQ" type="search" autocomplete="off" aria-label="Chercher une technique" placeholder="Chercher une technique" value="${esc(U.q)}"></label><div class="lb-filtres">${menuBtn('menu-style', 'Style', styleNom())}${menuBtn('menu-niv', 'Niveau', U.niv || 'Tous')}</div></div>`;
  function rendreListe() {
    const l = filtrees(), el = gauche.querySelector('#lbListe'); if (!el) return;
    const sel = R.ecran === 'catalogue' ? (R.sel || (pc() && l[0] ? l[0].id : null)) : null, cherche = !!U.q.trim();
    const fams = Object.keys(FAMILLES).map(f => [f, l.filter(e => e.famille === f)]).filter(x => x[1].length);
    el.innerHTML = (pc() ? '' : `<p class="note lb-chapo" role="status">${l.length} ${l.length > 1 ? 'techniques' : 'technique'} en ${styleNom()}</p>`) + (l.length
      ? fams.map(([f, es]) => noeud({ k: 'f-' + f, force: cherche, def: es.some(e => e.id === sel), nom: FAMILLES[f], nb: es.length, corps: () => `<ul>${es.map(e => `<li><button class="lb-ligne" data-act="tech" data-v="${e.id}"${e.id === sel ? ' aria-current="true"' : ''}><span class="lb-num${P.acquis[e.id] ? ' fait' : ''}">${P.acquis[e.id] ? ic('check') : ''}</span><span class="lb-l-t"><b>${esc(e.nom)}</b><small>Niveau ${e.niveau}${e.mode === 'min' ? ', mineur' : ''}</small></span></button></li>`).join('')}</ul>` })).join('')
      : `<div class="vide"><b>Aucune technique</b><span>Rien pour ces filtres en ${styleNom()}.</span><button class="btn" data-act="sans-filtre">Enlever les filtres</button></div>`);
  }

  /* --- Fiche : une leçon ou une technique --- */
  function ouvrirLecon(i) {
    const l = LECONS[i], e = l.id ? parId(l.id) : null;
    const memo = F && F.cle === 'l' + i ? F : null;
    F = { cle: 'l' + i, lecon: i, titre: l.titre, sur: `Leçon ${i + 1} sur ${LECONS.length}, palier ${l.p + 1}`, geste: l.geste, comment: e ? e.comment : '', objectif: l.objectif, exercice: l.exercice, pourquoi: l.pourquoi || (e && e.pourquoi), a_ecouter: l.a_ecouter || (e && e.a_ecouter), source: e && e.source, mode: l.mode || 'maj', famille: e && e.famille, cadre: { avant: l.avant, apres: l.apres }, ordre: [...l.tons, ...QUARTES.filter(t => !l.tons.includes(t))], ton: l.tons[0], version: 'avant', i: 0, tempo: 'lent', boucle: false, ecoute: false, hors: e && !e.style.includes(P.style), liens: (l.liens || []).filter(id => parId(id) && parId(id).style.includes(P.style)) };
    if (memo) { F.ton = memo.ton; F.tempo = memo.tempo; F.boucle = memo.boucle; F.ecoute = memo.ecoute; }
    rendreFiche();
  }
  function ouvrirTechnique(id) {
    const e = parId(id), memo = F && F.cle === id ? F : null;
    F = { cle: id, entree: e, titre: e.nom, sur: `${FAMILLES[e.famille]}, niveau ${e.niveau}${e.mode === 'min' ? ', mineur' : ''}`, geste: e.comment, pourquoi: e.pourquoi, a_ecouter: e.a_ecouter, source: e.source, mode: e.mode, famille: e.famille, cadre: cadre(e), ordre: QUARTES, ton: memo ? memo.ton : leTon(), version: 'avant', i: 0, tempo: 'lent', boucle: false, ecoute: memo ? memo.ecoute : false, liens: [] };
    rendreFiche();
  }
  function calculerF() {
    const k = { tonic: F.ton, mode: F.mode };
    F.k = k; F.apres = construire(F.cadre.apres, k); F.avant = construire(F.cadre.avant, k, F.apres[0]);
    F.liste = F.version === 'avant' ? F.avant : F.version === 'apres' ? F.apres : [...F.avant, ...F.apres];
    F.i = Math.min(F.i, F.liste.length - 1);
    const t = P.tons[F.cle] || (P.tons[F.cle] = []); if (!t.includes(F.ton)) { t.push(F.ton); sauver(); }
  }
  const acquisF = () => F.lecon != null ? P.lecons.includes(F.lecon + 1) : !!P.acquis[F.cle];
  const tonSuivant = () => F.ordre[(F.ordre.indexOf(F.ton) + 1) % 12];
  function rendreFiche() {
    GP.Audio.decalage = 0;
    calculerF();
    const nomTon = t => GP.nomNote(t, { tonic: t, mode: F.mode }, notation()), vus = P.tons[F.cle] || [], fait = acquisF(), sui = F.lecon != null && F.lecon + 1 < LECONS.length ? F.lecon + 1 : null;
    const nomV = { avant: 'Squelette', apres: 'Enrichi', suite: 'Les deux' };
    travail.innerHTML = `<div class="lb-ecran lb-fiche">
      ${retour(F.lecon != null ? 'Parcours' : 'Catalogue')}
      ${barreCmd(menuBtn('menu-ton', 'Tonalité', GP.nomTonalite(F.k, notation())) + menuBtn('menu-style', 'Style', styleNom()),
        `<div class="seg lb-seg" role="group" aria-label="Tempo">${[['lent', 'Lent'], ['normal', 'Normal']].map(([v, n]) => `<button data-act="tempo" data-v="${v}" aria-pressed="${F.tempo === v}">${n}</button>`).join('')}</div>
         <button class="btn lb-court" data-act="boucle" aria-pressed="${F.boucle}">${ic('boucle')}<span>Boucle</span></button>
         <button class="btn lb-court" data-act="mains" aria-pressed="${P.mains}">${ic('main')}<span>Mains</span></button>`,
        boutonJeu('fiche', 'Écouter', 'play', 'principal envoi'))}
      <div class="lb-defile">
      <header class="lb-f-tete">
        <div class="lb-f-titres">
          <h2 tabindex="-1">${esc(F.titre)}</h2>
          <p class="lb-sur">${esc(F.sur)}${F.hors ? `, hors style ${esc(styleNom())}` : ''}</p>
        </div>
        <p class="lb-geste">${esc(F.geste)}</p>
      </header>
      <div class="lb-f-corps">
        <div class="lb-f-main">
          <div class="seg lb-comp" role="group" aria-label="Comparer">${Object.keys(nomV).map(v => `<button data-act="version" data-v="${v}" aria-pressed="${F.version === v}">${nomV[v]}</button>`).join('')}</div>
          <div class="lb-pas">
            <button class="icone" data-act="pas" data-v="-1" aria-label="Accord précédent">${ic('fleche')}</button>
            <ol class="lb-cartes" id="lbCartes"></ol>
            <button class="icone" data-act="pas" data-v="1" aria-label="Accord suivant">${ic('fleche')}</button>
          </div>
          <div class="lb-detail" id="lbDetail" aria-live="polite"></div>
          ${F.objectif ? `<p class="lb-txt"><b>Objectif.</b> ${esc(F.objectif)}</p><p class="lb-txt"><b>Exercice.</b> ${esc(F.exercice)}</p>` : ''}
          ${F.comment && F.lecon != null ? `<p class="lb-txt"><b>Comment.</b> ${esc(F.comment)}</p>` : ''}
          ${F.famille === 'rythme' || F.famille === 'fill' ? `<p class="lb-txt note">Ici tu vois la position de départ. Le motif se joue d'après la consigne : le catalogue ne l'écrit pas note par note.</p>` : ''}
        </div>
        <aside class="lb-f-aside">
          <div class="lb-ton-suite"><button class="btn" data-act="ton-suivant">Tonalité suivante : ${esc(nomTon(tonSuivant()))}${ic('fleche')}</button><span class="note">${vus.length} sur 12</span></div>
          <p class="lb-txt lb-ecoute" id="lbEcoute">${F.ecoute && F.a_ecouter ? `<b>À écouter.</b> ${esc(F.a_ecouter)}` : "Écoute l'enrichi jusqu'au bout. Je te dis ensuite quoi entendre."}</p>
          ${F.pourquoi ? `<details class="lb-pq"><summary>Pourquoi ça marche${ic('chevron')}</summary><p>${esc(F.pourquoi)}</p></details>` : ''}
          ${F.liens.length ? `<div class="lb-aussi"><h3>À voir aussi</h3>${F.liens.map(id => `<button class="lien" data-act="voir" data-v="${id}">${esc(parId(id).nom)}</button>`).join('')}</div>` : ''}
          ${F.source ? `<a class="lien lb-src" href="${esc(F.source)}" target="_blank" rel="noopener noreferrer">Source : ${esc(hote_(F.source))}</a>` : ''}
          <div class="lb-final">
            <button class="btn" data-act="jelai" aria-pressed="${fait}">${ic('check')}${fait ? 'Acquis' : "Je l'ai"}</button>
            ${fait && sui != null ? `<button class="btn" data-act="lecon" data-v="${sui}">Leçon suivante${ic('fleche')}</button>` : ''}
          </div>
        </aside>
      </div></div></div>`;
    rendreCartes(); peindre(F.i); peindreBoutonJeu();
  }
  const hote_ = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  function rendreCartes() {
    const el = travail.querySelector('#lbCartes'); if (!el) return;
    el.dataset.n = F.liste.length;
    el.innerHTML = F.liste.map((a, i) => `<li><button class="lb-carte${a.geste ? ' geste' : ''}" data-act="carte" data-v="${i}"><b>${esc(chiffreBasse(a, F.k))}</b><span>${esc(nomA(a, F.k))}</span></button></li>`).join('');
  }
  function peindre(i) {
    F.i = i;
    const a = F.liste[i], prec = i > 0 ? F.liste[i - 1] : null, cartes = travail.querySelectorAll('.lb-carte'), d = travail.querySelector('#lbDetail');
    cartes.forEach((c, j) => { if (j === i) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current'); });
    if (d) d.innerHTML = detail(a, prec, F.k);
    for (const [s, x] of [[-1, i === 0], [1, i === F.liste.length - 1]]) { const b = travail.querySelector(`[data-act="pas"][data-v="${s}"]`); if (b) b.disabled = x; }
    montrer(a, prec);
  }
  const baseF = () => (F.tempo === 'lent' ? 2.2 : 1.3);
  function jouerF(depuis = 0) {
    const l = F.liste.slice(depuis);
    lecture('fiche', l, baseF(), {
      surAccord: j => { if (F && F.liste[depuis + j] === l[j]) peindre(depuis + j); },
      surFin: () => {
        if (F.version !== 'avant' && !F.ecoute) { F.ecoute = true; const e = travail.querySelector('#lbEcoute'); if (e && F.a_ecouter) e.innerHTML = `<b>À écouter.</b> ${esc(F.a_ecouter)}`; }
        if (F.boucle) jouerF(0);
      }
    });
  }
  const tempsAvant = (l, i) => l.slice(0, i).reduce((s, a) => s + a.n, 0);

  /* --- Apprendre un chant --- */
  function session() {
    const A = GP.App; if (!A) return null;
    const per = A.moteur && A.moteur._periode ? A.moteur._periode() : null, bpm = per ? 60 / per : null;
    if (A.session) { try { return { bpm, ...A.session() }; } catch (e) { return null; } }
    // Repli si app.js n'expose pas session() : la grille du moteur et les réglages suffisent.
    const g0 = A.moteur && A.moteur.grille, S = reglages(); if (!g0 || !g0.length) return null;
    return { grille: g0, tonalite: g0[g0.length - 1].ton, jeu: S.jeu ?? null, notation: S.notation, style: S.style, bpm };
  }
  function listeChants() {
    const live = chantDeSession(session());
    return [...(live ? [live] : []), ...P.chants, ...GP.chants.map(chantDuCorpus)];
  }
  function secChants() {
    const live = chantDeSession(session()), sel = R.ecran === 'chants' ? (R.sel || (pc() ? listeChants()[0].id : null)) : null, corpus = GP.chants.map(chantDuCorpus);
    const ligne = c => `<li class="lb-rangee"><button class="lb-ligne" data-act="chant" data-v="${esc(c.id)}"${c.id === sel ? ' aria-current="true"' : ''} title="${esc(c.titre)}"><span class="lb-l-t"><b>${esc(c.titre)}</b><small>${esc(GP.nomTonalite(c.ton, notation()))}, ${c.cases.length} cases${c.fiabilite === 'moyenne' ? ', grille à vérifier' : ''}</small></span>${P.versions[c.id] && Object.keys(P.versions[c.id]).length ? '<span class="lb-tag">Enrichi</span>' : ''}</button>${c.id[0] === 'm' ? `<button class="icone danger" data-act="suppr" data-v="${esc(c.id)}" aria-label="Supprimer ${esc(c.titre)}">${ic('trash')}</button>` : ''}</li>`;
    return (live ? noeud({ k: 'c-live', def: true, nom: 'En cours dans le Live', corps: () => `<ul>${ligne(live)}</ul>` }) : '') +
      noeud({ k: 'c-miens', def: true, nom: 'Mes chants', nb: P.chants.length, corps: () => P.chants.length ? `<ul>${P.chants.map(ligne).join('')}</ul><div class="lb-export"><button class="lien" data-act="exporter">${ic('download')}<span>Exporter</span></button><p class="note">Un fichier pour entraîner goodplay : ta mélodie et tes grilles, sans le son ni les paroles.</p></div>` : `<p class="note lb-chapo">Rien pour l'instant. Une grille du Live s'enregistre ici sous le nom que tu choisis.</p>` }) +
      noeud({ k: 'c-dp', def: !pc() || corpus.some(c => c.id === sel), nom: 'Domaine public', nb: corpus.length, corps: () => `<ul>${corpus.map(ligne).join('')}</ul>` });
  }
  function ouvrirChant(id) {
    const ch = listeChants().find(c => c.id === id) || listeChants()[0], memo = C && C.ch.id === ch.id ? C : null;
    const jeuLive = ch.id === 'live' ? (session() || {}).jeu ?? null : leTon();
    C = memo ? { ...memo, ch } : { ch, jeu: jeuLive, etape: 1, i: 0, bpm: Math.max(30, Math.round(ch.bpm * .75)), niv: reglages().niveauMg ?? 0, mel: false, essai: null, tonOuvert: false };
    C.i = Math.min(C.i, ch.cases.length - 1);
    rendreChant();
  }
  const gardes = () => P.versions[C.ch.id] || null;
  const base = () => 60 / C.bpm;
  const sqChant = () => versionChant(C.ch, C.jeu, C.niv, null);
  const basseSeule = a => ({ ...a, md: [], dd: [], mg: a.mg.slice(0, 1), dg: a.dg.slice(0, 1), alertes: [] });
  function listeEtape() { return C.etape === 1 ? versionChant(C.ch, C.jeu, 0, null).map(basseSeule) : C.etape === 2 ? sqChant() : versionChant(C.ch, C.jeu, C.niv, gardes()); }
  const kCase = c => GP.vue(c.ton, C.jeu).pk;
  function rendreChant() {
    GP.Audio.decalage = GP.vue(C.ch.ton, C.jeu).sh;
    const ch = C.ch, v = GP.vue(ch.ton, C.jeu), n = notation(), ver = gardes() || {}, nbG = Object.keys(ver).length;
    const info = `Chant en ${GP.nomTonalite(ch.ton, n)}. ` + (C.jeu == null ? 'Tu joues comme le chant.' : `Tu joues en ${GP.nomTonalite(v.pk, n)}.`) + (v.sh ? ` Pour sonner avec le chant : ${GP.texteTranspose(ch.ton, C.jeu)}.` : '');
    const etapes = [[1, 'Le squelette'], [2, 'Les accords'], [3, 'Enrichir']];
    const sec = C.etape === 1 ? boutonJeu('melodie', 'Écouter la mélodie', 'music')
      : C.etape === 2 ? `<div class="seg lb-seg" role="group" aria-label="Main gauche">${[[0, 'Basse'], [1, 'Octave'], [2, 'Avec quinte']].map(([x, t]) => `<button data-act="niv-chant" data-v="${x}" aria-pressed="${C.niv === x}">${t}</button>`).join('')}</div>`
        : `${boutonJeu('squelette', 'Le squelette', 'play')}${ch.melodie ? `<button class="btn" data-act="avec-mel" aria-pressed="${C.mel}">${ic('music')}<span>Avec la mélodie</span></button>` : ''}<span class="note lb-cmd-note">${nbG ? `${nbG} ${nbG > 1 ? 'cases enrichies' : 'case enrichie'}` : 'Aucune case enrichie'}</span>${nbG ? `<button class="lien" data-act="vider">Tout enlever</button>` : ''}`;
    const action = C.etape === 1 ? boutonJeu('basse', 'Jouer la basse', 'play', 'principal envoi') : C.etape === 2 ? boutonJeu('accords', 'Écouter les accords', 'play', 'principal envoi') : boutonJeu('version', 'Ma version', 'play', 'principal envoi');
    travail.innerHTML = `<div class="lb-ecran lb-chant">
      ${retour('Chants')}
      ${barreCmd(menuBtn('menu-ton', 'Tonalité', C.jeu == null ? 'comme le chant' : GP.nomNote(C.jeu, { tonic: C.jeu, mode: 'maj' }, n)) + menuBtn('menu-style', 'Style', styleNom()) + `<div class="lb-bpm" role="group" aria-label="Tempo"><button class="icone" data-act="bpm" data-v="-5" aria-label="Plus lent">${ic('minus')}</button><output id="lbBpm">${C.bpm} bpm</output><button class="icone" data-act="bpm" data-v="5" aria-label="Plus rapide">${ic('plus')}</button></div>`, sec, action)}
      <div class="lb-defile">
      <header class="lb-f-tete lb-c-tete">
        <div class="lb-f-titres"><h2 tabindex="-1">${esc(ch.titre)}</h2></div>
        <p class="note">${esc(info)}${ch.fiabilite === 'moyenne' ? ' Grille à vérifier à l\'oreille.' : ''}</p>
      </header>
      ${ch.id === 'live' ? `<form class="lb-sauve" data-form="sauver"><label class="lb-champ"><span>Enregistrer dans Mes chants, sous le nom</span><input id="lbNom" maxlength="60" autocomplete="off"></label><button class="btn" type="submit">Enregistrer</button><p class="lb-err" id="lbNomErr" hidden></p></form>` : ''}
      <div class="seg lb-etapes" role="group" aria-label="Étapes">${etapes.map(([e, t]) => `<button data-act="etape" data-v="${e}" aria-pressed="${C.etape === e}"><b>${e}</b> ${t}</button>`).join('')}</div>
      <div class="lb-c-corps" data-etape="${C.etape}">
        ${C.etape < 3 ? `<div class="lb-duo" id="lbDuo"></div>` : ''}
        <ol class="lb-grille" id="lbGrille"></ol>
        ${C.etape === 3 ? `<section class="lb-props" id="lbProps" aria-label="Propositions"></section>` : `<div class="lb-detail" id="lbDetail" aria-live="polite"></div>`}
      </div>
      </div>
    </div>`;
    if (!ch.melodie) { const b = travail.querySelector('[data-jeu="melodie"]'); if (b) { b.disabled = true; b.insertAdjacentHTML('afterend', '<span class="note lb-cmd-note">Le Live ne garde pas la mélodie.</span>'); } }
    rendreGrille(); peindreCase(C.i); peindreBoutonJeu();
    if (C.etape === 3) rendreProps();
  }
  function rendreGrille() {
    const el = travail.querySelector('#lbGrille'), ver = gardes() || {};
    el.innerHTML = C.ch.cases.map((c, i) => {
      const k = kCase(c), sh = GP.vue(c.ton, C.jeu).sh, a = { racine: mod(c.racine - sh), q: c.q, basse: mod(c.basse - sh) }, nom = C.etape === 1 ? epeler(a.basse, a, k) : nomA(a, k), e = C.etape === 3 && ver[i] ? parId(ver[i]) : null;
      return `<li><button class="lb-case${e ? ' gardee' : ''}" data-act="case" data-v="${i}" data-t="${c.t}"><b>${esc(chiffreBasse(a, k))}</b><span>${esc(nom)}</span>${e ? `<small>${esc(e.nom)}</small>` : c.mots ? `<small>${esc(c.mots)}</small>` : ''}</button></li>`;
    }).join('');
  }
  /* Seule la grille défile : l'écran de travail reste en place. */
  function voirCase(b) { const g0 = b.closest('.lb-grille'), h = b.offsetTop; if (h < g0.scrollTop) g0.scrollTop = h; else if (h + b.offsetHeight > g0.scrollTop + g0.clientHeight) g0.scrollTop = h + b.offsetHeight - g0.clientHeight; }
  function peindreCase(i) {
    C.i = i;
    for (const b of travail.querySelectorAll('.lb-case')) { if (+b.dataset.v === i) { b.setAttribute('aria-current', 'true'); voirCase(b); } else b.removeAttribute('aria-current'); }
    const l = listeEtape(), j = l.findIndex(a => a.i === i), a = l[j], prec = j > 0 ? l[j - 1] : null;
    if (C.etape < 3) { peindreDuo(l, j, null); const d = travail.querySelector('#lbDetail'); if (d) d.innerHTML = detail(a, prec, a.k); }
    montrer(a, prec);
  }
  function peindreDuo(l, j, reste, decompte = null) {
    const el = travail.querySelector('#lbDuo'); if (!el) return;
    if (decompte != null) { el.innerHTML = `<div class="lb-now"><small>Prêt</small><b>${decompte}</b></div><div class="lb-next"><small>Tu commences par</small><b>${esc(chiffreBasse(l[0], l[0].k))}</b><span>${esc(C.etape === 1 ? epeler(l[0].basse, l[0], l[0].k) : nomA(l[0], l[0].k))}</span></div>`; return; }
    const a = l[j], s = l[j + 1], nom = x => C.etape === 1 ? epeler(x.basse, x, x.k) : nomA(x, x.k), t = reste ?? a.n;
    el.innerHTML = `<div class="lb-now"><small>Maintenant</small><b>${esc(chiffreBasse(a, a.k))}</b><span>${esc(nom(a))}</span></div>` + (s
      ? `<div class="lb-next"><small>Ensuite, dans ${t} temps</small><b>${esc(chiffreBasse(s, s.k))}</b><span>${esc(nom(s))}</span></div>`
      : `<div class="lb-next"><small>Ensuite</small><span>Fin du chant</span></div>`);
  }
  function jouerChant(quoi, l, { decompte = 0, melodie = false } = {}) {
    const b = base(), tics = [...Array(decompte)].map(() => ({ midis: [84], n: 1 })), tout = [...tics, ...l];
    let courant = -1;
    lecture(quoi, tout, b, {
      melodie: melodie ? [...tics.map(() => ({ midis: [] })), ...melodieJouee()] : null,
      surAccord: j => {
        clearInterval(L.batt);
        if (j < decompte) { peindreDuo(l, 0, null, decompte - j); return; }
        const x = j - decompte, a = l[x]; if (a.i !== courant) courant = a.i;
        for (const c of travail.querySelectorAll('.lb-case')) { if (+c.dataset.v === a.i) { if (c.getAttribute('aria-current') !== 'true') { c.setAttribute('aria-current', 'true'); voirCase(c); } } else c.removeAttribute('aria-current'); }
        C.i = a.i; montrer(a, x > 0 ? l[x - 1] : null);
        const d = travail.querySelector('#lbDetail'); if (d) d.innerHTML = detail(a, x > 0 ? l[x - 1] : null, a.k);
        if (C.etape < 3) { let reste = a.n; peindreDuo(l, x, reste); L.batt = setInterval(() => { reste--; if (reste > 0) peindreDuo(l, x, reste); }, b * 1000); }
      },
      surFin: () => { clearInterval(L.batt); }
    });
  }
  function melodieJouee() { const sh = GP.vue(C.ch.ton, C.jeu).sh; return C.ch.melodie.map(([m, t]) => ({ midis: m == null ? [] : [m - sh], dur: t * base() })); }
  function jouerMelodie() {
    const l = versionChant(C.ch, C.jeu, 0, null).map(basseSeule); let cumul = 0;
    const seuils = C.ch.melodie.map(([, t]) => { const x = cumul; cumul += t; return x; });
    const liste = melodieJouee().map(n => ({ midis: n.midis, n: n.dur / base() }));
    const caseDe = t => { let s = 0; for (let i = 0; i < l.length; i++) { s += l[i].n; if (t < s) return i; } return l.length - 1; };
    let dernier = -1;
    lecture('melodie', liste, base(), {
      surAccord: j => { const i = caseDe(seuils[j]); if (i !== dernier) { dernier = i; peindreCase(i); } }
    });
  }
  function rendreProps() {
    const el = travail.querySelector('#lbProps'); if (!el) return;
    const c = C.ch.cases[C.i], k = kCase(c), sh = GP.vue(c.ton, C.jeu).sh, a = { racine: mod(c.racine - sh), q: c.q, basse: mod(c.basse - sh) }, ver = gardes() || {}, ps = propositions(C.ch, C.i, P.style);
    const garde = ver[C.i] && parId(ver[C.i]); if (garde && !ps.includes(garde)) ps.unshift(garde);
    el.innerHTML = `<h3>Case ${C.i + 1} : ${esc(chiffreBasse(a, k))}, ${esc(nomA(a, k))}</h3>` + (ps.length
      ? `<ul>${ps.map(e => { const on = ver[C.i] === e.id; return `<li class="lb-prop${on ? ' gardee' : ''}"><div><b>${esc(e.nom)}</b><p>${esc(e.comment)}</p></div><div class="lb-prop-a"><button class="btn" data-act="essayer" data-v="${e.id}">${ic('haut-parleur')}Essayer</button><button class="btn" data-act="garder" data-v="${e.id}" aria-pressed="${on}">${ic(on ? 'check' : 'plus')}${on ? 'Gardé' : 'Garder'}</button></div></li>`; }).join('')}</ul>`
      : `<p class="note">Rien à proposer ici en ${esc(styleNom())}. Laisse le squelette, ou choisis une autre case.</p>`);
  }
  function essayer(id) {
    const i = C.i, g1 = { [i]: id }, tout = versionChant(C.ch, C.jeu, C.niv, g1), l = tout.filter(a => a.i === i);
    const sv = tout.find(a => a.i === i + 1); if (sv) l.push(sv);
    const li = l.map(a => ({ ...a, n: 1 }));
    lecture('essai', li, 1.2, { surAccord: j => montrer(li[j], j ? li[j - 1] : null) });
  }

  /* --- Actions --- */
  const ACT = {
    retour: retourner,
    parcours: () => aller('parcours'),
    catalogue: () => aller('catalogue'),
    chants: () => { if (pc()) ouvrirObjet('chants', listeChants()[0].id); else aller('chants'); },
    plier: (v, b) => { PL[v] = b.getAttribute('aria-expanded') !== 'true'; gardeFocus(rendreGauche); },
    exporter: () => {
      const quand = new Date(), nom = `goodplay-mes-chants-${quand.toISOString().slice(0, 10)}.json`, n = P.chants.length;
      const url = URL.createObjectURL(new Blob([JSON.stringify(paquetExport(P.chants, quand))], { type: 'application/json' })), a = document.createElement('a');
      a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      annoncer(`${n} ${n > 1 ? 'chants exportés' : 'chant exporté'} dans ${nom}.`);
    },
    'ob-apercu': () => { R.ecran = 'accueil'; R.sel = null; R.pile = 'g'; rendre(); },
    'ob-ouvrir': v => { const o = O[+v]; if (o) ouvrirObjet(o.ecran, o.sel); },
    'ob-fermer': v => {
      const i = +v, c = memeObjet(O[i]); O.splice(i, 1);
      if (!c) { rendreOnglets(); return; }
      const o = O[Math.min(i, O.length - 1)];
      if (o) ouvrirObjet(o.ecran, o.sel); else { R.ecran = 'accueil'; R.sel = null; R.pile = 'g'; rendre(); }
    },
    'menu-style': (_, b) => GP.App.menu(b, STYLES, P.style, ACT.style, { titre: 'Style' }),
    'menu-niv': (_, b) => GP.App.menu(b, [['', 'Tous niveaux'], [1, 'Niveau 1'], [2, 'Niveau 2'], [3, 'Niveau 3']], U.niv || '', ACT.niv, { titre: 'Niveau' }),
    'menu-ton': (_, b) => {
      const liste = mode => [...Array(12).keys()].map(i => [i, GP.nomNote(i, { tonic: i, mode }, notation())]);
      if (R.ecran === 'chants' && C) { GP.App.menu(b, [['', 'Comme le chant'], ...liste('maj')], C.jeu ?? '', v => { if (v === '') ACT['cton-comme'](); else ACT.cton(v); }, { titre: 'Tonalité', colonnes: true }); return; }
      if (R.ecran === 'accueil' || !F) { GP.App.menu(b, liste('maj'), leTon(), ACT.ton, { titre: 'Tonalité de travail', colonnes: true }); return; }
      const vus = P.tons[F.cle] || [];
      GP.App.menu(b, liste(F.mode).map(([i, n]) => [i, n, vus.includes(i)]), F.ton, ACT.fton, { titre: 'Tonalité', colonnes: true });
    },
    style: v => {
      P.style = v; sauver(); gardeFocus(rendreGauche);
      if (R.ecran === 'accueil') { gardeFocus(rendreApercu); return; }
      if (R.ecran === 'catalogue' && R.sel && !filtrees().some(e => e.id === R.sel)) { R.sel = (filtrees()[0] || {}).id ?? null; arreter(); rendreDroite(); rendreOnglets(); return; }
      arreter(); gardeFocus(rendreDroite);
    },
    ton: v => { P.ton = +v; sauver(); gardeFocus(rendreApercu); },
    lecon: v => ouvrirObjet('parcours', +v),
    tech: v => ouvrirObjet('catalogue', v),
    voir: v => ouvrirObjet('catalogue', v, F.lecon != null ? 'Leçon' : 'Fiche'),
    chant: v => ouvrirObjet('chants', v),
    niv: v => { U.niv = v ? +v : null; gardeFocus(rendreGauche); },
    'sans-filtre': () => { U.niv = null; U.q = ''; gardeFocus(rendreGauche); const q = gauche.querySelector('#lbQ'); if (q) q.focus(); },
    // Fiche
    version: v => {
      const jouait = L.actif && L.quoi === 'fiche', t = jouait && F.version !== 'suite' ? tempsAvant(F.liste, F.i) : 0;
      F.version = v; calculerF(); rendreCartes();
      let i = 0; if (v !== 'suite') { let s = 0; for (i = 0; i < F.liste.length - 1; i++) { s += F.liste[i].n; if (t < s) break; } }
      for (const b of travail.querySelectorAll('[data-act="version"]')) b.setAttribute('aria-pressed', b.dataset.v === v);
      peindre(i); jouerF(i);
    },
    'jeu-fiche': () => { if (L.actif && L.quoi === 'fiche') { arreter(); return; } jouerF(F.i < F.liste.length - 1 ? F.i : 0); },
    boucle: (_, b) => { F.boucle = !F.boucle; b.setAttribute('aria-pressed', F.boucle); },
    tempo: v => { F.tempo = v; for (const b of travail.querySelectorAll('[data-act="tempo"]')) b.setAttribute('aria-pressed', b.dataset.v === v); if (L.actif && L.quoi === 'fiche') jouerF(F.i); },
    mains: (_, b) => { P.mains = !P.mains; sauver(); clavier.montrerMains(P.mains); b.setAttribute('aria-pressed', P.mains); },
    carte: v => { arreter(); peindre(+v); sonAccord(F.liste[F.i]); },
    pas: v => { const i = F.i + +v; if (i < 0 || i >= F.liste.length) return; arreter(); peindre(i); sonAccord(F.liste[i]); },
    fton: v => changerTonFiche(+v),
    'ton-suivant': () => changerTonFiche(tonSuivant()),
    jelai: () => {
      if (F.lecon != null) { const n = F.lecon + 1, a = !P.lecons.includes(n); P.lecons = a ? [...P.lecons, n] : P.lecons.filter(x => x !== n); const e = LECONS[F.lecon].id; if (e) { if (a) P.acquis[e] = true; else delete P.acquis[e]; } annoncer(a ? `Leçon ${n} acquise.` : `Leçon ${n} reprise.`); gardeFocus(rendreGauche); }
      else { if (P.acquis[F.cle]) delete P.acquis[F.cle]; else { P.acquis[F.cle] = true; annoncer('Geste acquis.'); } gardeFocus(rendreGauche); }
      sauver(); const jouait = L.actif; gardeFocus(rendreFiche); if (!jouait) peindre(F.i);
    },
    // Chant
    etape: v => { arreter(); C.etape = +v; gardeFocus(rendreChant); },
    bpm: v => { C.bpm = Math.max(30, Math.min(200, C.bpm + +v)); arreter(); travail.querySelector('#lbBpm').textContent = C.bpm + ' bpm'; },
    case: v => {
      arreter(); peindreCase(+v);
      const l = listeEtape(), a = l.find(x => x.i === +v); if (C.etape === 3) rendreProps();
      if (a) sonAccord(a);
    },
    'jeu-melodie': () => { if (L.actif && L.quoi === 'melodie') { arreter(); return; } jouerMelodie(); },
    'jeu-basse': () => { if (L.actif && L.quoi === 'basse') { arreter(); peindreCase(C.i); return; } jouerChant('basse', listeEtape(), { decompte: Math.min(C.ch.mesure || 4, 4) }); },
    'jeu-accords': () => { if (L.actif && L.quoi === 'accords') { arreter(); peindreCase(C.i); return; } jouerChant('accords', listeEtape()); },
    'jeu-squelette': () => { if (L.actif && L.quoi === 'squelette') { arreter(); return; } jouerChant('squelette', sqChant(), { melodie: C.mel && !!C.ch.melodie }); },
    'jeu-version': () => { if (L.actif && L.quoi === 'version') { arreter(); return; } jouerChant('version', listeEtape(), { melodie: C.mel && !!C.ch.melodie }); },
    'avec-mel': (_, b) => { C.mel = !C.mel; b.setAttribute('aria-pressed', C.mel); },
    'niv-chant': v => { arreter(); C.niv = +v; gardeFocus(rendreChant); },
    essayer: v => essayer(v),
    garder: v => {
      const ver = P.versions[C.ch.id] || (P.versions[C.ch.id] = {});
      if (ver[C.i] === v) delete ver[C.i]; else ver[C.i] = v;
      if (!Object.keys(ver).length) delete P.versions[C.ch.id];
      sauver(); arreter(); gardeFocus(rendreChant); gardeFocus(rendreGauche);
    },
    vider: () => { delete P.versions[C.ch.id]; sauver(); arreter(); gardeFocus(rendreChant); gardeFocus(rendreGauche); },
    cton: v => { C.jeu = +v; P.ton = +v; sauver(); arreter(); gardeFocus(rendreChant); },
    'cton-comme': () => { C.jeu = null; arreter(); gardeFocus(rendreChant); },
    suppr: v => {
      const i = P.chants.findIndex(c => c.id === v); if (i < 0) return;
      annuler = { chant: P.chants[i], i, ver: P.versions[v] }; P.chants.splice(i, 1); delete P.versions[v]; sauver();
      { const k = O.findIndex(o => o.ecran === 'chants' && o.sel === v); if (k >= 0) O.splice(k, 1); }
      if (R.sel === v) { R.sel = pc() ? listeChants()[0].id : null; arreter(); rendreDroite(); }
      rendreOnglets(); gardeFocus(rendreGauche); annoncer(`« ${annuler.chant.titre} » supprimé.`, false, { act: 'annuler-suppr', nom: 'Annuler' });
    },
    'annuler-suppr': () => { if (!annuler) return; P.chants.splice(annuler.i, 0, annuler.chant); if (annuler.ver) P.versions[annuler.chant.id] = annuler.ver; annuler = null; sauver(); toast.hidden = true; gardeFocus(rendreGauche); }
  };
  function changerTonFiche(t) {
    const jouait = L.actif && L.quoi === 'fiche', i = F.i;
    F.ton = t; if (F.lecon == null) { P.ton = t; sauver(); }
    gardeFocus(rendreFiche); peindre(i); if (jouait) jouerF(i);
  }
  /* Rendre du HTML perd le focus : on le remet sur le même bouton. */
  function gardeFocus(fn) {
    const a = document.activeElement, act = a && a.dataset ? a.dataset.act : null, v = a && a.dataset ? a.dataset.v : null;
    fn();
    if (!act) return;
    const b = racine.querySelector(`[data-act="${act}"]${v != null ? `[data-v="${CSS.escape(v)}"]` : ''}`);
    if (b) b.focus({ preventScroll: true });
  }
  function sauverSession() {
    const champ = travail.querySelector('#lbNom'), err = travail.querySelector('#lbNomErr'), nom = champ.value.trim();
    if (!nom) { err.textContent = 'Donne un nom à ce chant.'; err.hidden = false; champ.setAttribute('aria-invalid', 'true'); champ.focus(); return; }
    const id = 'm' + Date.now(), chant = { ...C.ch, id, titre: nom };
    P.chants.unshift(chant);
    if (P.versions.live) { P.versions[id] = P.versions.live; delete P.versions.live; }
    sauver();
    if (!stockageOk) { P.chants.shift(); err.textContent = "Ce chant n'a pas pu être enregistré : le stockage est plein ou bloqué."; err.hidden = false; return; }
    annoncer(`« ${nom} » est dans Mes chants.`);
    R.sel = id; C = null; rendreGauche(); ouvrirChant(id); rendreOnglets();
  }

  /* Pour le Live. P vit en mémoire dès que Labs est monté : écrire à côté serait écrasé par son prochain sauver. */
  const mesChants = () => { if (!racine) charger(); return P.chants; };
  function ajouterChant(ch, remplace) {
    mesChants();
    const av = P.chants.slice(), i = remplace ? P.chants.findIndex(c => c.id === remplace) : -1;
    if (i >= 0) P.chants.splice(i, 1);
    P.chants.unshift(ch); sauver();
    if (!stockageOk) { P.chants = av; return false; }
    if (racine) rendreGauche();
    return true;
  }

  function monter(el) {
    charger();
    if (P.ton == null) { const j = reglages().jeu; if (Number.isInteger(j)) P.ton = j; } // qui joue en Do avec le Transpose travaille en Do
    mq = matchMedia('(min-width:1024px) and (min-height:521px)');
    el.innerHTML = `<div class="lb" data-ecran="accueil" data-pile="g"><div class="lb-gauche"></div><div class="lb-droite"><div class="ob-onglets" role="tablist" aria-label="Objets ouverts"></div><div class="lb-travail"></div><div class="sep" role="separator" aria-orientation="horizontal" aria-label="Hauteur du clavier" tabindex="0"></div><div class="lb-kb"><div class="kb-tete"><span class="kb-titre">Clavier</span><p class="kb-etat"></p></div><div class="kb-corps"><div class="clavier"></div></div></div></div><div class="lb-toast" hidden></div></div>`;
    racine = el.firstChild; gauche = racine.querySelector('.lb-gauche'); travail = racine.querySelector('.lb-travail'); onglets = racine.querySelector('.ob-onglets'); hote = racine.querySelector('.clavier'); toast = racine.querySelector('.lb-toast');
    clavier = GP.Clavier(hote, { basse: 36, haut: 84, mains: true, zoom: !pc() });
    clavier.montrerMains(P.mains);
    if (globalThis.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(decorer)).observe(hote);
    mq.addEventListener('change', () => { clavier.zoom(!pc()); rendre(); });

    racine.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const f = ACT[b.dataset.act]; if (f) f(b.dataset.v, b); });
    racine.addEventListener('submit', e => { e.preventDefault(); sauverSession(); });
    racine.addEventListener('input', e => { if (e.target.id === 'lbQ') { U.q = e.target.value; if (gauche.querySelector('#lbListe')) rendreListe(); else { rendreGauche(); const q = gauche.querySelector('#lbQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } if (e.target.id === 'lbNom') { e.target.removeAttribute('aria-invalid'); const x = travail.querySelector('#lbNomErr'); if (x) x.hidden = true; } });
    addEventListener('popstate', e => { const s = e.state && e.state.labs; if (!s) { if (R.d) { Object.assign(R, { ecran: 'accueil', sel: null, pile: 'g', d: 0 }); rendre(true); } return; } Object.assign(R, { retourNom: null }, s); rendre(true); gauche.scrollTop = s.y || 0; });
    /* Dans Labs, Espace écoute ou arrête. T et N ne doivent pas toucher le Live resté dessous. */
    document.addEventListener('keydown', e => {
      if (document.body.dataset.onglet !== 'labs' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code !== 'Space' && !/^[tTnN]$/.test(e.key)) return;
      e.stopImmediatePropagation();
      if (e.code !== 'Space' || (e.target.closest && e.target.closest('input,textarea,button,a,summary'))) return;
      e.preventDefault(); const b = racine.querySelector('.envoi'); if (b) b.click();
    }, true);
    new MutationObserver(() => { const labs = document.body.dataset.onglet === 'labs'; if (!labs) { arreter(); return; } rendreGauche(); if (R.ecran === 'accueil') rendreApercu(); else if (R.ecran === 'chants' && C) GP.Audio.decalage = GP.vue(C.ch.ton, C.jeu).sh; /* le Live a remis le décalage à zéro */ }).observe(document.body, { attributes: true, attributeFilter: ['data-onglet'] });
    try { history.replaceState({ ...(history.state || {}), labs: { ...R } }, ''); } catch (e) { /* idem */ }
    rendre();
  }

  GP.Labs = { monter, mesChants, ajouterChant, paquetExport, repeindre: () => { if (racine) rendre(); }, LECONS, construire, cadre, versionChant, propositions, chantDuCorpus, chantDeSession, epeler };
})();
