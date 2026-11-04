'use strict';
/* Concert rendu en audio pour la Raison apprise : chaque chant chanté (une voix ou un chœur) avec son piano, dans une salle, avec du bruit,
   puis écouté par la vraie oreille du moteur ; on garde les notes que le moteur passe à la Raison. C'est ce qu'elle entend en concert :
   la mélodie à moitié couverte, des notes du piano, des octaves fausses (tests/mesure.js, scènes piano : la moitié du temps de mélodie entendu,
   25 à 44 % de notes d'une autre classe, la moitié des justes à l'octave). La variante « concert » de ton-jeux.js ne simule que la basse.
   Scène tirée au hasard par chant et par rendu : piano de -9 à +12 dB, chœur ou voix seule, salle, bruit, tempo, transposition, accords tenus ou rejoués.
   node tests/donnees/ton-concert-audio.js <dossier donnees> <entrainement|validation|test|frais> [rendus par chant, 1] [w W]   écrit jeu/ton/concert-audio/<partie>-<w>.jsonl
   node tests/donnees/ton-concert-audio.js <dossier donnees> reunir   écrit jeu/ton/{validation,test}-concert-audio.jsonl et jeu/ton/reseau/{,frais-}concert-audio.jsonl */
const fs = require('fs'), path = require('path');
const { ecouter } = require('../vraies-voix.js');
const { rendre } = require('./concert.js');
const { hasard } = require('./ton-jeux.js');
const mod12 = x => ((x % 12) + 12) % 12;
const SR = +(process.env.GOODPLAY_SR || 16000); // le moteur ramène tout à 16 kHz : rendre à 16 kHz va trois fois plus vite

/* Scène d'un rendu. Voix de femme ou d'homme : la mélodie ramenée autour de 66 ou de 55. */
function scene(rec, r) {
  const ns = rec.notes.filter(n => n[0] !== null), moy = ns.reduce((a, n) => a + n[0], 0) / ns.length;
  const tr0 = Math.floor(r() * 12) - 5, cible = r() < .5 ? 66 : 55, transpose = tr0 + 12 * Math.round((cible - moy - tr0) / 12);
  return {
    sr: SR, transpose, facteur: .8 + .45 * r(), pianoDb: -9 + 21 * r(), registre: r() < .3 ? 55 : 60, refrappe: r() < .5,
    choeur: r() < .4 ? { n: 3 + Math.floor(3 * r()), detune: 8 + 8 * r() } : undefined,
    reverb: { rt60: .3 + 1.7 * r(), drr: -8 + 8 * r() }, bruit: { snr: 8 + 27 * r() }
  };
}

// frais : contrôle du sur-apprentissage (tests/donnees/ton_perte.py), un chant d'entraînement sur sept rendu une fois de plus, scène jamais vue (k = 2)
function main(dossier, partie, K = 1, w = 0, W = 1) {
  const J = path.join(dossier, 'jeu'), dst = path.join(J, 'ton', 'concert-audio'), frais = partie === 'frais';
  fs.mkdirSync(dst, { recursive: true });
  const recs = fs.readFileSync(path.join(J, (frais ? 'entrainement' : partie) + '.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const f = fs.openSync(path.join(dst, `${partie}-${w}.jsonl`), 'w'), t0 = Date.now(); let n = 0;
  recs.forEach((rec, i) => {
    if (i % W !== w || (frais && i % 7 !== 3)) return;
    for (let k = frais ? 2 : 0; k < (frais ? 3 : K); k++) {
      const sc = scene(rec, hasard(104729 * (i + 1) + 7919 * k + partie.length)), recus = [];
      const { a, t0: debut } = rendre(rec, 1 + i * 13 + k, sc);
      // Le moteur remet la Raison à zéro et lui rejoue ses notes quand il découvre un ronflement (_oublieBande) : on garde ce que la Raison a vraiment reçu.
      ecouter(a.x, a.sr, { raison: 'apprise' }, m => { const o = m.R.note.bind(m.R), z = m.R.reinit.bind(m.R); m.R.note = e => { recus.push([+e.midi.toFixed(2), +e.debut.toFixed(3), +e.fin.toFixed(3)]); return o(e); }; m.R.reinit = () => { recus.length = 0; return z(); }; });
      fs.writeSync(f, JSON.stringify({ i, k, id: rec.id, famille: rec.famille, style: rec.style, origine: rec.origine, alertes: rec.alertes, debut: debut, notes: recus, verite: [[debut, mod12(rec.ton.tonique + sc.transpose), rec.ton.mode]], scene: { ...sc, pianoDb: +sc.pianoDb.toFixed(1) } }) + '\n'); n++;
    }
    if (n % 50 === 0) console.log(`${partie} ${w}/${W} : ${n} rendus, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  });
  fs.closeSync(f);
  console.log(`${partie} ${w}/${W} : ${n} rendus en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

/* Réunit les morceaux des processus, dans l'ordre des chants. Un rendu sans note entendue ne sert à rien : il est écarté. */
function reunir(dossier) {
  const src = path.join(dossier, 'jeu', 'ton', 'concert-audio');
  const cibles = { validation: path.join(dossier, 'jeu', 'ton', 'validation-concert-audio.jsonl'), test: path.join(dossier, 'jeu', 'ton', 'test-concert-audio.jsonl'), entrainement: path.join(dossier, 'jeu', 'ton', 'reseau', 'concert-audio.jsonl'), frais: path.join(dossier, 'jeu', 'ton', 'reseau', 'frais-concert-audio.jsonl') };
  for (const [partie, cible] of Object.entries(cibles)) {
    const fic = fs.readdirSync(src).filter(f => f.startsWith(partie + '-') && f.endsWith('.jsonl'));
    if (!fic.length) continue;
    const l = fic.flatMap(f => fs.readFileSync(path.join(src, f), 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x))).filter(x => x.notes.length >= 2).sort((a, b) => a.i - b.i || a.k - b.k);
    fs.writeFileSync(cible, l.map(x => JSON.stringify(x)).join('\n') + '\n');
    console.log(`${partie} : ${l.length} rendus -> ${cible}`);
  }
}

{ // la scène garde la mélodie dans une tessiture chantée et la vérité suit la transposition
  const rec = { notes: [[40, 0, 1], [44, 1, 1]], ton: { tonique: 4, mode: 'maj' } };
  for (let g = 1; g < 30; g++) { const s = scene(rec, hasard(g)); const m = 42 + s.transpose; if (m < 48 || m > 73) throw new Error('tessiture ' + m); }
}

if (require.main === module && process.argv[3]) {
  const a = process.argv.slice(2);
  if (a[1] === 'reunir') reunir(a[0]);
  else main(a[0], a[1], +(a[2] || 1), +(a[3] || 0), +(a[4] || 1));
}
module.exports = { scene };
