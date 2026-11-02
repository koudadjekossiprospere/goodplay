/* Contrôles des outils du jeu d'entraînement de l'Intuition (tests/donnees/) : node tests/test-donnees.js
   Chaque outil se vérifie lui-même au chargement ; les lecteurs Python sont vérifiés si Python 3 est installé. Les données elles-mêmes vivent hors du dépôt. */
const assert = require('assert'), path = require('path'), { spawnSync } = require('child_process');

for (const m of ['analyse', 'assembler', 'oreille-mesure', 'oreille-simulee', 'exemples', 'vraies-voix-jeu', 'eval-vraies-voix', 'source-openhymnal', 'source-goodplay']) require('./donnees/' + m + '.js');

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
  for (const f of ['lire_musicxml.py', 'source_pdmx.py', 'source_openewld.py']) {
    const r = spawnSync(exe, ['-I', path.join(__dirname, 'donnees', f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, f + ' : ' + r.stderr);
  }
  py = 'lecteurs Python vérifiés';
}
console.log(`test-donnees : tout passe (${py}).`);
