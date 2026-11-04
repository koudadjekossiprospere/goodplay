'use strict';
/* Entraîne la Raison apprise (js/raison.js) et écrit js/raison-poids.js.
   node tests/donnees/ton-entrainer.js <dossier donnees> [--courbes] [--rapide]
   1. Tables : degrés, enchaînements de degrés, débuts et fins de phrase, comptés sur les chants d'entraînement en notes parfaites et passés
      dans l'oreille simulée (plusieurs graines). Lissage additif réglé sur la validation.
   2. Porte « chant ou parole » : régression logistique, vraie parole LibriVox (pistes d'entraînement) contre chant d'entraînement.
   3. Réglages du modèle (température, poids des durées, interpolation, probabilité de changer de tonalité, poids des phrases) :
      perte logarithmique moyenne de la vraie tonalité sur la validation, jamais sur le test.
   4. Seuils de décision : le plus de temps en bonne tonalité possible, sous la contrainte « sûre » juste au moins 98 % du temps
      sur chaque variante de validation (parfait, oreille, parole, modulation).
   --courbes : courbes d'apprentissage (10 à 100 % des chants, unigramme contre bigramme), perte en entraînement et en validation. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = path.join(__dirname, '..', '..');
globalThis.GP = globalThis.GP || {}; require(path.join(R, 'js', 'theorie.js'));
const { variante, hasard } = require('./ton-jeux.js');
const { mesurer, bilan, lireJeu } = require('./eval-tonalite.js');
const mod12 = x => ((x % 12) + 12) % 12;
const A = process.argv.slice(2), RAPIDE = A.includes('--rapide');

/* ---------- Données ---------- */
function sequencesEntrainement(recs, graines, sortes = ['parfait', 'oreille']) {
  const S = [];
  recs.forEach((rec, i) => {
    for (const sorte of sortes) for (let g = 0; g < (sorte === 'parfait' ? 1 : graines); g++) {
      const v = variante(rec, sorte, { graine: 104729 * (i + 1) + 31 * g + (sorte === 'concert' ? 7 : 0), facteur: .85 + .3 * hasard(i * 13 + g)() });
      S.push({ notes: v.notes.map(n => [n.midi, n.debut, n.fin]), debut: 0, verite: v.verite, famille: rec.famille });
    }
  });
  return S;
}

/* Phrases : même règle que js/raison.js (pause d'au moins pauseMin s et pauseRel fois l'écart médian entre attaques). */
function phrases(notes, P = { pauseMin: .2, pauseRel: .25 }) {
  const out = [false], iois = [];
  for (let i = 1; i < notes.length; i++) {
    const ioi = notes[i][1] - notes[i - 1][1]; if (ioi > 0) { iois.push(ioi); if (iois.length > 16) iois.shift(); }
    const s = iois.length < 4 ? P.pauseMin : Math.max(P.pauseMin, P.pauseRel * iois.slice().sort((a, b) => a - b)[iois.length >> 1]);
    out.push(notes[i][1] - notes[i - 1][2] >= s);
  }
  return out;
}

/* ---------- Tables ---------- */
function compter(seqs, alpha) {
  const z = () => Array(12).fill(0), C = { U: [z(), z()], B: [Array.from({ length: 12 }, z), Array.from({ length: 12 }, z)], F: [z(), z()], I: [z(), z()] };
  for (const s of seqs) {
    const [, ton, mode] = s.verite[0], m = mode === 'maj' ? 0 : 1, ph = phrases(s.notes);
    s.notes.forEach(([midi], i) => {
      const d = mod12(Math.round(midi) - ton); C.U[m][d]++;
      if (i === 0 || ph[i]) C.I[m][d]++; else C.B[m][mod12(Math.round(s.notes[i - 1][0]) - ton)][d]++;
      if (i === s.notes.length - 1 || ph[i + 1]) C.F[m][d]++;
    });
  }
  const norm = v => { const t = v.reduce((a, b) => a + b, 0) + 12 * alpha; return v.map(x => (x + alpha) / t); };
  return { U: C.U.map(norm), B: C.B.map(M => M.map(norm)), F: C.F.map(norm), I: C.I.map(norm) };
}

/* ---------- Porte chant / parole ---------- */
function traitsPorte(notes) {
  const r = [], X = [];
  for (const [, a, b] of notes) {
    const dur = b - a; r.push(dur); if (r.length > 8) r.shift();
    const courts = r.filter(x => x < .15).length / r.length, md = r.slice().sort((x, y) => x - y)[r.length >> 1];
    X.push([1, Math.log(Math.max(dur, .03)), courts, Math.log(Math.max(md, .03))]);
  }
  return X;
}
function apprendrePorte(pos, neg, iter = 400) {
  const D = [...pos.map(x => [x, 1]), ...neg.map(x => [x, 0])], w = [0, 0, 0, 0], lr = .5, wp = neg.length / pos.length; // classes équilibrées
  for (let it = 0; it < iter; it++) {
    const g = [0, 0, 0, 0]; let n = 0;
    for (const [x, y] of D) { const p = 1 / (1 + Math.exp(-x.reduce((s, v, k) => s + v * w[k], 0))), c = y ? wp : 1; for (let k = 0; k < 4; k++) g[k] += c * (p - y) * x[k]; n += c; }
    for (let k = 0; k < 4; k++) w[k] -= lr * (g[k] / n + 1e-3 * (k ? w[k] : 0)); // petite régularisation L2
  }
  return w;
}
const scorePorte = (w, x) => 1 / (1 + Math.exp(-x.reduce((s, v, k) => s + v * w[k], 0)));

/* ---------- Évaluation probabiliste ---------- */
function charger() { delete require.cache[require.resolve(path.join(R, 'js', 'raison.js'))]; require(path.join(R, 'js', 'raison.js')); }
/* Perte logarithmique de la vraie tonalité, pondérée par le temps, depuis le début du chant ; et part du temps où la plus probable est la vraie. */
function perte(seqs, poids, params) {
  let L = 0, J = 0, T = 0;
  for (const s of seqs) {
    const r = new GP.Raison(params, poids), V = s.verite;
    const vraie = t => { let v = V[0]; for (const x of V) if (x[0] <= t + 1e-9) v = x; return v; };
    s.notes.forEach(([midi, a, b], i) => {
      r.note({ midi, debut: a, fin: b });
      if (b < s.debut) return;
      const suiv = s.notes[i + 1], d = Math.max(.05, (suiv ? suiv[1] : b + .5) - b + (b - a)), v = vraie(b), k = v[1] * 2 + (v[2] === 'maj' ? 0 : 1);
      L -= d * Math.max(-20, r.la[k]); if (r.meilleure() === k) J += d; T += d;
    });
  }
  return { perte: L / T, juste: J / T };
}

function evalDecisions(jeux, poids, params) {
  const out = {};
  for (const [nom, items] of Object.entries(jeux)) {
    const res = items.map(it => { const r = new GP.Raison(params, poids), aff = []; for (const [midi, a, b] of it.notes) { const e = r.note({ midi, debut: a, fin: b }); if (e) aff.push([e.t, e.tonic, e.mode, e.etat]); } return mesurer(it, aff); });
    out[nom] = bilan(res);
  }
  return out;
}

/* ---------- Recherche des réglages ---------- */
function coordonnees(f, depart, grilles, tours = 2) {
  let best = { ...depart }, bv = f(best);
  for (let t = 0; t < tours; t++) for (const [k, vals] of Object.entries(grilles)) for (const v of vals) {
    if (v === best[k]) continue; const c = { ...best, [k]: v }, cv = f(c);
    if (cv < bv - 1e-6) { bv = cv; best = c; }
  }
  return { best, bv };
}

function main(dossier) {
  const J = path.join(dossier, 'jeu'), lire = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const train = lire(path.join(J, 'entrainement.jsonl')), paroles = JSON.parse(fs.readFileSync(path.join(J, 'ton', 'paroles.json'), 'utf8'));
  const GR = RAPIDE ? 1 : 3, seqs = sequencesEntrainement(train, GR);
  console.log(`entraînement : ${train.length} chants, ${seqs.length} suites, ${seqs.reduce((s, x) => s + x.notes.length, 0)} notes`);
  const vnoms = ['parfait', 'oreille', 'parole', 'modulation'], jeuxV = Object.fromEntries(vnoms.map(v => [v, lireJeu(dossier, 'validation-' + v)]));
  const tousV = Object.values(jeuxV).flat();

  // Porte : parole d'entraînement contre chant d'entraînement (oreille simulée) ; contrôle sur la validation.
  const pos = seqs.filter((s, i) => i % 4 === 1).slice(0, 1500).flatMap(s => traitsPorte(s.notes)), neg = paroles.entrainement.flatMap(p => traitsPorte(p.notes));
  const porte = apprendrePorte(pos, neg);
  const vpos = jeuxV.oreille.flatMap(it => traitsPorte(it.notes)), vneg = paroles.validation.flatMap(p => traitsPorte(p.notes));
  const acc = (X, y) => X.filter(x => (scorePorte(porte, x) >= .5) === y).length / X.length;
  console.log(`porte chant/parole : poids ${porte.map(x => x.toFixed(2)).join(' ')} ; validation : chant reconnu ${(100 * acc(vpos, true)).toFixed(1)} %, parole reconnue ${(100 * acc(vneg, false)).toFixed(1)} % (${vneg.length} notes de parole)`);

  charger();
  const poidsDe = (alpha, extra = {}) => ({ tables: compter(seqs, alpha), porte, params: extra });
  // Lissage et réglages du modèle : perte sur la validation (toutes variantes).
  let alpha = .5, poids = poidsDe(alpha);
  const depart = { beta: 1, gamma: 1, lambda: .7, eps: .01, af: .5, ai: .3, priorMaj: .5, porte: 0, durMax: 1 };
  const f = p => perte(tousV, poids, p).perte;
  const grilles = { beta: [.4, .6, .8, 1, 1.3, 1.7, 2.2], gamma: [0, .5, 1, 1.5], lambda: [0, .3, .5, .7, .85, 1], eps: [.001, .003, .01, .02, .04, .08], af: [0, .25, .5, 1], ai: [0, .25, .5, 1], priorMaj: [0, .25, .5, 1], porte: [0, .2, .4], durMax: [.6, 1, 1.5] };
  let { best, bv } = coordonnees(f, depart, RAPIDE ? { beta: grilles.beta, lambda: grilles.lambda, eps: grilles.eps } : grilles, RAPIDE ? 1 : 2);
  for (const a of [.05, .2, .5, 1, 2]) { const pw = poidsDe(a), v = perte(tousV, pw, best).perte; if (v < bv) { bv = v; alpha = a; poids = pw; } }
  console.log(`réglages du modèle (perte de validation ${bv.toFixed(4)}) : ${JSON.stringify(best)}, lissage ${alpha}`);
  for (const v of vnoms) { const p = perte(jeuxV[v], poids, best); console.log(`  validation ${v} : perte ${p.perte.toFixed(3)}, plus probable juste ${(100 * p.juste).toFixed(1)} % du temps`); }
  const pt = perte(seqs.filter((_, i) => i % 7 === 0), poids, best); console.log(`  entraînement (un échantillon) : perte ${pt.perte.toFixed(3)}, plus probable juste ${(100 * pt.juste).toFixed(1)} %`);

  // Seuils de décision : contrainte « sûre » juste au moins 98 % sur chaque variante.
  const objectif = p => { const r = evalDecisions(jeuxV, poids, { ...best, ...p }); const pire = Math.min(...vnoms.map(v => r[v].precisionSure ?? 1)); const tj = vnoms.reduce((s, v) => s + r[v].tempsJuste, 0) / vnoms.length; const mod = r.modulation.modDetectee ?? 0; return -(tj + .1 * mod) + (pire < .98 ? 10 * (.98 - pire) + 1 : 0); };
  const dep = { limite: 4.6, attenteMin: 2.5, pMontre: .6, dChange: .25, pSure: .97, voixSure: 6, pMod: .9, nMod: 4 };
  const gd = { attenteMin: [1.5, 2.5, 3.5], pMontre: [.4, .5, .6, .75, .9], dChange: [.05, .15, .25, .4], pSure: [.9, .95, .97, .985, .995, .999], voixSure: [3, 6, 10, 15], pMod: [.7, .8, .9, .95, .99], nMod: [2, 3, 4, 6, 8] };
  const dec = coordonnees(objectif, dep, gd, RAPIDE ? 1 : 2).best;
  const final = { ...best, ...dec };
  const rv = evalDecisions(jeuxV, poids, final);
  console.log(`seuils : ${JSON.stringify(dec)}`);
  for (const v of vnoms) console.log(`  validation ${v} : temps juste ${(100 * rv[v].tempsJuste).toFixed(1)} %, sûre juste ${rv[v].precisionSure == null ? '-' : (100 * rv[v].precisionSure).toFixed(1)} % sur ${(100 * rv[v].couvertureSure).toFixed(1)} % du temps, finale ${(100 * rv[v].finale).toFixed(1)} %${rv[v].modDetectee != null ? `, modulation vue ${(100 * rv[v].modDetectee).toFixed(1)} % en ${rv[v].modDelai.toFixed(1)} s` : ''}`);

  const sortie = { version: 1, date: new Date().toISOString().slice(0, 10), tables: poids.tables, porte, params: final, apprentissage: { chants: train.length, suites: seqs.length, lissage: alpha, perteValidation: +bv.toFixed(4) } };
  const r6 = x => Math.round(x * 1e6) / 1e6, arrondi = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? r6(v) : v)));
  fs.writeFileSync(path.join(R, 'js', 'raison-poids.js'), '/* Généré par tests/donnees/ton-entrainer.js : tables et réglages de la Raison apprise (js/raison.js). Ne pas éditer à la main. */\nglobalThis.GP = globalThis.GP || {};\nglobalThis.GP.raisonPoids = ' + JSON.stringify(arrondi(sortie)) + ';\n');
  console.log('écrit js/raison-poids.js');

  if (A.includes('--courbes')) {
    console.log('\nCourbes d\'apprentissage (perte de la vraie tonalité ; entraînement = chants vus, validation = jamais vus)\n| chants | modèle | perte entraînement | perte validation | écart |\n|---|---|---|---|---|');
    for (const frac of [.1, .25, .5, 1]) {
      const sous = train.filter((_, i) => hasard(i + 1)() < frac), ss = sequencesEntrainement(sous, GR);
      for (const [nom, lam] of [['unigramme', 0], ['bigramme', best.lambda]]) {
        const pw = { tables: compter(ss, alpha), porte, params: {} }, p = { ...best, lambda: lam };
        const te = perte(ss.filter((_, i) => i % 5 === 0), pw, p).perte, va = perte(tousV, pw, p).perte;
        console.log(`| ${sous.length} | ${nom} | ${te.toFixed(4)} | ${va.toFixed(4)} | ${(va - te).toFixed(4)} |`);
      }
    }
  }
}

{ // phrases et tables sur une petite suite : Do Ré Mi | pause | Sol Do, en Do majeur
  const notes = [[60, 0, .5], [62, .5, 1], [64, 1, 1.5], [67, 2.5, 3], [72, 3, 4]];
  assert.deepStrictEqual(phrases(notes), [false, false, false, true, false]);
  const T = compter([{ notes, verite: [[0, 0, 'maj']] }], 0);
  assert.strictEqual(T.I[0][7], .5); assert.strictEqual(T.F[0][4], .5); assert.strictEqual(T.B[0][0][2], 1); assert.strictEqual(T.U[0][0], .4);
}

if (require.main === module && A[0] && !A[0].startsWith('--')) main(A[0]);
module.exports = { compter, phrases, perte, traitsPorte };
