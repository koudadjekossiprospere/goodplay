'use strict';
/* Silence : personne ne chante, le moteur ne doit rien inventer. Bruit de salle seul, queue de réverbération après une phrase, bruit de pièce simulé.
   node tests/banc/silence.js imprime, par scène, ce qui naît après la fin du chant. test-moteur.js en fait un assert.
   Limite : pièce simulée (bruit 1/f, secteur, ventilateur, chocs, frottements, gain automatique qui respire). Pas de parole lointaine ni de radio : ce sont de vraies voix. */
const { synth, chantCorpus, lireCorpus, alea, gauss } = require('./synth.js');
require('../../js/theorie.js'); require('../../js/moteur.js');
const GP = globalThis.GP, SR = 16000, pas = 320;

function bruit(L, rms, graine) {
  const r = alea(graine), b = new Float64Array(L); let b0 = 0, b1 = 0, e = 0;
  for (let i = 0; i < L; i++) { const w = gauss(r); b0 = .997 * b0 + .03 * w; b1 = .9 * b1 + .1 * w; b[i] = b0 + .5 * b1 + .05 * w; e += b[i] * b[i]; }
  const g = rms / Math.sqrt(e / L); for (let i = 0; i < L; i++) b[i] *= g;
  return b;
}
/* Pièce habitée : ventilateur (bruit filtré et raie), secteur à 50 Hz et harmoniques, chocs graves, frottements, gain automatique qui remonte le bruit. */
function piece(L, rms, graine, buzz = 0) {
  const r = alea(graine + 1), y = bruit(L, rms, graine); let lp = 0;
  for (let i = 0; i < L; i++) {
    const t = i / SR; lp += .08 * (gauss(r) * rms - lp);
    y[i] += lp * 1.5 + rms * (.25 * Math.sin(2 * Math.PI * 100 * t) + .12 * Math.sin(2 * Math.PI * 150 * t + 1) + .15 * Math.sin(2 * Math.PI * 187 * t));
    if (buzz) for (let k = 1; k <= 8; k++) y[i] += rms * buzz * Math.sin(2 * Math.PI * 100 * k * t + k) / k;
    y[i] *= 1 + .5 * Math.sin(2 * Math.PI * t / 23);
  }
  for (let t = 1 + r() * 3; t < L / SR; t += 2 + r() * 6) {
    const f = 60 + r() * 120, d = .06 + r() * .25, a = rms * (2 + r() * 6), frotte = r() < .4, i0 = Math.floor(t * SR), n = Math.min(L - i0, Math.floor(d * SR));
    for (let j = 0; j < n; j++) { const u = j / SR, env = Math.exp(-u / (d / 3)); y[i0 + j] += a * env * (frotte ? gauss(r) * .6 : Math.sin(2 * Math.PI * f * u)); }
  }
  return y;
}

const PHRASE = () => { const c = chantCorpus(lireCorpus()[0], { couplets: 1, transpose: 0 }); return c.notes.filter(n => n.start + n.dur < 24); };
const melange = (a, b) => { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = a[i] + b[i]; return y; };
const avecPhrase = (o, sil) => { const n = PHRASE(), fin = n[n.length - 1].start + n[n.length - 1].dur; return { x: synth(n, { sr: SR, duree: fin + sil, graine: 3, ...o }).x, fin }; };

const SCENES = {
  'salle seule, RMS .0005': () => ({ x: Float32Array.from(bruit(60 * SR, .0005, 11)), fin: 0 }),
  'salle seule, RMS .003': () => ({ x: Float32Array.from(bruit(60 * SR, .003, 12)), fin: 0 }),
  'salle seule, RMS .02': () => ({ x: Float32Array.from(bruit(60 * SR, .02, 13)), fin: 0 }),
  'pièce habitée, RMS .002': () => ({ x: Float32Array.from(piece(60 * SR, .002, 14)), fin: 0 }),
  'pièce habitée, RMS .01': () => ({ x: Float32Array.from(piece(60 * SR, .01, 15)), fin: 0 }),
  'bourdon secteur riche, RMS .005': () => ({ x: Float32Array.from(piece(60 * SR, .005, 17, 1.5)), fin: 0 }),
  'phrase, salle, puis 60 s': () => avecPhrase({ rms: .03, bruit: { snr: 20 }, reverb: { rt60: 1.2, drr: -3 } }, 60),
  'phrase, église, puis 60 s': () => avecPhrase({ rms: .02, bruit: { snr: 12 }, reverb: { rt60: 1.8, drr: -6 } }, 60),
  'phrase, voix faible, puis 60 s': () => avecPhrase({ rms: .002, bruit: { snr: 25 }, reverb: { rt60: 1.2, drr: -3 } }, 60),
  'phrase, pièce habitée, puis 60 s': () => { const { x, fin } = avecPhrase({ rms: .02, reverb: { rt60: .6, drr: 0 } }, 60); return { x: melange(x, piece(x.length, .0015, 16)), fin }; },
  'phrase, bourdon, puis 60 s': () => { const { x, fin } = avecPhrase({ rms: .03, reverb: { rt60: .6, drr: 0 } }, 60); return { x: melange(x, piece(x.length, .003, 18, 1.5)), fin }; }
};

/* Ce qui naît après `fin` : notes commencées, accords annoncés, cases créées, phrase incluse jusqu'à la fin de la dernière note. */
function ecoute(sc, params = {}) {
  const { x, fin } = sc, m = new GP.Moteur({ sr: SR, reglages: { params } }); let notes = 0, accords = 0, trames = 0, avant = 0; const apres = fin + .05; let t = 0;
  m.on('note', e => { if (e.debut >= apres) notes++; else avant++; }).on('accord', () => { if (t >= apres) accords++; }).on('niveau', e => { if (e.signal && t >= apres) trames++; });
  for (let i = 0; i < x.length; i += pas) { const f = x.subarray(i, Math.min(x.length, i + pas)); t = (i + f.length) / SR; m.trame(f, t); }
  return { notes, accords, cases: m.grille.filter(c => c.t >= apres).length, trames, notesChant: avant, ton: m.key ? 1 : 0, raies: m.rf.lignes.length };
}
module.exports = { SCENES, ecoute };
if (require.main === module) for (const n in SCENES) { const r = ecoute(SCENES[n](), JSON.parse(process.argv[2] || '{}')); console.log(n.padEnd(36), `notes ${r.notes}, accords ${r.accords}, cases ${r.cases}, trames ouvertes ${r.trames}, notes du chant ${r.notesChant}, raies ${r.raies}`); }
