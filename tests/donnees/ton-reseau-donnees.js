'use strict';
/* Données du réseau de tonalité (tests/donnees/ton_reseau.py) : suites de notes d'entraînement, tirées à neuf pour chaque lot (graines différentes),
   afin que le réseau n'apprenne pas un bruit particulier par cœur.
   node tests/donnees/ton-reseau-donnees.js <dossier donnees> [nombre de lots, 3 par défaut] [k : ce lot seulement]   écrit jeu/ton/reseau/lot-<k>.jsonl
   Par chant d'entraînement et par lot : notes parfaites, oreille simulée (deux tirages), parole d'entraînement avant le chant, le lead qui monte
   (demi-ton, ton, quarte ou quinte), et concert simulé (la basse du piano mêlée à la voix). Tempo tiré entre 0,8 et 1,25 fois le tempo écrit.
   La validation et le test restent les jeux figés de jeu/ton : jamais régénérés, jamais vus à l'entraînement. */
const fs = require('fs'), path = require('path');
const { variante, hasard, longue } = require('./ton-jeux.js');
const PART_REDECOUPE = .4; // part des suites repassées dans le découpage du moteur (robustesse au découpage des notes)
const PART_LONGUE = 1 / 3; // part des annonces longues (segments mis bout à bout)
const { tierceContredite } = require('./eval-tonalite.js');
const POIDS_DOUTEUX = 1 / 3; // étiquette douteuse (finale modale, mode écrit contredit par la finale, tierce contredite par la mélodie) : apprise, mais trois fois moins

function main(dossier, lots = 3, seul = null) {
  const J = path.join(dossier, 'jeu'), dst = path.join(J, 'ton', 'reseau');
  fs.mkdirSync(dst, { recursive: true });
  const recs = fs.readFileSync(path.join(J, 'entrainement.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const paroles = JSON.parse(fs.readFileSync(path.join(J, 'ton', 'paroles.json'), 'utf8')).entrainement;
  const sortes = ['parfait', 'oreille', 'oreille', 'parole', 'parole', 'modulation', 'concert', 'concert', 'couplets'];
  // Concert rendu en audio et écouté par la vraie oreille (tests/donnees/ton-concert-audio.js) : figé, un rendu par chant et par lot, tour à tour.
  const fA = path.join(dst, 'concert-audio.jsonl'), audio = new Map();
  if (fs.existsSync(fA)) for (const l of fs.readFileSync(fA, 'utf8').trim().split('\n')) { const x = JSON.parse(l); if (!audio.has(x.i)) audio.set(x.i, []); audio.get(x.i).push(x); }
  for (let k = 0; k < lots; k++) {
    if (seul !== null && k !== seul) continue; // un lot par processus, en parallèle
    const f = fs.openSync(path.join(dst, `lot-${k}.jsonl`), 'w'); let n = 0;
    recs.forEach((rec, i) => {
      const douteux = rec.alertes.some(a => /finale modale|mode écrit contredit/.test(a))
        || tierceContredite({ debut: 0, verite: [[0, rec.ton.tonique, rec.ton.mode]], notes: rec.notes.map(([m, a, d]) => [m, a, a + d]) });
      sortes.forEach((sorte, j) => {
        const r = hasard(1000003 * (k + 1) + 7919 * i + j), graine = Math.floor(r() * 2 ** 31), facteur = .8 + .45 * r();
        const demi = [1, 2, 1, 2, 5, 7, -2][Math.floor(r() * 7)], parole2 = paroles[Math.floor(r() * paroles.length)];
        // une annonce sur trois dure de 30 s à 2 min 30 : la Raison doit tenir « rien n'est sûr » pendant toute une prédication
        const parole = r() < PART_LONGUE ? longue(paroles, r, 30 + 120 * r()) : paroles[Math.floor(r() * paroles.length)];
        const v = variante(rec, sorte, { graine, facteur, demi, parole, parole2, redecoupe: r() < PART_REDECOUPE });
        fs.writeSync(f, JSON.stringify({ poids: douteux ? POIDS_DOUTEUX : 1, debut: +v.debut.toFixed(3), notes: v.notes.map(x => [x.midi, +x.debut.toFixed(3), +x.fin.toFixed(3)]), verite: v.verite.map(([t, a, m]) => [+t.toFixed(3), a, m]) }) + '\n'); n++;
      });
      const rendus = audio.get(i);
      if (rendus) { const x = rendus[k % rendus.length]; fs.writeSync(f, JSON.stringify({ poids: douteux ? POIDS_DOUTEUX : 1, debut: x.debut, notes: x.notes, verite: x.verite }) + '\n'); n++; }
    });
    fs.closeSync(f);
    console.log(`lot ${k} : ${n} suites (${sortes.join(', ')}${audio.size ? ', concert audio' : ''})`);
  }
}

if (require.main === module && process.argv[2]) main(process.argv[2], +(process.argv[3] || 3), process.argv[4] != null ? +process.argv[4] : null);
