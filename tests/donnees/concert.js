'use strict';
/* Concert simulé : la mélodie d'un chant du jeu chantée (un ou cinq chanteurs) avec son accompagnement de piano, dans une salle, avec du bruit.
   C'est une simulation : aucun vrai concert n'a été enregistré ici.
   node tests/donnees/concert.js <dossier donnees> composition   ce que l'oreille entend selon le niveau du piano (mélodie, basse, autre)
   node tests/donnees/concert.js <dossier donnees> tonalite [nombre de chants, 30] [w W]   tonalité de bout en bout, moteur actuel contre Raison apprise,
     sur des chants d'église du test, dans trois scènes ; résultats dans jeu/ton/concert-<w>.json (plusieurs processus en parallèle possible).
   Constat du 2 novembre 2026 (composition, 6 cantiques) : avec le piano 6 dB sous la voix, 81 % du temps entendu est la mélodie et 14 % la basse ;
   à niveau égal, 48 % et 47 % ; piano 6 dB au-dessus, chœur, réverbération : 39 % et 58 %. L'oreille suit la basse du piano dès qu'il couvre la voix :
   la variante « concert » de ton-jeux.js mêle donc mélodie et basse des accords. */
const fs = require('fs'), path = require('path');
const { synth } = require('../banc/synth.js');
const { ecouter } = require('../vraies-voix.js');
const mod12 = x => ((x % 12) + 12) % 12;
const SCENES = {
  'piano -6 dB, chœur, salle': { pianoDb: -6, choeur: { n: 5, detune: 12 }, reverb: { rt60: 1.6, drr: -6 }, bruit: { snr: 12 } },
  'piano 0 dB, salle': { pianoDb: 0, reverb: { rt60: 1.2, drr: -3 }, bruit: { snr: 12 } },
  'piano +6 dB, chœur, salle': { pianoDb: 6, choeur: { n: 5, detune: 12 }, reverb: { rt60: 1.6, drr: -6 }, bruit: { snr: 12 } }
};
const mineur = q => /^(min|m7|m6|m9|m11|m7b5|dim|dim7|mmaj7)$/.test(q);

/* sc facultatifs (tests/donnees/ton-concert-audio.js) : transpose (demi-tons), facteur (tempo), registre (Do grave des accords, 60), refrappe (accord rejoué à chaque temps), sr (48000). */
function rendre(rec, graine, sc) {
  const s = 60 / ((rec.bpm || 90) * (sc.facteur || 1)), t0 = .8, tr = sc.transpose || 0, haut = sc.registre ?? 60;
  const notes = rec.notes.filter(n => n[0] !== null).map(([midi, t, d]) => ({ midi: midi + tr, start: t0 + t * s, dur: Math.max(.08, d * s * .95) }));
  const accords = rec.accords.flatMap(([t, d, rel, q, rb]) => {
    const root = mod12(rec.ton.tonique + tr + rel), b = 36 + mod12(rb == null ? root : rec.ton.tonique + tr + rb), pcs = [0, mineur(q) ? 3 : 4, 7].map(i => mod12(root + i));
    const a = { midis: [b, b + 12, ...pcs.map(p => haut + p)], start: t0 + t * s, dur: Math.max(.1, d * s * .95), pcs, basse: mod12(b) };
    return sc.refrappe && d > 1 ? Array.from({ length: Math.ceil(d) }, (_, k) => ({ ...a, start: a.start + k * s, dur: Math.max(.1, Math.min(1, d - k) * s * .95) })) : [a];
  });
  const a = synth(notes, { sr: sc.sr, graine, choeur: sc.choeur, reverb: sc.reverb, bruit: sc.bruit, hp: 100, piano: { accords, db: sc.pianoDb } });
  return { a, notes, accords, t0 };
}

const lireTest = dossier => fs.readFileSync(path.join(dossier, 'jeu', 'test.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  .filter(r => r.style.some(s => ['cantique', 'gospel', 'noel', 'spiritual'].includes(s)) && r.notes.length < 160);

function composition(dossier) {
  const recs = fs.readFileSync(path.join(dossier, 'jeu', 'entrainement.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.style.includes('cantique') && r.notes.length < 120).slice(0, 6);
  for (const [nom, sc] of Object.entries(SCENES)) {
    const T = { melodie: 0, basse: 0, accord: 0, autre: 0 }; let tot = 0;
    for (const rec of recs) {
      const { a, notes, accords } = rendre(rec, 3, sc), e = ecouter(a.x, a.sr);
      for (const n of e.ev.note) {
        const mid = (n.debut + n.fin) / 2, d = n.fin - n.debut, pc = mod12(Math.round(n.midi)); tot += d;
        const mel = notes.find(x => mid >= x.start && mid < x.start + x.dur), ac = accords.find(x => mid >= x.start && mid < x.start + x.dur);
        if (mel && mod12(mel.midi) === pc) T.melodie += d; else if (ac && ac.basse === pc) T.basse += d; else if (ac && ac.pcs.includes(pc)) T.accord += d; else T.autre += d;
      }
    }
    console.log(nom.padEnd(28), Object.entries(T).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(0)} %`).join(', '));
  }
}

/* Tonalité de bout en bout : audio de concert, vraie oreille, puis moteur actuel et moteur avec Raison apprise (mêmes notes rejouées). */
function tonalite(dossier, n = 30, w = 0, W = 1) {
  const { mesurer } = require('./eval-tonalite.js'), { Moteur } = { Moteur: globalThis.GP.Moteur };
  const recs = lireTest(dossier), pas = Math.max(1, Math.floor(recs.length / n)), choix = recs.filter((_, i) => i % pas === 0).slice(0, n), out = [];
  choix.forEach((rec, i) => {
    if (i % W !== w) return;
    for (const [nom, sc] of Object.entries(SCENES)) {
      const { a, notes, t0 } = rendre(rec, 101 + i, sc), item = { debut: t0, notes: [[0, t0, notes[notes.length - 1].start + notes[notes.length - 1].dur]], verite: [[t0, rec.ton.tonique, rec.ton.mode]] };
      for (const raison of ['profil', 'apprise']) {
        const r = ecouter(a.x, a.sr, { raison }), aff = r.ev.tonalite.map(k => [k.t, k.tonic, k.mode, k.etat || 'probable']);
        out.push({ id: rec.id, scene: nom, raison, ...mesurer(item, aff) });
      }
    }
    console.log(`processus ${w} : ${rec.id} fait`);
  });
  fs.writeFileSync(path.join(dossier, 'jeu', 'ton', `concert-${w}.json`), JSON.stringify(out));
}

if (require.main === module && process.argv[2]) {
  if (process.argv[3] === 'composition') composition(process.argv[2]);
  else if (process.argv[3] === 'tonalite') tonalite(process.argv[2], +(process.argv[4] || 30), +(process.argv[5] || 0), +(process.argv[6] || 1));
}
module.exports = { rendre, SCENES, mineur };
