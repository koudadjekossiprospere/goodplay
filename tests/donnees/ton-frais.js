'use strict';
/* Contrôle du sur-apprentissage du réseau de tonalité : des chants d'ENTRAÎNEMENT (un sur sept), bruit tiré à neuf (graines jamais utilisées),
   mêmes sept variantes et même pondération que la validation. Leur perte comparée à celle de la validation (tests/donnees/ton_perte.py)
   sépare « les chants appris par cœur » (écart) de « le modèle ne sait pas mieux faire » (perte haute des deux côtés).
   node tests/donnees/ton-frais.js <dossier donnees>   écrit jeu/ton/reseau/frais-<variante>.jsonl */
const fs = require('fs'), path = require('path'), { variante, hasard } = require('./ton-jeux.js');

function main(dossier) {
  const J = path.join(dossier, 'jeu'), dst = path.join(J, 'ton', 'reseau');
  const recs = fs.readFileSync(path.join(J, 'entrainement.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter((_, i) => i % 7 === 3);
  const paroles = JSON.parse(fs.readFileSync(path.join(J, 'ton', 'paroles.json'), 'utf8')).entrainement;
  for (const [sorte, rd] of [['parfait', false], ['oreille', false], ['parole', false], ['modulation', false], ['concert', false], ['oreille', true], ['couplets', false]]) {
    const nom = rd ? 'redecoupe' : sorte;
    const out = recs.map((rec, i) => {
      const r = hasard(777777 + 7919 * i + nom.length * 31), graine = Math.floor(r() * 2 ** 31), facteur = .8 + .45 * r();
      const demi = [1, 2, 1, 2, 5, 7, -2][Math.floor(r() * 7)], parole = paroles[Math.floor(r() * paroles.length)], parole2 = paroles[Math.floor(r() * paroles.length)];
      const v = variante(rec, sorte, { graine, facteur, demi, parole, parole2, redecoupe: rd });
      return JSON.stringify({ debut: +v.debut.toFixed(3), notes: v.notes.map(x => [x.midi, +x.debut.toFixed(3), +x.fin.toFixed(3)]), verite: v.verite.map(([t, a, m]) => [+t.toFixed(3), a, m]) });
    });
    fs.writeFileSync(path.join(dst, `frais-${nom}.jsonl`), out.join('\n') + '\n');
  }
  console.log(`${recs.length} chants d'entraînement, 7 variantes, bruit neuf`);
}

if (require.main === module && process.argv[2]) main(process.argv[2]);
