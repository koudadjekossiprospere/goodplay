'use strict';
/* Génère js/base-hymnes.js depuis l'ABC d'Open Hymnal, téléchargé hors du dépôt. Sans dépendance. Le fichier source est une donnée : on le lit, on n'exécute rien.
   Usage : node tests/genere-base-hymnes.js <chemin du .abc>
   Sortie : mélodie et squelette de basse seulement. Ni paroles, ni notes de droits, ni commentaires de l'auteur. Voir docs/recherche/base-chants.md. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const SOURCE = 'Open Hymnal 2014.06';
const ANNEE_LIMITE = 1931;    // publié avant : domaine public américain par l'âge au 1er novembre 2026
const DECES_LIMITE = 1956;    // mort en 1956 ou après : encore protégé dans les pays à vie + 70 ans
const NOM_SANS_DATE = 1880;   // personne sans dates : l'œuvre doit être assez ancienne pour exclure ce risque
const EPS = 1e-6;

const LETTRES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ARMURES = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const mod12 = x => ((x % 12) + 12) % 12;

function armure(n) {
  const a = {};
  for (let i = 0; i < n; i++) a['FCGDAEB'[i]] = 1;
  for (let i = 0; i < -n; i++) a['BEADGCF'[i]] = -1;
  return a;
}
const hauteurK = k => mod12(LETTRES[k[0]] + (k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0));

/* Le fichier mêle UTF-8 et Latin-1 selon les airs : on décide ligne par ligne. */
function lireTexte(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: true }), lignes = [];
  let d = 0;
  while (d < buf.length) {
    let f = buf.indexOf(10, d); if (f < 0) f = buf.length;
    const b = buf.subarray(d, f);
    let t; try { t = utf8.decode(b); } catch (e) { t = b.toString('latin1'); }
    lignes.push(t.replace(/\r$/, '')); d = f + 1;
  }
  return lignes;
}

/* Découpe en airs. Les champs %OH précèdent le X: de leur air, donc dans le morceau d'avant. */
function decouper(lignes) {
  const airs = []; let courant = [];
  for (const l of lignes) {
    if (/^X:/.test(l)) { courant = []; airs.push({ pre: airs.length ? airs[airs.length - 1].corps : lignesAvant(lignes), corps: courant }); continue; }
    courant.push(l);
  }
  return airs;
}
const lignesAvant = lignes => lignes.slice(0, lignes.findIndex(l => /^X:/.test(l)));

const champ = (ls, re) => { for (const l of ls) { const m = l.match(re); if (m) return m[1].trim(); } return ''; };

/* Lit une voix : le texte de toutes ses lignes bout à bout. d et t en temps (l'unité est le dénominateur de M:). */
function lireVoix(s, L, den, sig) {
  const r = { evts: [], barres: [], reprises: 0, variantes: 0, superpositions: 0, q: null, changeMesure: false };
  let t = 0, acc = {}, n = 0, tup = null, casse = 1;
  const longueur = (num, bar, deno) => {
    let v = num === '' ? 1 : +num;
    if (deno !== '') v /= +deno; else if (bar) v /= 2 ** bar.length;
    return v * L * den;
  };
  const hauteur = (a, lettre, oct, cles) => {
    const maj = lettre.toUpperCase();
    let o = lettre === maj ? 0 : 12;
    for (const c of oct) o += c === ',' ? -12 : 12;
    const k = maj + o;
    if (a) acc[k] = a === '=' ? 0 : a[0] === '^' ? a.length : -a.length;
    const alt = k in acc ? acc[k] : (sig[maj] || 0);
    cles[k] = alt;
    return 60 + LETTRES[maj] + o + alt;
  };
  const ajoute = (p, d, cles) => {
    if (tup) { d *= tup.q / tup.p; if (--tup.r <= 0) tup = null; }
    d *= casse; casse = 1;
    r.evts.push({ t, d, p, lie: false, cles }); t += d;
  };
  const NOTE = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)(\d*)(\/*)(\d*)/, REPOS = /^[zx](\d*)(\/*)(\d*)/;
  while (n < s.length) {
    const c = s[n], reste = s.slice(n, n + 40);
    let m;
    if (c === '!') { const f = s.indexOf('!', n + 1); n = f < 0 ? s.length : f + 1; continue; }
    if (c === '"') { const f = s.indexOf('"', n + 1); n = f < 0 ? s.length : f + 1; continue; }
    if (c === '{') { const f = s.indexOf('}', n + 1); n = f < 0 ? s.length : f + 1; continue; }
    if ((m = reste.match(/^\[([A-Za-z]):([^\]]*)\]/))) {
      if (m[1] === 'Q' && r.q === null) { const q = m[2].match(/1\/4\s*=\s*(\d+)/); if (q) r.q = +q[1]; }
      if (m[1] === 'M') r.changeMesure = true;
      n += m[0].length; continue;
    }
    if ((m = reste.match(/^\[\d/))) { r.variantes++; n += 2; continue; }
    if ((m = reste.match(/^(?:\[\||:*\|+[:\]]*|::+)/))) {
      if (m[0].includes(':')) r.reprises++;
      n += m[0].length;
      if (/^\d/.test(s.slice(n, n + 1))) r.variantes++;
      if (!r.barres.length || t - r.barres[r.barres.length - 1] > EPS) r.barres.push(t);
      const dern = r.evts[r.evts.length - 1];
      acc = dern && dern.lie ? { ...dern.cles } : {};
      continue;
    }
    if (c === '&') { r.superpositions++; const f = s.indexOf('|', n); n = f < 0 ? s.length : f; continue; }
    if ((m = reste.match(/^\((\d)(?::(\d?))?(?::(\d?))?/))) {
      const p = +m[1], q = m[2] ? +m[2] : ({ 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 })[p] || 2;
      tup = { p, q, r: m[3] ? +m[3] : p };
      n += m[0].length; continue;
    }
    if (c === '-') { if (r.evts.length) r.evts[r.evts.length - 1].lie = true; n++; continue; }
    if (c === '<' || c === '>') {
      let k = 0; while (s[n + k] === c) k++;
      const a = 1 - 1 / 2 ** k, e = r.evts[r.evts.length - 1];
      if (e) { const av = e.d; e.d = c === '>' ? e.d * (1 + a) : e.d * (1 - a); t += e.d - av; casse = c === '>' ? 1 - a : 1 + a; }
      n += k; continue;
    }
    if (c === '[') {
      const f = s.indexOf(']', n);
      if (f < 0) { n = s.length; continue; }
      const dedans = s.slice(n + 1, f), p = [], cles = {};
      let lie = /-/.test(dedans), d = null, x = 0;
      while (x < dedans.length) {
        const nm = dedans.slice(x).match(NOTE);
        if (!nm) { x++; continue; }
        p.push(hauteur(nm[1] || '', nm[2], nm[3], cles));
        if (d === null) d = longueur(nm[4], nm[5], nm[6]);
        x += nm[0].length;
      }
      n = f + 1;
      const ext = s.slice(n, n + 8).match(/^(\d*)(\/*)(\d*)/);
      n += ext[0].length;
      if (p.length) { ajoute(p, (d === null ? L * den : d) * longueur(ext[1], ext[2], ext[3]) / (L * den), cles); r.evts[r.evts.length - 1].lie = lie; }
      continue;
    }
    if ((m = reste.match(REPOS))) { ajoute([], longueur(m[1], m[2], m[3]), {}); n += m[0].length; continue; }
    if ((m = reste.match(NOTE))) {
      const cles = {}, h = hauteur(m[1] || '', m[2], m[3], cles);
      ajoute([h], longueur(m[4], m[5], m[6]), cles);
      n += m[0].length; continue;
    }
    n++; // liaison, point, y, ornement court : sans effet sur les hauteurs ni les durées
  }
  r.total = t;
  return r;
}

const estPersonne = p => /^[^,;]+, /.test(p) && !/^from\b/.test(p) && !/\d/.test(p.replace(/\(.*\)/, ''));

/* Droits : renvoie un motif d'exclusion, ou null et les attributs utiles. Dans le doute, on écarte. */
function droits(cs, sLignes, compositeurs, arrangeurs) {
  const c = cs.join(' ').replace(/\s+/g, ' ');
  const i = c.search(/\bcopyright\b/i), r = i < 0 ? '' : c.slice(i).replace(/This score is a part of the Open Hymnal Project, \d+ Revision\.?/g, ' ').replace(/\s+/g, ' ').trim();
  const ms = /Music\b/.exec(c), segMusique = ms ? c.slice(ms.index, i < 0 ? undefined : i) : '';
  const motsProteges = /\b(words|lyrics)( and setting)?:? ?(copyright:? )?copyright \d{4}/i.test(r);
  const air = (segMusique.match(/'([^']+)'/) || [])[1];
  const sortie = motif => ({ motif, motsProteges, air, segMusique });

  if (!r) return sortie('droits non indiqués');
  if (/CPDL/.test(r)) return sortie('arrangement sous licence tierce (CPDL)');
  if (/(setting|tune and setting)[^.]{0,20}copyright/i.test(r) || /copyright[^.]{0,40}\bsetting\b[^.]{0,40}may be freely/i.test(r)) return sortie('arrangement ou air sous licence restreinte au culte');
  if (/per CCEH/i.test(r)) return sortie('domaine public affirmé par un tiers (CCEH)');
  const explicite = /music and setting:? public domain/i.test(r);
  const global = /^copyright: public domain\b/i.test(r);
  if (!explicite && /all other rights reserved/i.test(r)) return sortie(global ? 'mention contradictoire (domaine public et droits réservés)' : 'licence restreinte au culte');
  if (!explicite && !global) return sortie("arrangement non couvert par la mention de droits");
  if (!segMusique) return sortie('air et arrangement non identifiés');

  const libere = /(setting|portions of the setting)[^.]{0,60}released (in)?to the public domain/i.test(r);
  const annees = (segMusique.match(/\b(1\d{3}|20\d{2})\b/g) || []).map(Number);
  const anneeMax = annees.length ? Math.max(...annees) : null;
  if (anneeMax !== null && anneeMax >= ANNEE_LIMITE && !libere) return sortie('air ou arrangement daté de ' + ANNEE_LIMITE + ' ou après');

  const [partAir, partArr] = segMusique.split(/Setting:/i), an = t => (t || '').match(/\b(1\d{3}|20\d{2})\b/g);
  const anAir = an(partAir) || an(partArr), anArr = an(partArr) || an(partAir);
  const risque = (p, ans) => {
    const m = p.match(/\((?:circa )?(\d{4})?\s*-\s*(\d{4}|\?)?\)/);
    if (m) {
      const deces = m[2] && m[2] !== '?' ? +m[2] : null, naissance = m[1] ? +m[1] : null;
      return (deces !== null ? deces >= DECES_LIMITE : (naissance === null || naissance >= NOM_SANS_DATE)) ? 'auteur vivant ou mort depuis moins de 70 ans' : null;
    }
    return estPersonne(p) && (!ans || Math.max(...ans.map(Number)) >= NOM_SANS_DATE) ? 'auteur sans dates, œuvre trop récente pour conclure' : null;
  };
  for (const [liste, ans] of [[compositeurs, anAir], [arrangeurs, anArr]]) for (const p of liste) {
    const pb = risque(p, ans);
    if (pb && !(libere && liste === arrangeurs)) return sortie(pb);
  }

  const music = sLignes.filter(l => /^\s*(music|setting|arrangement)\b/i.test(l));
  const anS = an(music.join(' '));
  if (anS && Math.min(...anS.map(Number)) >= ANNEE_LIMITE) return sortie('transcrit depuis un recueil récent, sans contre-vérification ancienne');
  return { motif: null, motsProteges, air, segMusique, libere };
}

/* Le pas du squelette : la demi-mesure quand elle tombe juste, sinon la mesure. 4/4 : 2 ; 2/4 : 2 ; 2/2 : 1 ; 3/4 : 3 ; 6/8 : 3 ; 9/8 : 3 ; 12/8 : 6. */
function pas(mesure, den) {
  if (den === 8 && mesure % 3 === 0 && mesure > 3) return mesure === 9 ? 3 : mesure / 2;
  if (mesure === 2) return den >= 4 ? 2 : 1;
  return mesure % 2 === 0 ? mesure / 2 : mesure;
}

/* Bornes : mesure pleine calée sur son début ; mesure incomplète, levée le plus souvent, calée sur sa fin. */
function bornes(barres, total, mesure, p) {
  const b = [0, ...barres, total].filter((x, i, a) => i === 0 || x - a[i - 1] > EPS), out = [];
  for (let i = 0; i + 1 < b.length; i++) {
    const a = b[i], f = b[i + 1], L = f - a;
    if (L >= mesure - EPS) { for (let t = a; t < f - EPS; t += p) out.push(t); continue; }
    const ici = [];
    for (let t = f - p; t > a - EPS; t -= p) ici.unshift(t);
    if (!ici.length && i === 0) continue;      // levée initiale : rattachée au premier accord
    if (!ici.length && i === b.length - 2) ici.push(a);  // dernier fragment : il garde son accord
    out.push(...ici);
  }
  return out.length ? out : [0];
}

const GABARITS = [[0, 4, 7], [0, 3, 7], [0, 4, 7, 10], [0, 3, 7, 10]];
const GAMMES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };
const DEGRE = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];   // demi-tons depuis la tonique vers le degré le plus proche, valable dans les deux modes
const degre = (pc, tonique) => DEGRE[mod12(pc - tonique)];

/* L'accord d'une fenêtre, d'après toutes les voix. Le moment où sonne la note de basse retenue compte le plus : une mesure peut porter deux accords.
   Tierce à la basse : on note la fondamentale. Quinte à la basse (6/4 de cadence) : on garde la basse, c'est ce que joue un bassiste. */
function accord(voix, a, b, tonique, mode, prec) {
  const coupes = new Set([a, b]);
  for (const v of voix) for (const e of v.evts) {
    if (Math.min(b, e.t + e.d) - Math.max(a, e.t) <= EPS) continue;
    coupes.add(Math.max(a, e.t)); coupes.add(Math.min(b, e.t + e.d));
  }
  const ts = [...coupes].sort((x, y) => x - y), tranches = [], durees = new Map();
  let fort = null;
  for (let i = 0; i + 1 < ts.length; i++) {
    const milieu = (ts[i] + ts[i + 1]) / 2, d = ts[i + 1] - ts[i], sons = [];
    for (const v of voix) for (const e of v.evts) if (e.t <= milieu && milieu < e.t + e.d) sons.push(...e.p);
    if (!sons.length) continue;
    const bas = Math.min(...sons);
    tranches.push({ d, sons, bas });
    durees.set(bas, (durees.get(bas) || 0) + d);
    if (ts[i] <= a + EPS) fort = bas;
  }
  if (!tranches.length) return null;
  let basse = null, mieux = -1;
  for (const [m, d] of durees) { const s = d * (m === fort ? 2 : 1); if (s > mieux) { mieux = s; basse = m; } }
  const w = Array(12).fill(0);
  for (const t of tranches) for (const m of t.sons) w[mod12(m)] += t.d * (t.bas === basse ? 1 : .25);
  const tot = w.reduce((x, y) => x + y, 0), pcBasse = mod12(basse), presentes = w.map((x, i) => x > EPS ? i : -1).filter(i => i >= 0);
  if (presentes.length === 1 && prec && prec.pcs.includes(presentes[0])) return { ...prec, naif: pcBasse };
  let res = null, top = -Infinity;
  for (let r = 0; r < 12; r++) for (let g = 0; g < GABARITS.length; g++) {
    const pcs = GABARITS[g].map(x => (x + r) % 12);
    let s = 0;
    for (let i = 0; i < 12; i++) s += pcs.includes(i) ? w[i] : -.7 * w[i];
    if (w[r] <= EPS) s -= .3 * tot;
    if (r === pcBasse) s += .35 * tot;
    if (GAMMES[mode].includes(mod12(r - tonique))) s += .1 * tot;
    if (g >= 2) s -= .08 * tot;
    if (prec && prec.racine === r) s += .05 * tot;
    if (s > top) { top = s; res = { racine: r, pcs, g }; }
  }
  // Quinte à la basse, ou tierce d'un accord mineur à septième (lu comme majeur avec sixte, Fa-La-Do-Ré sur Fa) : la basse reste.
  if (pcBasse === (res.racine + 7) % 12 || (res.g === 3 && pcBasse === (res.racine + 3) % 12)) res.racine = pcBasse;
  return { ...res, naif: pcBasse };
}

/* Modulation : position de chaque fenêtre de 4 mesures sur le cercle des quintes, par rapport à l'armure. */
const QUINTES = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
function modulation(voix, total, mesure, nArm) {
  const fen = 4 * mesure, resultats = [];
  let horsArmure = 0, tout = 0;
  const homeSet = new Set([0, 2, 4, 5, 7, 9, 11].map(x => mod12(x + QUINTES[mod12(nArm)])));
  for (const v of voix) for (const e of v.evts) for (const m of e.p) { tout += e.d; if (!homeSet.has(mod12(m))) horsArmure += e.d; }
  for (let a = 0; a + fen <= total + EPS; a += mesure) {
    const w = Array(12).fill(0);
    for (const v of voix) for (const e of v.evts) {
      const o = Math.min(a + fen, e.t + e.d) - Math.max(a, e.t);
      if (o > EPS) for (const m of e.p) w[mod12(m)] += o;
    }
    let best = 0, bs = -1;
    for (let f = -6; f <= 6; f++) {
      const dec = QUINTES[mod12(nArm + f)];
      let s = 0; for (const x of [0, 2, 4, 5, 7, 9, 11]) s += w[mod12(x + dec)];
      s -= Math.abs(f) * 1e-6;
      if (s > bs) { bs = s; best = f; }
    }
    resultats.push(best);
  }
  const loin = resultats.filter(f => Math.abs(f) >= 2).length;
  return { maxi: resultats.reduce((m, f) => Math.max(m, Math.abs(f)), 0), partLoin: resultats.length ? loin / resultats.length : 0, chroma: tout ? horsArmure / tout : 0 };
}
const moduleTrop = m => m.maxi >= 3 || m.partLoin >= .25 || m.chroma >= .2;

/* Analyse d'un air, droits déjà vérifiés. Renvoie { motif } ou l'objet du chant. */
function analyser(corps) {
  const corpsSansCom = corps.map(l => (/^%/.test(l) ? '' : l.replace(/%.*$/, '')));
  const entete = corpsSansCom.filter(l => /^[A-Za-z]:/.test(l));
  const M = champ(entete, /^M:\s*(.*)$/), Lc = champ(entete, /^L:\s*(.*)$/), K = champ(entete, /^K:\s*(\S+)/);
  if (!(K in ARMURES)) return { motif: 'tonalité illisible' };
  const mM = M.match(/^(\d+)\/(\d+)/);
  if (!mM) return { motif: 'mesure libre' };
  const mesure = +mM[1], den = +mM[2], mL = Lc.match(/^1\/(\d+)/), L = mL ? 1 / +mL[1] : .125;
  const textes = new Map();
  for (const l of corpsSansCom) {
    const m = l.match(/^\s*\[V:\s*([^\]\s]+)\s*\](.*)$/);
    if (m) textes.set(m[1], (textes.get(m[1]) || '') + ' ' + m[2]);
  }
  if (textes.size < 2) return { motif: 'voix illisibles' };
  const sig = armure(ARMURES[K]);
  const voix = [...textes.values()].map(t => lireVoix(t, L, den, sig));
  const total = voix[0].total;
  if (voix.some(v => Math.abs(v.total - total) > .01)) return { motif: 'voix désalignées' };
  if (voix.some(v => v.changeMesure)) return { motif: 'mesure changeante' };
  if (voix.some(v => v.variantes)) return { motif: 'variantes de fin' };

  // Mélodie : note haute de la première voix, liaisons fondues, silences groupés.
  const melodie = [];
  let lie = false;
  for (const e of voix[0].evts) {
    const h = e.p.length ? Math.max(...e.p) : null, der = melodie[melodie.length - 1];
    if (der && ((lie && der[0] === h) || (h === null && der[0] === null))) der[1] += e.d;
    else melodie.push([h, e.d]);
    lie = e.lie;
  }
  // Le ton. Le fichier n'écrit que des armures majeures : l'armure donne la paire, les notes finales tranchent.
  const dureeBasse = Array(12).fill(0), refrainEnTete = [...textes.values()].some(t => t.includes('"^To Refrain"'));
  let final = null;
  { const ts = [...new Set(voix.flatMap(v => v.evts.flatMap(e => [e.t, e.t + e.d])))].sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) {
      const milieu = (ts[i] + ts[i + 1]) / 2; let bas = Infinity;
      for (const v of voix) for (const e of v.evts) if (e.t <= milieu && milieu < e.t + e.d) for (const m of e.p) if (m < bas) bas = m;
      if (bas !== Infinity) { dureeBasse[mod12(bas)] += ts[i + 1] - ts[i]; final = mod12(bas); }
    } }
  if (final === null) return { motif: 'voix illisibles' };
  const hK = hauteurK(K), rel = mod12(hK + 9), mel = melodie.filter(x => x[0] !== null), mFin = mel.length ? mod12(mel[mel.length - 1][0]) : final;
  let tonique = final;
  if (final !== hK && final !== rel) {
    if (mFin === hK || mFin === rel) tonique = mFin;   // accord final renversé
    else if (mod12(final - hK) === 7 && (refrainEnTete || dureeBasse[hK] > 1.5 * dureeBasse[final])) tonique = hK;   // le couplet finit sur la dominante, le refrain conclut
  }
  const ecart = mod12(tonique - hK);
  if (![0, 2, 4, 5, 7, 9].includes(ecart)) return { motif: 'finale hors armure' };
  const mode = [0, 5, 7].includes(ecart) ? 'maj' : 'min', modal = ![0, 9].includes(ecart);

  const nNotes = melodie.filter(x => x[0] !== null).length;
  if (nNotes < 16) return { motif: 'moins de 16 notes' };
  const modu = modulation(voix, total, mesure, ARMURES[K]);
  if (moduleTrop(modu)) return { motif: 'modulation complexe', modu };

  // Squelette : une fondamentale par pas, voisines identiques fondues. La levée initiale rejoint le premier accord.
  const p = pas(mesure, den);
  const refBarres = voix.map(v => v.barres).sort((x, y) => y.length - x.length)[0];
  const st = bornes(refBarres, total, mesure, p);
  const basse = [], naive = [];
  let prec = null, chromatique = 0, renverse = 0, tTot = 0, report = st[0];
  for (let i = 0; i < st.length; i++) {
    const a = st[i], b = i + 1 < st.length ? st[i + 1] : total;
    const ac = accord(voix, a, b, tonique, mode, prec) || prec;
    if (!ac) { report += b - a; continue; }   // silence de tête : rattaché au premier accord
    const dur = b - a + report;
    report = 0; prec = ac;
    const deg = degre(ac.racine, tonique);
    tTot += dur;
    if (!GAMMES[mode].includes(mod12(ac.racine - tonique))) chromatique += dur;
    if (ac.racine !== ac.naif) renverse += dur;
    const der = basse[basse.length - 1];
    if (der && der[0] === deg) der[1] += dur; else basse.push([deg, dur]);
    const nd = degre(ac.naif, tonique), dn = naive[naive.length - 1];
    if (dn && dn[0] === nd) dn[1] += dur; else naive.push([nd, dur]);
  }
  if (!basse.length) return { motif: 'voix illisibles' };
  const q = voix[0].q === null ? 90 : Math.max(50, Math.min(160, voix[0].q));
  return {
    tonique, mode, mesure, bpm: Math.round(q * den / 4), melodie, basse, naive, total, nNotes, K, modal, modu,
    partChromatique: chromatique / tTot, partRenverse: renverse / tTot,
    reprises: voix.some(v => v.reprises), superpositions: voix.some(v => v.superpositions)
  };
}

const intervalles = mel => { const h = mel.filter(x => x[0] !== null).map(x => x[0]), o = []; for (let i = 1; i < h.length; i++) if (h[i] !== h[i - 1]) o.push(h[i] - h[i - 1]); return o; };

/* LCS sur les intervalles : sert à retrouver un chant du corpus et à aligner note à note. */
function aligner(ia, ib) {
  const n = ia.length, m = ib.length, D = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) D[i][j] = ia[i] === ib[j] ? D[i + 1][j + 1] + 1 : Math.max(D[i + 1][j], D[i][j + 1]);
  const paires = [];
  let i = 0, j = 0;
  while (i < n && j < m) { if (ia[i] === ib[j]) { paires.push([i, j]); i++; j++; } else if (D[i + 1][j] >= D[i][j + 1]) i++; else j++; }
  return paires;
}

/* Temps de début de chaque note, en repartant comme intervalles() : notes répétées fondues. */
function departs(mel) {
  const o = []; let t = 0, der = null;
  for (const [h, d] of mel) { if (h !== null && h !== der) { o.push({ t, d }); der = h; } else if (h !== null && o.length) o[o.length - 1].d += d; t += d; }
  return { o, total: t };
}
const degreA = (basse, t) => { let c = 0; for (const [d, l] of basse) { c += l; if (t < c - EPS) return d; } return basse[basse.length - 1][0]; };
const totalB = basse => basse.reduce((s, x) => s + x[1], 0);

/* Accord avec le corpus : part du temps de mélodie où les deux grilles donnent le même degré, sur les notes alignées. */
function accordCorpus(corpus, chants) {
  const lignes = [];
  for (const c of corpus) {
    const ic = intervalles(c.notes);
    let meilleur = null;
    for (const h of chants) {
      const ih = intervalles(h.melodie);
      if (Math.min(ic.length, ih.length) / Math.max(ic.length, ih.length) < .5) continue;
      const paires = aligner(ic, ih), part = paires.length / ic.length;
      if (!meilleur || part > meilleur.part) meilleur = { h, paires, part };
    }
    if (!meilleur || meilleur.part < .9) continue;
    const { h, paires, part } = meilleur, dc = departs(c.notes), dh = departs(h.melodie), tb = totalB(c.basse), hb = totalB(h.basse);
    const score = base => { let ok = 0, tout = 0; for (const [i, j] of paires) { const a = dc.o[i + 1], b = dh.o[j + 1]; if (!a || !b) continue; const dC = degreA(c.basse, a.t * tb / dc.total), dH = degreA(base, b.t * hb / dh.total); tout += a.d; if (dC === dH) ok += a.d; } return { ok, tout }; };
    lignes.push({ corpus: c.titre, source: h.titre, garde: !!h.garde, part, tonOk: c.tonique === h.tonique && c.mode === h.mode, r: score(h.basse), n: score(h.naive) });
  }
  return lignes;
}

function preparer(airs) {
  const res = [];
  airs.forEach((air, i) => {
    const titre = champ(air.corps, /^T:\s*(.*)$/).replace(/`/g, "'").replace(/\s+/g, ' ');
    const cs = air.corps.filter(l => /^C:/.test(l)).map(l => l.slice(2).trim()), ss = air.corps.filter(l => /^S:/.test(l)).map(l => l.slice(2).trim());
    const comp = champ(air.pre, /^%OHCOMPOSER(.*)$/), arr = champ(air.pre, /^%OHARRANGER(.*)$/);
    const liste = t => t.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(s => s && !/^(unknown|none|composite)$/i.test(s));
    const compositeurs = liste(comp), arrangeurs = liste(arr);
    res.push({ num: i + 1, titre, noms: compositeurs.filter(estPersonne), corps: air.corps, arrangeurInconnu: !arrangeurs.length, droit: droits(cs, ss, compositeurs, arrangeurs) });
  });
  return res;
}

function main(chemin) {
  if (!chemin) { console.error('Usage : node tests/genere-base-hymnes.js <chemin du .abc>'); process.exit(2); }
  const racine = path.join(__dirname, '..'), dst = path.join(racine, 'js', 'base-hymnes.js');
  const airs = preparer(decouper(lireTexte(fs.readFileSync(chemin))).filter(a => a.corps.some(l => /^T:/.test(l))));
  const motifs = {}, details = {}, ecarte = (m, a) => { motifs[m] = (motifs[m] || 0) + 1; (details[m] = details[m] || []).push(a.titre); };
  const garde = [], tous = [];
  for (const a of airs) {
    const r = analyser(a.corps);
    const mots = a.droit.motsProteges;
    const titre = mots ? (a.droit.air || '').replace(/`/g, "'") : a.titre;
    if (!r.motif) tous.push(Object.assign(r, { titre: a.titre, a }));
    if (a.droit.motif) { ecarte('droits : ' + a.droit.motif, a); continue; }
    if (r.motif) { ecarte(r.motif, a); continue; }
    if (!titre) { ecarte('droits : paroles protégées et pas de nom d\'air', a); continue; }
    r.titreSortie = titre; r.garde = true;
    garde.push(r);
  }
  // Doublons : même suite d'intervalles, notes répétées ignorées. On garde le premier, sous le nom de l'air quand il existe : plusieurs textes le chantent.
  const parCle = new Map();
  for (const h of garde) {
    const k = intervalles(h.melodie).join(','), der = parCle.get(k);
    if (!der) { parCle.set(k, h); continue; }
    h.garde = false; ecarte('doublon de mélodie', h.a);
    if (der.a.droit.air) der.titreSortie = der.a.droit.air.replace(/`/g, "'");
    der.groupe = true;
  }
  const finals = garde.filter(h => h.garde);
  const arrondi = x => Math.round(x * 1000) / 1000;
  const objets = finals.map(h => {
    const o = { id: 'oh' + h.a.num, titre: h.titreSortie };
    if (h.a.noms.length) o.compositeur = h.a.noms.join('; ');
    Object.assign(o, { tonique: h.tonique, mode: h.mode, mesure: h.mesure, bpm: h.bpm, melodie: h.melodie.map(([m, d]) => [m, arrondi(d)]), basse: h.basse.map(([m, d]) => [m, arrondi(d)]), source: SOURCE });
    return o;
  });
  const sortie = '/* Généré par tests/genere-base-hymnes.js depuis ' + SOURCE + ', airs libres seulement. Ne pas éditer à la main.\n   id, titre, compositeur, tonique, mode, mesure, bpm ; melodie [midi ou null, temps] ; basse [degré, temps] : squelette réduit. Voir docs/recherche/base-chants.md. */\nglobalThis.GP = globalThis.GP || {};\nGP.baseHymnes = [\n' + objets.map(o => JSON.stringify(o)).join(',\n') + '\n];\n';
  fs.writeFileSync(dst, sortie, 'utf8');

  const ecartes = Object.values(motifs).reduce((a, b) => a + b, 0);
  console.log(`airs lus : ${airs.length}, gardés : ${finals.length}, écartés : ${ecartes}`);
  if (finals.length + ecartes !== airs.length) throw new Error('les comptes ne tombent pas juste');
  for (const m of Object.keys(motifs).sort((a, b) => motifs[b] - motifs[a])) console.log(`  ${motifs[m]}\t${m}${process.argv.includes('--detail') ? '\n\t\t' + details[m].join(' ; ') : ''}`);
  const buf = Buffer.from(sortie, 'utf8');
  console.log(`js/base-hymnes.js : ${(buf.length / 1024).toFixed(1)} Ko, gzip ${(zlib.gzipSync(buf, { level: 9 }).length / 1024).toFixed(1)} Ko`);
  const liste = (lib, f) => { const l = finals.filter(f); console.log(`${lib} : ${l.length}${l.length && process.argv.includes('--detail') ? '\n  ' + l.map(h => h.titreSortie).join(' ; ') : ''}`); };
  liste('finale modale (ni tonique ni relative de l\'armure)', h => h.modal);
  liste('reprises jouées une seule fois', h => h.reprises);
  liste('superpositions ignorées dans une voix', h => h.superpositions);
  liste('marqués : plus de 15 % du temps sur une fondamentale chromatique, ramenée au degré voisin', h => h.partChromatique > .15);
  liste('titre remplacé par le nom d\'air (paroles sous licence)', h => h.a.droit.motsProteges);
  liste('arrangement libéré explicitement par son auteur vivant ou récent', h => h.a.droit.libere);
  liste('titre remplacé par le nom d\'air (mélodie partagée par plusieurs textes)', h => h.groupe);
  liste('sans compositeur nommé', h => !h.a.noms.length);
  liste('arrangeur inconnu, droits sur la seule foi de la mention globale', h => h.a.arrangeurInconnu);
  console.log(`part moyenne du temps sur une fondamentale chromatique : ${(100 * finals.reduce((s, h) => s + h.partChromatique, 0) / finals.length).toFixed(1)} %, chants concernés : ${finals.filter(h => h.partChromatique > 0).length}`);
  const renv = finals.reduce((s, h) => s + h.partRenverse, 0) / finals.length;
  console.log(`part moyenne du temps où la fondamentale diffère de la note de basse : ${(renv * 100).toFixed(1)} %`);
  // Accord avec le corpus, sur tout air analysable : un air écarté pour ses droits sert quand même de mesure, il n'est pas publié.
  const corpus = JSON.parse(fs.readFileSync(path.join(racine, 'tests', 'corpus', 'chants.json'), 'utf8'));
  for (const h of tous) h.titre = h.a.titre;
  const lignes = accordCorpus(corpus, tous);
  let ok = 0, tout = 0, okN = 0, toutN = 0;
  for (const l of lignes) {
    console.log(`  ${l.corpus} <> ${l.source}${l.garde ? '' : ' (écarté)'}${l.tonOk ? '' : ' (ton différent)'} : alignement ${(l.part * 100).toFixed(0)} %, fondamentale ${(100 * l.r.ok / l.r.tout).toFixed(0)} %, note de basse brute ${(100 * l.n.ok / l.n.tout).toFixed(0)} %`);
    ok += l.r.ok; tout += l.r.tout; okN += l.n.ok; toutN += l.n.tout;
  }
  console.log(`accord avec le corpus sur ${lignes.length} chants : ${(100 * ok / tout).toFixed(1)} % du temps (note de basse brute : ${(100 * okN / toutN).toFixed(1)} %)`);
}

if (require.main === module) main(process.argv[2]);
module.exports = { lireVoix, analyser, droits, intervalles };
