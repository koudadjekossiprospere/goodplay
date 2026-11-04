/* Contrôles des outils du jeu d'entraînement de l'Intuition (tests/donnees/) : node tests/test-donnees.js
   Chaque outil se vérifie lui-même au chargement ; les lecteurs Python sont vérifiés si Python 3 est installé. Les données elles-mêmes vivent hors du dépôt. */
const assert = require('assert'), path = require('path'), { spawnSync } = require('child_process');

for (const m of ['analyse', 'assembler', 'oreille-mesure', 'oreille-simulee', 'exemples', 'vraies-voix-jeu', 'eval-vraies-voix', 'source-openhymnal', 'source-goodplay', 'ton-jeux', 'eval-tonalite', 'ton-entrainer', 'ton-seuils', 'ton-reseau-donnees', 'ton-frais', 'concert', 'ton-concert-audio']) require('./donnees/' + m + '.js');

// Raison apprise (js/raison.js et ses poids) : Amazing Grace en Sol, deux couplets, notes parfaites. Une tonalité s'affiche dans la promesse de 5 s
// (à la note près), c'est Sol majeur à la fin, et deux passes donnent exactement la même chose.
{
  require('../js/theorie.js'); require('../js/raison-poids.js'); require('../js/raison.js');
  const ag = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'corpus', 'chants.json'), 'utf8'))[0];
  const passe = () => { const r = new globalThis.GP.Raison(), aff = []; let t = .5; for (let c = 0; c < 2; c++) for (const [m, d] of ag.notes) { const s = d * 60 / ag.bpm; if (m != null) { const e = r.note({ midi: m, debut: t, fin: t + s * .92 }); if (e) aff.push(e); } t += s; } return aff; };
  const a = passe(), b = passe();
  assert.deepStrictEqual(a, b, 'déterminisme'); assert.ok(a.length && a[0].t < 7, 'première tonalité à ' + (a[0] && a[0].t));
  assert.ok(a[a.length - 1].tonic === 7 && a[a.length - 1].mode === 'maj', 'finale ' + JSON.stringify(a[a.length - 1]));
}

// L'oreille simulée garde à peu près les chiffres mesurés : sur une gamme lente, presque tout passe ; un trille rapide perd beaucoup de notes.
const { simuler } = require('./donnees/oreille-simulee.js');
const lent = Array.from({ length: 40 }, (_, i) => ({ midi: 60 + [0, 2, 4, 5, 7][i % 5], debut: i * .6, fin: i * .6 + .55 }));
const vite = Array.from({ length: 40 }, (_, i) => ({ midi: 60 + (i % 2), debut: i * .1, fin: i * .1 + .09 }));
let nl = 0, nv = 0;
for (let g = 0; g < 20; g++) { nl += simuler(lent, undefined, g).filter(x => x.fin - x.debut > .2).length; nv += simuler(vite, undefined, g).length; }
assert(nl / 20 > 30, 'gamme lente : ' + nl / 20); assert(nv / 20 < 30, 'trille : ' + nv / 20);

let py = 'sans Python';
const exe = ['python', 'python3', 'py'].find(e => spawnSync(e, ['--version']).status === 0);
if (exe) {
  for (const f of ['lire_musicxml.py', 'source_pdmx.py', 'source_openewld.py', ...(spawnSync(exe, ['-c', 'import torch']).status === 0 ? ['ton_reseau.py', 'ton_perte.py'] : [])]) {
    const r = spawnSync(exe, ['-I', path.join(__dirname, 'donnees', f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, f + ' : ' + r.stderr);
  }
  py = 'lecteurs Python vérifiés';
}
console.log(`test-donnees : tout passe (${py}).`);
