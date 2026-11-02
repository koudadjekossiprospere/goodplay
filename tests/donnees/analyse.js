'use strict';
/* Jeu d'entraînement de l'Intuition : d'une partition lue (format de lire_musicxml.py, temps en noires) à un chant du jeu.
   Sortie : mélodie, accords par temps, squelette de basse par demi-mesure (même règle que js/base-hymnes.js), fins de phrase. Aucune parole.
   Usage : node tests/donnees/analyse.js <dossier des partitions lues> <meta.json> <sortie.jsonl>
     meta.json : { id: { source, licence, droits, style, titre?, compositeur? } } ; seuls ces identifiants sont analysés (droits déjà vérifiés). */
const fs = require('fs'), path = require('path');
const B = require('../genere-base-hymnes.js');

const EPS = 1e-6, mod12 = x => ((x % 12) + 12) % 12, r3 = x => Math.round(x * 1000) / 1000;
const GAMMES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] };
const MIN_NOTES = 16, PART_COURTES = .25, AMBITUS = 24, SAUTS = 2, COUVERTURE = .9, TEXTURE = .5;
// Mesures d'un chant d'assemblée ; 16/2 ou 11/16 trahissent un fichier mal noté (mesure libre écrite en une seule mesure, par exemple).
const MESURES = ['2/2', '2/4', '3/2', '3/4', '3/8', '4/2', '4/4', '6/4', '6/8', '9/8', '12/8'];

/* Temps d'une mesure, en noires : la croche pointée en 6/8, 9/8 et 12/8. */
const tempsDe = (a, b) => (b === 8 && a % 3 === 0 && a > 3 ? 1.5 : 4 / b);
const hauts = v => v.evts.filter(e => e.p.length).map(e => Math.max(...e.p));
const moyenne = a => a.reduce((s, x) => s + x, 0) / a.length;

/* La voix chantée : celle qui porte les paroles, la plus haute si plusieurs ; sinon une voix nommée ; sinon la plus haute de la première partie. */
function choisirMelodie(voix) {
  const cand = voix.filter(v => hauts(v).length >= 8);
  if (!cand.length) return null;
  const chantees = cand.filter(v => v.syllabes >= .3 * hauts(v).length);
  const nommees = cand.filter(v => /sopran|melod|voice|voix|chant|lead|vocal|cantus/i.test(v.nom || ''));
  const premiere = cand.filter(v => v.cle.split('/')[0] === cand[0].cle.split('/')[0]);
  const pool = chantees.length ? chantees : nommees.length ? nommees : premiere;
  return pool.reduce((a, b) => (moyenne(hauts(b)) > moyenne(hauts(a)) ? b : a));
}

/* Note haute de chaque événement, liaisons fondues, trous et silences groupés. */
function melodieDe(v, tFin) {
  const mel = [];
  let lie = false;
  for (const e of v.evts) {
    if (e.t >= tFin - EPS) break;
    const h = e.p.length ? Math.max(...e.p) : null, d = Math.min(e.d, tFin - e.t);
    let der = mel[mel.length - 1];
    if (der && e.t > der.t + der.d + EPS) { mel.push({ t: der.t + der.d, d: e.t - der.t - der.d, h: null, point: false }); der = mel[mel.length - 1]; lie = false; }
    if (der && ((lie && der.h === h) || (h === null && der.h === null))) { der.d = e.t + d - der.t; der.point = der.point || !!e.point; }
    else mel.push({ t: e.t, d, h, point: !!e.point });
    lie = e.lie;
  }
  while (mel.length && mel[0].h === null) mel.shift();
  while (mel.length && mel[mel.length - 1].h === null) mel.pop();
  return mel;
}

/* Part du temps où au moins trois classes de hauteur sonnent : une harmonisation, pas une mélodie seule. */
function texture(voix, t0, t1) {
  let avec = 0, son = 0;
  const evts = voix.flatMap(v => v.evts.filter(e => e.p.length && e.t < t1 && e.t + e.d > t0));
  for (let t = t0 + .125; t < t1; t += .25) {
    const pcs = new Set();
    for (const e of evts) if (e.t <= t && t < e.t + e.d) for (const p of e.p) pcs.add(mod12(p));
    if (pcs.size) { son++; if (pcs.size >= 3) avec++; }
  }
  return son ? avec / son : 0;
}

/* Le ton : l'armure donne la paire majeur et relatif ; l'accord final écrit, la note finale de basse, puis celle de la mélodie tranchent. */
function tonDe(x, voix, mel, harm, tFin) {
  const q = x.mesures[0].quintes, maj = mod12(q * 7), rel = mod12(maj + 9);
  const finaux = [];
  for (const v of voix) for (const e of v.evts) if (e.p.length && e.t < tFin - EPS && e.t + e.d > tFin - .5) finaux.push(...e.p);
  const fb = finaux.length ? mod12(Math.min(...finaux)) : null;
  const notes = mel.filter(n => n.h !== null), mf = notes.length ? mod12(notes[notes.length - 1].h) : null;
  const hDer = harm.filter(h => h.q !== 'N' && h.t < tFin - EPS).pop(), hf = hDer ? hDer.racine : null;
  for (const c of [hf, fb, mf]) if (c === maj || c === rel) return { tonique: c, mode: c === maj ? 'maj' : 'min', modal: false, indice: x.mesures[0].mode || null };
  const f = hf !== null ? hf : fb;
  if (f === null) return null;
  const ecart = mod12(f - maj);
  if (![2, 4, 5, 7].includes(ecart)) return null;
  return { tonique: f, mode: [5, 7].includes(ecart) ? 'maj' : 'min', modal: true, indice: x.mesures[0].mode || null };
}

/* Segments d'accords écrits, coupés à la fin retenue. 'N' (pas d'accord) devient un trou. */
function segmentsSymboles(harm, tFin) {
  const s = [];
  harm.forEach((h, i) => {
    const fin = Math.min(i + 1 < harm.length ? harm[i + 1].t : tFin, tFin);
    if (fin - h.t > EPS && h.q !== 'N') s.push({ t: h.t, d: fin - h.t, racine: h.racine, q: h.q, basse: h.basse });
  });
  return s;
}

/* Accord d'une fenêtre d'après les accords écrits : le plus long, le premier temps compte double. Quinte à la basse : le bassiste joue la basse. */
function accordEcrit(segs, a, b) {
  let best = null, bs = 0;
  for (const s of segs) {
    const o = Math.min(b, s.t + s.d) - Math.max(a, s.t);
    if (o <= EPS) continue;
    const w = o * (s.t <= a + EPS && a < s.t + s.d ? 2 : 1);
    if (w > bs) { bs = w; best = s; }
  }
  if (!best) return null;
  const racineBasse = best.basse !== null && best.basse === mod12(best.racine + 7) ? best.basse : best.racine;
  return { racine: racineBasse, q: best.q, basse: best.basse };
}

/* Accords fins par temps, d'après toutes les voix, avec la règle du générateur de la base (fondamentale, quinte à la basse gardée). */
function accordsAnalyse(voix, bornes, tFin, ton) {
  const out = [];
  let prec = null;
  for (let i = 0; i < bornes.length; i++) {
    const a = bornes[i], b = i + 1 < bornes.length ? bornes[i + 1] : tFin;
    const ac = B.accord(voix, a, b, ton.tonique, ton.mode, prec);
    if (!ac) continue;
    prec = ac;
    out.push({ t: a, d: b - a, racine: ac.racine, q: ['maj', 'min', '7', 'm7'][ac.g], basse: ac.naif });
  }
  return out;
}

const fusionner = (l, cle) => {
  const o = [];
  for (const x of l) { const d = o[o.length - 1]; if (d && cle(d) === cle(x) && Math.abs(d.t + d.d - x.t) < EPS) d.d += x.d; else o.push({ ...x }); }
  return o;
};

function analyserPartition(x) {
  const m0 = x.mesures[0];
  if (!m0) return { motif: 'partition vide' };
  // Mesure principale : celle qui dure le plus. Une mesure raccourcie en fin de ligne (fréquent dans les cantiques) est tolérée, jusqu'à 20 % des mesures.
  const parSig = {};
  for (const m of x.mesures) parSig[m.sig.join('/')] = (parSig[m.sig.join('/')] || 0) + m.duree;
  const [a, b] = Object.entries(parSig).sort((p, q) => q[1] - p[1])[0][0].split('/').map(Number);
  const autres = x.mesures.filter(m => m.sig[0] !== a || m.sig[1] !== b).length;
  if (autres > .2 * x.mesures.length) return { motif: 'mesure changeante' };
  if (!MESURES.includes(a + '/' + b)) return { motif: 'mesure inhabituelle' };
  if (x.voltas) return { motif: 'variantes de fin (voltas)' };
  const total = x.mesures.reduce((s, m) => Math.max(s, m.t + m.duree), 0);
  // Changement d'armure : on garde le début, s'il fait au moins les deux tiers du chant.
  const iCh = x.mesures.findIndex(m => m.quintes !== m0.quintes);
  const tFin = iCh > 0 ? x.mesures[iCh].t : total;
  if (tFin < .66 * total) return { motif: "changement d'armure tôt" };

  const v = choisirMelodie(x.voix);
  if (!v) return { motif: 'pas de mélodie lisible' };
  const mel = melodieDe(v, tFin), notes = mel.filter(n => n.h !== null);
  if (notes.length < MIN_NOTES) return { motif: 'moins de 16 notes' };
  const tA = mel[0].t, tB = mel[mel.length - 1].t + mel[mel.length - 1].d;
  const hs = notes.map(n => n.h), ambitus = Math.max(...hs) - Math.min(...hs);
  let sauts = 0; for (let i = 1; i < hs.length; i++) if (Math.abs(hs[i] - hs[i - 1]) > 12) sauts++;
  const courtes = notes.filter(n => n.d < .5 - EPS).length / notes.length;
  if (ambitus > AMBITUS || sauts > SAUTS || courtes > PART_COURTES) return { motif: 'mélodie peu chantable (instrumentale)' };

  const harm = (x.harmonies || []).filter(h => h.t < tFin - EPS);
  const ton = tonDe(x, x.voix, mel, harm, tFin);
  if (!ton) return { motif: 'finale hors armure' };
  const barLen = a * 4 / b, beat = tempsDe(a, b), pasQ = B.pas(a, b) * 4 / b;
  const barres = x.mesures.slice(1).map(m => m.t).filter(t => t < tFin - EPS);
  const bSquelette = B.bornes(barres, tFin, barLen, pasQ), bTemps = B.bornes(barres, tFin, barLen, beat);
  const nbMesures = tFin / barLen;

  const segs = segmentsSymboles(harm, tFin);
  const avecSymboles = segs.length >= Math.max(4, nbMesures / 4);
  const tex = texture(x.voix, tA, tB);
  if (!avecSymboles && tex < TEXTURE) return { motif: 'mélodie sans accords' };

  const fines = avecSymboles ? segs : accordsAnalyse(x.voix, bTemps, tFin, ton);
  const couvert = fines.reduce((s, c) => s + Math.max(0, Math.min(tB, c.t + c.d) - Math.max(tA, c.t)), 0) / (tB - tA);
  if (couvert < COUVERTURE) return { motif: 'accords trop lacunaires' };

  // Squelette : une fondamentale par pas, voisines identiques fondues, levée rattachée au premier accord.
  const squelette = [], analyse = [];
  let prec = null, report = bSquelette[0];
  for (let i = 0; i < bSquelette.length; i++) {
    const s = bSquelette[i], e = i + 1 < bSquelette.length ? bSquelette[i + 1] : tFin;
    const ac = avecSymboles ? accordEcrit(segs, s, e) || prec : B.accord(x.voix, s, e, ton.tonique, ton.mode, prec) || prec;
    if (!ac) { report += e - s; continue; }
    prec = ac;
    squelette.push({ t: squelette.length ? s : report, d: e - (squelette.length ? s : report), racine: ac.racine });
    if (avecSymboles && tex >= TEXTURE) { const an = B.accord(x.voix, s, e, ton.tonique, ton.mode, null); if (an) analyse.push({ d: e - s, ok: an.racine === ac.racine }); }
  }
  if (!squelette.length) return { motif: 'accords trop lacunaires' };
  const sq = fusionner(squelette, c => B.degre(c.racine, ton.tonique));

  // Fins de phrase : points d'orgue, respirations, silences d'au moins un demi-temps ; à défaut, notes longues.
  const fin = new Set(), resp = x.respirations || [];
  mel.forEach((n, i) => {
    if (n.h === null) return;
    const suiv = mel[i + 1];
    if (n.point || (suiv && suiv.h === null && suiv.d >= beat / 2 - EPS) || resp.some(r => Math.abs(r - (n.t + n.d)) < EPS)) fin.add(i);
  });
  const marques = fin.size;
  let phrases = 'marques';
  if (marques < nbMesures / 8) {
    phrases = 'regles';
    const med = notes.map(n => n.d).sort((p, q) => p - q)[notes.length >> 1];
    mel.forEach((n, i) => { if (n.h !== null && i < mel.length - 1 && n.d >= Math.max(2 * beat, 1.75 * med) - EPS) fin.add(i); });
  }
  fin.add(mel.length - 1);

  // Force métrique de chaque note : 2 au premier temps, 1 au milieu d'une mesure paire, 0 sur un autre temps, -1 entre les temps.
  const fort = t => {
    let j = 0; while (j + 1 < x.mesures.length && x.mesures[j + 1].t <= t + EPS) j++;
    const m = x.mesures[j]; let pos = t - m.t;
    if (j === 0 && m.duree < barLen - EPS) pos += barLen - m.duree;
    const pair = a % 2 === 0 || (b === 8 && a % 3 === 0 && a > 3);
    if (Math.abs(pos) < EPS || Math.abs(pos - barLen) < EPS) return 2;
    if (pair && Math.abs(pos - barLen / 2) < EPS) return 1;
    return Math.abs(pos / beat - Math.round(pos / beat)) < EPS ? 0 : -1;
  };

  const alertes = [];
  if (x.reprises) alertes.push('reprises jouées une seule fois');
  if (x.finsRetirees) alertes.push('fins alternatives retirées, la dernière gardée');
  if (autres) alertes.push('quelques mesures d\'une autre mesure');
  if (iCh > 0) alertes.push("coupé au changement d'armure");
  if (ton.modal) alertes.push('finale modale');
  if (ton.indice && ((ton.indice === 'minor') !== (ton.mode === 'min'))) alertes.push('mode écrit contredit par la finale');
  const chroma = sq.filter(c => !GAMMES[ton.mode].includes(mod12(c.racine - ton.tonique))).reduce((s, c) => s + c.d, 0) / sq.reduce((s, c) => s + c.d, 0);
  if (chroma > .15) alertes.push('plus de 15 % du temps sur une fondamentale chromatique');
  const accord = analyse.length ? analyse.reduce((s, z) => s + (z.ok ? z.d : 0), 0) / analyse.reduce((s, z) => s + z.d, 0) : null;

  return {
    ton: { tonique: ton.tonique, mode: ton.mode, modal: ton.modal },
    mesure: [a, b], bpm: x.tempo ? Math.round(x.tempo) : null,
    notes: mel.map((n, i) => [n.h, r3(n.t - tA), r3(n.d), n.h === null ? null : fort(n.t), fin.has(i) ? 1 : 0]),
    accords: fusionner(fines.filter(c => c.t + c.d > tA + EPS && c.t < tB - EPS), c => c.racine + c.q + c.basse)
      .map(c => [r3(Math.max(0, c.t - tA)), r3(c.d - Math.max(0, tA - c.t)), mod12(c.racine - ton.tonique), c.q, c.basse === null || c.basse === undefined ? null : mod12(c.basse - ton.tonique)]),
    squelette: sq.map(c => [r3(Math.max(0, c.t - tA)), r3(c.d - Math.max(0, tA - c.t)), B.degre(c.racine, ton.tonique), mod12(c.racine - ton.tonique)]).filter(c => c[1] > EPS),
    origine: avecSymboles ? 'symboles' : 'harmonisation',
    accordAnalyse: accord === null ? null : r3(accord), texture: r3(tex), phrases, marques,
    alertes
  };
}

function main(dossier, metaChemin, sortie) {
  const meta = JSON.parse(fs.readFileSync(metaChemin, 'utf8')), motifs = {}, lignes = [];
  for (const id of Object.keys(meta)) {
    const f = path.join(dossier, id + '.json');
    if (!fs.existsSync(f)) { motifs['partition illisible'] = (motifs['partition illisible'] || 0) + 1; continue; }
    let r;
    try { r = analyserPartition(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (e) { r = { motif: 'erreur : ' + e.message.slice(0, 40) }; }
    if (r.motif) { motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
    lignes.push(JSON.stringify({ id, ...meta[id], ...r }));
  }
  fs.writeFileSync(sortie, lignes.join('\n') + '\n', 'utf8');
  console.log(`gardés ${lignes.length} sur ${Object.keys(meta).length}`);
  for (const [m, n] of Object.entries(motifs).sort((p, q) => q[1] - p[1])) console.log(`  ${n}\t${m}`);
}

function autoTest() {
  // Do majeur en 4/4, mélodie Do-Ré-Mi-Fa | Sol... sur une basse Do | Sol ; accords écrits Do puis Sol7 : squelette 1 puis 5, phrase finie sur le point d'orgue.
  const mel = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 62, 64, 65, 67, 72].map((p, i) => ({ t: i, d: 1, p: [p], lie: false, point: i === 7 }));
  const basse = [0, 4, 8, 12].map(t => ({ t, d: 4, p: [t % 8 ? 43 : 48], lie: false }));
  const x = {
    mesures: [0, 4, 8, 12].map(t => ({ t, duree: 4, sig: [4, 4], quintes: 0, mode: null })),
    voix: [{ cle: 'P1/1/1', nom: 'Soprano', syllabes: 16, evts: mel }, { cle: 'P1/2/1', nom: '', syllabes: 0, evts: basse }],
    harmonies: [{ t: 0, racine: 0, q: 'maj', basse: null }, { t: 4, racine: 7, q: '7', basse: null }, { t: 8, racine: 0, q: 'maj', basse: null }, { t: 12, racine: 7, q: '7', basse: null }],
    respirations: [], reprises: false, voltas: false, tempo: 96
  };
  const r = analyserPartition(x);
  if (r.motif) throw new Error(r.motif);
  const deg = r.squelette.map(c => c[2]).join('');
  if (deg !== '1515' || r.origine !== 'symboles' || r.ton.tonique !== 0 || r.ton.mode !== 'maj') throw new Error('squelette ' + deg + ' ' + JSON.stringify(r.ton));
  if (r.notes[7][4] !== 1 || r.notes[0][3] !== 2 || r.notes[2][3] !== 1 || r.notes[1][3] !== 0) throw new Error('phrases ou temps forts ' + JSON.stringify(r.notes.slice(0, 8)));
  if (r.accords[1][2] !== 7 || r.accords[1][3] !== '7') throw new Error('accords ' + JSON.stringify(r.accords));
  // Sans accords écrits et sans harmonie : refusé.
  if (analyserPartition({ ...x, harmonies: [], voix: [x.voix[0]] }).motif !== 'mélodie sans accords') throw new Error('mélodie seule acceptée');
}

autoTest();
if (require.main === module && process.argv.length >= 5) main(process.argv[2], process.argv[3], process.argv[4]);
module.exports = { analyserPartition, choisirMelodie, melodieDe, tempsDe };
