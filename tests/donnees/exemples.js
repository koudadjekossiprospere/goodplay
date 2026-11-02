'use strict';
/* Exemples de l'Intuition : un chant du jeu devient la suite de notes que le moteur verrait en direct (secondes, degrés relatifs au ton),
   avec, pour chaque note, le degré de basse qui sonne à son début. Notes parfaites, ou passées dans l'oreille simulée.
   Rien ici ne dépend de la mesure ni des temps forts : en direct, le moteur ne les connaît pas. Les champs « fort » et « fin » du jeu restent pour l'analyse.
   node tests/donnees/exemples.js <dossier donnees>   écrit jeu/exemples/{validation,test}-{parfait,oreille}.jsonl, figés (graine fixe) pour comparer les modèles.
   L'entraînement tire ses propres versions bruitées à la volée avec simuler(). */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { simuler } = require('./oreille-simulee.js');
const mod12 = x => ((x % 12) + 12) % 12, EPS = 1e-6, BPM_DEFAUT = 90;

/* Le chant en secondes au tempo écrit (ou 90 à la noire), multiplié par un facteur de tempo. */
function enSecondes(rec, facteur = 1) {
  const s = 60 / ((rec.bpm || BPM_DEFAUT) * facteur);
  return { s, notes: rec.notes.filter(n => n[0] !== null).map(([midi, t, d]) => ({ midi, debut: t * s, fin: (t + d) * s })) };
}

const accordA = (sq, t) => { for (const c of sq) if (t >= c[0] - EPS && t < c[0] + c[1] - EPS) return c; return t < sq[0][0] ? sq[0] : sq[sq.length - 1]; };

/* Une ligne par note : [classe relative au ton 0-11, midi, début, fin, silence avant (s)] ; étiquette : [degré 1-7, fondamentale relative 0-11, change (1 si la basse vient de changer)]. */
function exemple(rec, { oreille = false, graine = 1, facteur = 1 } = {}) {
  // Mes chants : les notes viennent déjà de la vraie oreille, on n'y ajoute pas de bruit.
  const { s, notes } = enSecondes(rec, facteur), vues = oreille && !rec.notesDeLOreille ? simuler(notes, undefined, graine) : notes;
  let precC = null;
  const lignes = vues.map((n, i) => {
    const c = accordA(rec.squelette, (n.debut + EPS) / s), change = precC !== null && c !== precC ? 1 : 0;
    precC = c;
    return { x: [mod12(n.midi - rec.ton.tonique), n.midi, +n.debut.toFixed(3), +n.fin.toFixed(3), +(i ? Math.max(0, n.debut - vues[i - 1].fin) : 0).toFixed(3)], y: [c[2], c[3], change] };
  });
  return { id: rec.id, famille: rec.famille, style: rec.style, ton: rec.ton, origine: rec.origine, facteur, oreille, notes: lignes.map(l => l.x), etiquettes: lignes.map(l => l.y) };
}

function main(dossier) {
  const J = path.join(dossier, 'jeu'), dst = path.join(J, 'exemples');
  fs.mkdirSync(dst, { recursive: true });
  for (const partie of ['validation', 'test']) {
    const recs = fs.readFileSync(path.join(J, partie + '.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    for (const oreille of [false, true]) {
      const l = recs.map((r, i) => exemple(r, { oreille, graine: 1000 + i }));
      fs.writeFileSync(path.join(dst, `${partie}-${oreille ? 'oreille' : 'parfait'}.jsonl`), l.map(e => JSON.stringify(e)).join('\n') + '\n');
      const n = l.reduce((a, e) => a + e.notes.length, 0), ch = l.reduce((a, e) => a + e.etiquettes.filter(y => y[2]).length, 0);
      console.log(`${partie} ${oreille ? 'oreille simulée' : 'notes parfaites'} : ${l.length} chants, ${n} notes, ${(100 * ch / n).toFixed(1)} % de notes sur un changement de basse`);
    }
  }
}

{ // Do-Ré-Mi-Fa sur 1 puis Sol sur 5, à 60 à la noire : la 5e note tombe sur le changement
  const rec = { id: 'x', ton: { tonique: 0, mode: 'maj' }, bpm: 60, notes: [[60, 0, 1], [62, 1, 1], [64, 2, 1], [65, 3, 1], [67, 4, 2], [null, 6, 1], [72, 7, 1]], squelette: [[0, 4, 1, 0], [4, 4, 5, 7]] };
  const e = exemple(rec);
  assert.deepStrictEqual(e.etiquettes.map(y => y[0]), [1, 1, 1, 1, 5, 5]); assert.deepStrictEqual(e.etiquettes.map(y => y[2]), [0, 0, 0, 0, 1, 0]);
  assert.deepStrictEqual(e.notes[5], [0, 72, 7, 8, 1]);
  const o = exemple(rec, { oreille: true, graine: 5 }); assert.ok(o.notes.length >= 3 && o.notes.every((x, i) => !i || x[2] >= o.notes[i - 1][3] - EPS));
}

if (require.main === module && process.argv[2]) main(process.argv[2]);
module.exports = { exemple, enSecondes };
