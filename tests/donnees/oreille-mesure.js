'use strict';
/* Mesure les erreurs de l'oreille (le vrai GP.Moteur, MPM) sur des voix réelles relevées note à note, pour que le jeu d'entraînement
   puisse donner au modèle des notes « comme l'oreille les entend » et pas des notes parfaites.
   node tests/donnees/oreille-mesure.js <dossier vocadito (Audio/, Annotations/Notes/)> <sortie profil.json>
   vocadito : zenodo.org/records/5578807, CC BY 4.0, 40 extraits de voix seule ; le relevé A1 sert de vérité. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ecouter } = require('../vraies-voix.js');

const hzMidi = f => 69 + 12 * Math.log2(f / 440);
const recouvre = (a, b) => Math.max(0, Math.min(a.fin, b.fin) - Math.max(a.debut, b.debut));
const BINS = [.15, .3, .6, 1.2, Infinity];   // durées des notes relevées, en secondes
const quantiles = (a, qs = [.1, .25, .5, .75, .9]) => { const s = [...a].sort((x, y) => x - y); return s.length ? qs.map(q => +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3)) : []; };
const classeErreur = d => (d === 0 ? '0' : [1, -1, 2, -2, 12, -12].includes(d) ? String(d) : 'autre');

function lisWav(f) {
  const b = fs.readFileSync(f); let p = 12, sr = 0, ch = 1, bits = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === 'data') { assert.strictEqual(bits, 16, f); const k = Math.floor(n / 2 / ch), x = new Float32Array(k); for (let i = 0; i < k; i++) { let s = 0; for (let c = 0; c < ch; c++) s += b.readInt16LE(p + 8 + 2 * (i * ch + c)); x[i] = s / ch / 32768; } return { x, sr }; }
    p += 8 + n + (n & 1);
  }
  throw new Error('pas de données audio : ' + f);
}
const relevees = f => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map(l => l.split(',').map(Number)).filter(v => v.length >= 3 && v[1] > 0).map(([d, hz, du]) => ({ debut: d, fin: d + du, midi: hzMidi(hz) }));

/* Compare une vérité (midi entier, déjà nommée dans l'accordage de l'oreille) et les notes de l'oreille ; accumule dans acc. */
function comparer(vrai, vues, acc) {
  const utilisees = new Set(); // notes de l'oreille déjà comptées comme rendu d'une note relevée (juste, fausse ou en morceaux)
  vrai.forEach((v, iv) => {
    const dur = v.fin - v.debut, b = BINS.findIndex(x => dur < x), bin = acc.bins[b];
    bin.n++;
    const sur = vues.filter(e => recouvre(v, e) > .03);
    const main = sur.reduce((m, e) => (!m || recouvre(v, e) > recouvre(v, m) ? e : m), null);
    if (!main || recouvre(v, main) < .3 * dur) { bin.manquees++; return; }
    const err = main.midi - v.midi, pieces = sur.filter(e => e.midi === main.midi).length;
    for (const e of sur) if (e.midi === main.midi) utilisees.add(e);
    bin.pieces[Math.min(pieces, 3)] = (bin.pieces[Math.min(pieces, 3)] || 0) + 1;
    bin.erreurs[classeErreur(err)] = (bin.erreurs[classeErreur(err)] || 0) + 1;
    const premier = sur.filter(e => e.midi === main.midi).reduce((m, e) => (e.debut < m.debut ? e : m));
    acc.retards.push(premier.debut - v.debut);
    acc.finsEcart.push(sur.filter(e => e.midi === main.midi).reduce((m, e) => Math.max(m, e.fin), 0) - v.fin);
    const suiv = vrai[iv + 1];
    if (suiv && suiv.midi === v.midi && suiv.debut - v.fin < .25) { acc.repetees++; if (vues.some(e => e.midi === v.midi && recouvre(v, e) > .5 * dur && recouvre(suiv, e) > .5 * (suiv.fin - suiv.debut))) acc.fusions++; }
  });
  for (const e of vues) {
    if (utilisees.has(e) || vrai.some(v => v.midi % 12 === e.midi % 12 && recouvre(v, e) >= .5 * (e.fin - e.debut))) continue;
    acc.ajoutees.push(e.fin - e.debut);
    const pres = vrai.reduce((m, v) => (!m || Math.abs((v.debut + v.fin) / 2 - (e.debut + e.fin) / 2) < Math.abs((m.debut + m.fin) / 2 - (e.debut + e.fin) / 2) ? v : m), null);
    if (pres) acc.intervallesAjoutees[classeErreur(e.midi - pres.midi)] = (acc.intervallesAjoutees[classeErreur(e.midi - pres.midi)] || 0) + 1;
  }
  acc.secondes += vrai.reduce((s, v) => s + v.fin - v.debut, 0);
}

function nouvelAcc() { return { bins: BINS.map(max => ({ max, n: 0, manquees: 0, pieces: {}, erreurs: {} })), retards: [], finsEcart: [], ajoutees: [], intervallesAjoutees: {}, repetees: 0, fusions: 0, secondes: 0 }; }

function profil(acc) {
  const norm = o => { const z = Object.values(o).reduce((s, x) => s + x, 0); return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, +(x / z).toFixed(4)])); };
  return {
    bins: acc.bins.map(b => ({ max: b.max === Infinity ? null : b.max, n: b.n, manquee: +(b.manquees / Math.max(1, b.n)).toFixed(4), pieces: norm(b.pieces), erreurs: norm(b.erreurs) })),
    retardDebut: quantiles(acc.retards), ecartFin: quantiles(acc.finsEcart),
    ajoutees: { parSeconde: +(acc.ajoutees.length / acc.secondes).toFixed(4), durees: quantiles(acc.ajoutees), intervalles: norm(acc.intervallesAjoutees) },
    fusionRepetees: +(acc.fusions / Math.max(1, acc.repetees)).toFixed(4), secondesChantees: Math.round(acc.secondes)
  };
}

function main(dir, sortie) {
  const acc = nouvelAcc(), fichiers = fs.readdirSync(path.join(dir, 'Audio')).filter(f => /^vocadito_\d+\.wav$/.test(f));
  for (const f of fichiers) {
    const id = f.replace('.wav', ''), { x, sr } = lisWav(path.join(dir, 'Audio', f)), r = ecouter(x, sr);
    const a = r.m.accordage, vrai = relevees(path.join(dir, 'Annotations/Notes', id + '_notesA1.csv')).map(v => ({ ...v, midi: Math.round(v.midi - a) }));
    comparer(vrai, r.ev.note.map(e => ({ debut: e.debut, fin: e.fin, midi: Math.round(e.midi) })), acc);
  }
  const p = { source: 'vocadito A1, ' + fichiers.length + ' extraits, oreille MPM de js/moteur.js', ...profil(acc) };
  fs.writeFileSync(sortie, JSON.stringify(p, null, 1));
  console.log(JSON.stringify(p, null, 1));
}

{ // vérité de 3 notes : la 1re vue juste en deux morceaux, la 2e manquée, la 3e un demi-ton trop haut ; une note ajoutée
  const acc = nouvelAcc();
  comparer([{ debut: 0, fin: .5, midi: 60 }, { debut: .5, fin: .6, midi: 62 }, { debut: 1, fin: 2, midi: 64 }],
    [{ debut: .05, fin: .25, midi: 60 }, { debut: .3, fin: .5, midi: 60 }, { debut: 1.05, fin: 2, midi: 65 }, { debut: 3, fin: 3.2, midi: 67 }], acc);
  const p = profil(acc);
  assert.strictEqual(p.bins[0].manquee, 1); assert.deepStrictEqual(p.bins[2].pieces, { 2: 1 }); assert.deepStrictEqual(p.bins[3].erreurs, { 1: 1 });
  assert.strictEqual(acc.ajoutees.length, 1); // la note un demi-ton trop haut est une erreur de hauteur, pas une note ajoutée
}

if (require.main === module && process.argv.length >= 4) main(process.argv[2], process.argv[3]);
module.exports = { comparer, nouvelAcc, profil, BINS };
