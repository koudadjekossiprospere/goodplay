'use strict';
/* Passe un enregistrement réel dans le vrai GP.Moteur et imprime ce qui s'y voit. Saute si le PCM manque : il ne vit pas dans le projet.
   node tests/decode-pcm.js audio/amazing-grace-1937.ogg <pcm.f32>
   node tests/vraies-voix.js <pcm.f32> [--sr 48000] [--params '{"silence":.12}'] [--notes]
   GOODPLAY_PCM remplace le premier argument. Le moteur tourne tel quel, --params pour un essai. */
const fs = require('fs');
require('../js/theorie.js'); require('../js/moteur.js');
const GP = globalThis.GP;

/* Référence d'écoute pour amazing-grace-1937 : établie depuis le spectrogramme et la mélodie détectée, pas par une oreille humaine. Voir docs/recherche/audio.md.
   Certain : 4 couplets de 40 s (reprise du meneur seul à 0, 40, 80, 120 s, enveloppe), chant non accompagné, dernière note tenue vers 156 à 159 s.
   Probable : tonique Do♯ qui monte vers Ré, soit +90 cents environ en 160 s, majeur pentatonique (do ré mi sol la). Le moteur suit la dérive sans changer le nom, il doit donc dire Do♯ majeur tout du long.
   Moins sûr : 4 phrases par couplet, soit 16 (vient de l'hymne, le choeur ne respire pas ensemble). */
const VERITE = { fichier: 'amazing-grace-1937', tonic: 1, mode: 'maj', couplets: 4, phrases: 16, penta: [0, 2, 4, 7, 9], debutsCouplet: [0, 40, 80, 120] };
const verite = ({ m, ev }) => {
  const de = e => e.fin - e.debut, z = ev.note.reduce((a, e) => a + de(e), 0), dans = ev.note.filter(e => VERITE.penta.includes(GP.mod(e.pc - VERITE.tonic))).reduce((a, e) => a + de(e), 0);
  const ks = ev.tonalite, fin = m.tNow; let juste = 0; ks.forEach((k, i) => { const j = i + 1 < ks.length ? ks[i + 1].t : fin; if (k.tonic === VERITE.tonic && k.mode === VERITE.mode) juste += j - k.t; });
  return { gamme: z ? 100 * dans / z : 0, ton: 100 * juste / fin };
};

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

function ecouter(x, sr, params = {}) {
  const m = new GP.Moteur({ sr, reglages: { params } }), ev = { note: [], tonalite: [], phrase: [], accord: 0, refaite: 0, nouveauChant: 0 };
  m.on('note', e => ev.note.push(e)).on('tonalite', e => ev.tonalite.push({ ...e, delaiPreuve: e.correction ? m.delaiCorrection : null })).on('phrase', e => ev.phrase.push(e)).on('accord', () => ev.accord++).on('grilleRefaite', () => ev.refaite++).on('nouveauChant', () => ev.nouveauChant++);
  const pas = Math.round(sr * .02);
  for (let i = 0; i < x.length; i += pas) { const f = x.subarray(i, Math.min(x.length, i + pas)); m.trame(f, (i + f.length) / sr); }
  return { m, ev, duree: x.length / sr };
}

/* Un saut d'octave : deux notes qui se suivent sans vraie pause, à 12 demi-tons près d'un. Rare en mélodie, courant en erreur de détecteur. */
function bilan({ m, ev, duree }) {
  const n = ev.note, min = duree / 60, durs = n.map(e => e.fin - e.debut); let oct = 0;
  for (let i = 1; i < n.length; i++) { const d = Math.abs(n[i].midi - n[i - 1].midi); if (d >= 11 && d <= 13 && n[i].debut - n[i - 1].fin < .3) oct++; }
  const ks = []; for (const k of ev.tonalite) { const nom = GP.nomNote(k.tonic, k) + (k.mode === 'maj' ? ' maj' : ' min'); if (!ks.length || ks[ks.length - 1].nom !== nom) ks.push({ nom, t: k.t, mod: k.modulation, corr: k.correction, preuve: k.delaiPreuve }); }
  return { premier: ks.length ? ks[0].t : null, tons: ks, notes: n.length, phrases: ev.phrase.length, lettres: ev.phrase.filter(p => p.lettre).length, phrasesMin: ev.phrase.length / min, durMed: med(durs), brefs: 100 * durs.filter(d => d < .15).length / Math.max(1, n.length), octMin: oct / min, cases: m.grille.length, accMin: ev.accord / min, refMin: ev.refaite / min, nouveauxChants: ev.nouveauChant };
}
const imprime = (nom, b) => console.log(`${nom}
  première tonalité   ${b.premier == null ? 'aucune' : b.premier.toFixed(1) + ' s'}
  tonalités           ${b.tons.map(k => `${k.nom} (${k.t.toFixed(1)} s${k.mod ? ', modulation' : k.corr ? `, correction ${k.preuve.toFixed(1)} s après la preuve` : ''})`).join(' > ') || 'aucune'}
  phrases             ${b.phrases}, soit ${b.phrasesMin.toFixed(1)} par minute, dont ${b.lettres} avec lettre
  notes               ${b.notes}, médiane ${(b.durMed * 1000).toFixed(0)} ms, ${b.brefs.toFixed(1)} % sous 150 ms
  sauts d'octave      ${b.octMin.toFixed(1)} par minute
  cases               ${b.cases}
  changements d'accord ${b.accMin.toFixed(1)} par minute, grille réécrite ${b.refMin.toFixed(1)} fois par minute
  nouveaux chants     ${b.nouveauxChants}`);

module.exports = { ecouter, bilan, verite, VERITE };
if (require.main === module) {
  const A = process.argv.slice(2), opt = n => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : null; };
  const fic = process.env.GOODPLAY_PCM || (A[0] && !A[0].startsWith('--') ? A[0] : null);
  if (!fic || !fs.existsSync(fic)) { console.log(`vraies-voix : sauté, PCM absent (${fic || 'aucun chemin donné'}). Le produire avec tests/decode-pcm.js.`); process.exit(0); }
  const b = fs.readFileSync(fic), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), sr = +(opt('--sr') || 48000), params = JSON.parse(opt('--params') || '{}');
  console.log(`${fic} : ${(x.length / sr).toFixed(1)} s`);
  const r = ecouter(x, sr, params), v = verite(r);
  imprime('moteur', bilan(r));
  console.log(`  référence ${VERITE.fichier} : Do♯ majeur ${v.ton.toFixed(0)} % du temps, ${v.gamme.toFixed(0)} % du temps de note dans la gamme de Do♯, ${VERITE.phrases} phrases attendues (peu sûr)`);
  if (A.includes('--notes')) for (const e of r.ev.note) console.log([e.debut.toFixed(2), e.fin.toFixed(2), e.midi, GP.nomNote(e.pc), e.fin_de_phrase ? 'F' : ''].join(' '));
}
