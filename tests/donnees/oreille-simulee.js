'use strict';
/* Oreille simulée : des notes parfaites deviennent des notes « comme l'oreille MPM les rend sur une vraie voix », d'après tests/donnees/profil-oreille.json
   (mesuré sur vocadito par oreille-mesure.js). Sert à entraîner l'Intuition sur ce qu'elle recevra vraiment.
   simuler(notes [{midi, debut, fin}] en secondes, profil, graine) → notes [{midi, debut, fin}] ; même graine, même sortie.
   node tests/donnees/oreille-simulee.js <dossier vocadito>  vérifie que la simulation appliquée aux relevés retrouve les chiffres de la vraie oreille. */
const fs = require('fs'), path = require('path'), assert = require('assert');

const PROFIL = JSON.parse(fs.readFileSync(path.join(__dirname, 'profil-oreille.json'), 'utf8'));
const QS = [.1, .25, .5, .75, .9];

function hasard(graine) { let a = graine >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const tirage = (dist, r) => { let u = r(), k0 = null; for (const [k, p] of Object.entries(dist)) { k0 = k; if ((u -= p) < 0) return k; } return k0; };
/* Tirage dans une loi connue par ses quantiles 10 à 90 : linéaire par morceaux, bornée aux extrêmes mesurés. */
const quantile = (q, r) => { const u = .1 + .8 * r(); let i = 0; while (i + 1 < QS.length - 1 && u > QS[i + 1]) i++; return q[i] + (q[i + 1] - q[i]) * (u - QS[i]) / (QS[i + 1] - QS[i]); };
const decalage = (k, r) => (k === 'autre' ? (r() < .5 ? -1 : 1) * (3 + Math.floor(r() * 5)) : +k);
const poisson = (lambda, r) => { let n = 0, p = Math.exp(-lambda), s = p, u = r(); while (u > s && n < 20) { n++; p *= lambda / n; s += p; } return n; };

function simuler(notes, profil = PROFIL, graine = 1) {
  const r = hasard(graine), sortie = [];
  notes.forEach((n, i) => {
    const dur = n.fin - n.debut, bin = profil.bins.find(b => b.max === null || dur < b.max);
    if (r() < bin.manquee) return;
    const midi = n.midi + decalage(tirage(bin.erreurs, r), r), k = +tirage(bin.pieces, r);
    let a = n.debut + quantile(profil.retardDebut, r), b = n.fin + quantile(profil.ecartFin, r);
    if (b - a < .05) b = a + .05;
    const prec = sortie[sortie.length - 1], avant = notes[i - 1];
    // Deux notes répétées sans vrai silence : l'oreille en entend souvent une seule.
    if (prec && avant && avant.midi === n.midi && prec.midi === midi && a - prec.fin < .25 && r() < profil.fusionRepetees) { prec.fin = Math.max(prec.fin, b); return; }
    const pas = (b - a) / k;
    for (let j = 0; j < k; j++) sortie.push({ midi, debut: a + j * pas, fin: a + (j + 1) * pas - (j + 1 < k ? .04 : 0) });
    // Notes ajoutées pendant celle-ci (glissements, voyelles instables) : elles coupent la note entendue.
    const extra = poisson(profil.ajoutees.parSeconde * dur, r);
    for (let e = 0; e < extra; e++) {
      const hote = sortie[sortie.length - 1], d = Math.min(quantile(profil.ajoutees.durees, r), (hote.fin - hote.debut) / 2);
      if (d < .05) break;
      const t = hote.debut + r() * (hote.fin - hote.debut - d), fin = hote.fin;
      hote.fin = t;
      sortie.push({ midi: hote.midi + decalage(tirage(profil.ajoutees.intervalles, r), r), debut: t, fin: t + d });
      if (fin - (t + d) >= .05) sortie.push({ midi: hote.midi, debut: t + d, fin });
    }
  });
  const o = sortie.filter(x => x.fin - x.debut >= .03).sort((x, y) => x.debut - y.debut);
  for (let i = 0; i + 1 < o.length; i++) if (o[i].fin > o[i + 1].debut) o[i].fin = o[i + 1].debut;
  return o.filter(x => x.fin - x.debut >= .03);
}

{ // même graine, même sortie ; une note longue et nette reste presque toujours, une note très brève tombe souvent
  const n = [{ midi: 60, debut: 0, fin: 1 }, { midi: 62, debut: 1, fin: 1.1 }, { midi: 64, debut: 1.1, fin: 2.1 }];
  assert.deepStrictEqual(simuler(n, PROFIL, 3), simuler(n, PROFIL, 3));
  let longues = 0, breves = 0;
  for (let g = 0; g < 400; g++) { const s = simuler(n, PROFIL, g); if (s.some(x => x.midi === 60 && x.debut < .3)) longues++; if (s.some(x => x.midi === 62)) breves++; }
  assert.ok(longues > 300 && breves < 280, `longues ${longues}, brèves ${breves}`);
}

if (require.main === module && process.argv[2]) {
  // Contrôle : les relevés vocadito passés dans l'oreille simulée doivent donner à peu près les chiffres de la vraie oreille (57 % de notes justes, 33 % de temps faux, médianes).
  const dir = process.argv[2], hzMidi = f => 69 + 12 * Math.log2(f / 440), med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const recouvre = (a, b) => Math.max(0, Math.min(a.fin, b.fin) - Math.max(a.debut, b.debut));
  const J = [], F = [];
  for (const f of fs.readdirSync(path.join(dir, 'Annotations/Notes')).filter(f => f.endsWith('_notesA1.csv'))) {
    const v = fs.readFileSync(path.join(dir, 'Annotations/Notes', f), 'utf8').trim().split(/\r?\n/).map(l => l.split(',').map(Number)).filter(x => x.length >= 3 && x[1] > 0).map(([d, hz, du]) => ({ debut: d, fin: d + du, midi: Math.round(hzMidi(hz)) }));
    const s = simuler(v, PROFIL, 11), tv = v.reduce((a, e) => a + e.fin - e.debut, 0), ts = s.reduce((a, e) => a + e.fin - e.debut, 0);
    let j = 0, ok = 0; for (const x of v) for (const e of s) if (e.midi % 12 === x.midi % 12) j += recouvre(x, e);
    for (const e of s) for (const x of v) if (e.midi % 12 === x.midi % 12) ok += recouvre(x, e);
    J.push(100 * j / tv); F.push(100 * (ts - ok) / ts);
  }
  console.log(`oreille simulée sur les relevés vocadito : notes justes ${med(J).toFixed(0)} %, temps faux ${med(F).toFixed(0)} % (médianes ; vraie oreille MPM : 57 %, 33 %)`);
}
module.exports = { simuler, PROFIL };
