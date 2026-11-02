'use strict';
/* Mesure 1 : détection de hauteur. Usage : node tests/banc/mesure-hauteur.js
   A. Porte RMS actuelle selon le niveau.  B. Détecteurs selon la scène.  C. Justesse en cents.  D. Temps par trame. */
const { synth, chantCorpus, ornemente, lireCorpus, pianoDe, mod12 } = require('./synth.js');
const { yinActuel, yinP, mpm, creeDecimateur } = require('./hauteur.js');

const SR = 48000, N = 2048, PAS = Math.round(.04 * SR);
const dec3 = creeDecimateur(3);
const midiDe = f => 69 + 12 * Math.log2(f / 440);
const pct = (a, b) => b ? (100 * a / b).toFixed(1) : '-';

/* Cinq chants du corpus, un couplet : registres de femme et d'homme, avec et sans vocalises. */
const corpus = lireCorpus();
const ecrits = [
  chantCorpus(corpus[3], { couplets: 1 }),
  ornemente(chantCorpus(corpus[0], { couplets: 1 }), { graine: 6 }),
  chantCorpus(corpus[9], { couplets: 1, transpose: 2 }),
  chantCorpus(corpus[6], { couplets: 1, transpose: -12 }),
  ornemente(chantCorpus(corpus[4], { couplets: 1, transpose: -12 }), { graine: 9 })
];

function trames(x, cb) { for (let i = 0; i + N <= x.length; i += PAS) cb(x.subarray(i, i + N), (i + N) / SR); }

/* Note attendue à l'instant où la fenêtre YIN est centrée. Marges de 40 ms autour des transitions. */
function verite(notes, t) { for (const n of notes) if (t >= n.start + .05 && t <= n.start + n.dur - .03) return n; return null; }
const silence = (notes, t) => !notes.some(n => t >= n.start - .1 && t <= n.start + n.dur + .25);

function nouveauCompte() { return { v: 0, det: 0, juste: 0, octave: 0, autre: 0, s: 0, faux: 0 }; }
function compte(c, n, p, sil) {
  if (n) { c.v++; if (p) { c.det++; const m = Math.round(midiDe(p.f)), d = m - n.midi; if (d === 0) c.juste++; else if (mod12(d) === 0 || d === 19 || d === -19) c.octave++; else c.autre++; } }
  else if (sil) { c.s++; if (p) c.faux++; }
}
const ligne = c => `voisé ${pct(c.det, c.v).padStart(5)} %  juste ${pct(c.juste, c.v).padStart(5)} %  octave ${pct(c.octave, c.v).padStart(5)} %  autre ${pct(c.autre, c.v).padStart(5)} %  faux dans silence ${pct(c.faux, c.s).padStart(5)} %`;

const ALGOS = {
  'YIN actuel 48 kHz, seuil .15': (w) => { const p = yinActuel(w, SR); return p && p.conf > .8 && p.f > 70 && p.f < 1100 ? p : null; },
  'YIN 16 kHz, seuil .15       ': (w, w16) => { const p = yinP(w16, 16000, { W: 450, seuil: .15, repli: false }); return p && p.f > 70 && p.f < 1100 ? p : null; },
  'YIN 16 kHz, seuil .30       ': (w, w16) => { const p = yinP(w16, 16000, { W: 450, seuil: .30, repli: false }); return p && p.f > 70 && p.f < 1100 ? p : null; },
  'MPM 16 kHz, k .9, clarté .6 ': (w, w16) => { const p = mpm(w16, 16000, { k: .9 }); return p && p.conf > .6 && p.f > 70 && p.f < 1100 ? p : null; },
  'MPM 16 kHz, k .9, clarté .7 ': (w, w16) => { const p = mpm(w16, 16000, { k: .9 }); return p && p.conf > .7 && p.f > 70 && p.f < 1100 ? p : null; },
  'YIN 16 kHz, .15, repli < .4 ': (w, w16) => { const p = yinP(w16, 16000, { W: 450, seuil: .15 }); return p && p.conf > .6 && p.f > 70 && p.f < 1100 ? p : null; },
  'MPM 16 kHz, k .9, clarté .8 ': (w, w16) => { const p = mpm(w16, 16000, { k: .9 }); return p && p.conf > .8 && p.f > 70 && p.f < 1100 ? p : null; },
  'MPM 48 kHz, k .9, clarté .8 ': (w) => { const p = mpm(w, SR, { k: .9 }); return p && p.conf > .8 && p.f > 70 && p.f < 1100 ? p : null; }
};

const piano = c => ({ accords: pianoDe(c) });
const SCENES = {
  'studio, 40 dB, sans réverbération': { bruit: { snr: 40 } },
  'salle, bruit 20 dB, RT60 1 s, direct = réverbéré': { bruit: { snr: 20 }, reverb: { rt60: 1, drr: 0 } },
  'église à 3 m, bruit 12 dB, RT60 1.8 s, réverbéré +6 dB': { bruit: { snr: 12 }, reverb: { rt60: 1.8, drr: -6 } },
  'choeur 5 voix unisson, écart 12 c': { bruit: { snr: 30 }, choeur: { n: 5, detune: 12 } },
  'choeur 5 voix en salle': { bruit: { snr: 20 }, reverb: { rt60: 1.2, drr: -3 }, choeur: { n: 5, detune: 12 } },
  'deux parties en tierces': { bruit: { snr: 30 }, tierce: true, choeur: { n: 3, detune: 10 } },
  'piano au même niveau que la voix': c => ({ bruit: { snr: 30 }, piano: { ...piano(c), db: 0 } }),
  'piano 6 dB au dessus de la voix': c => ({ bruit: { snr: 30 }, piano: { ...piano(c), db: 6 } }),
  'piano 12 dB au dessus de la voix': c => ({ bruit: { snr: 30 }, piano: { ...piano(c), db: 12 } }),
  'piano +6 dB en salle': c => ({ bruit: { snr: 20 }, reverb: { rt60: 1.2, drr: -3 }, piano: { ...piano(c), db: 6 } })
};

function scenesAlgos() {
  console.log('\n== B. Détecteurs par scène (trames voisées hors transitions, porte RMS retirée) ==');
  for (const [nom, sc] of Object.entries(SCENES)) {
    const cs = {}; for (const a in ALGOS) cs[a] = nouveauCompte();
    ecrits.forEach((c, i) => {
      const o = typeof sc === 'function' ? sc(c) : sc;
      const { x } = synth(c.notes, { sr: SR, rms: .03, graine: 100 + i, ...o });
      const x16 = dec3(x); let k = 0;
      trames(x, (w, tFin) => {
        const n = verite(c.notes, tFin - .025), sil = silence(c.notes, tFin - .025);
        if (!n && !sil) return;
        const i16 = Math.floor((tFin - N / SR) * 16000), w16 = x16.subarray(Math.max(0, i16), i16 + 683);
        if (w16.length < 683) return;
        for (const a in ALGOS) compte(cs[a], n, ALGOS[a](w, w16), sil);
      });
    });
    console.log('\n' + nom);
    for (const a in ALGOS) console.log('  ' + a + '  ' + ligne(cs[a]));
  }
}

function porteRMS() {
  console.log('\n== A. Porte RMS actuelle : seuil = 0.004 + (1 - sens) * 0.03, RMS calculé sur 2048 échantillons ==');
  console.log('(bruit 20 dB sous la voix ; sens 0.55 par défaut donne un seuil de ' + (0.004 + .45 * .03).toFixed(4) + ')');
  const NIVEAUX = [.002, .003, .005, .0075, .01, .015, .02, .03, .05], SENS = [0, .55, .8, 1];
  const c = ecrits[0], base = synth(c.notes, { sr: SR, rms: 1, graine: 42, bruit: { snr: 20 } }).x;
  const dets = []; trames(base, (w, t) => { const n = verite(c.notes, t - .025); if (!n) return; let e = 0; for (let i = 0; i < N; i++) e += w[i] * w[i]; const p = yinActuel(w, SR); const ok = p && p.conf > .8 && p.f > 70 && p.f < 1100 && Math.round(midiDe(p.f)) === n.midi; dets.push({ r: Math.sqrt(e / N), ok, p: !!(p && p.conf > .8) }); });
  console.log('RMS voix | ' + SENS.map(s => ('sens ' + s + ' (seuil ' + (0.004 + (1 - s) * .03).toFixed(4) + ')').padEnd(26)).join('| ') + '  pourcentage de trames voisées qui passent la porte et sont détectées');
  NIVEAUX.forEach(L => {
    const cols = SENS.map(s => { const thr = .004 + (1 - s) * .03; let ou = 0, de = 0; dets.forEach(d => { if (d.r * L > thr) { ou++; if (d.p) de++; } }); return (pct(ou, dets.length).padStart(5) + ' % ouvert, ' + pct(de, dets.length).padStart(5) + ' % détecté').padEnd(26); });
    console.log(String(L).padEnd(8) + ' | ' + cols.join('| '));
  });
}

/* Porte adaptative du prototype : plancher qui descend vite et remonte de 5 % par seconde, porte à 1.6 fois le plancher, jamais sous 1.5e-4. */
function porteAdaptative() {
  console.log('\n== A2. Porte adaptative : trames voisées qui passent, et trames de silence qui passent, MPM clarté .7 derrière ==');
  [[.002, 20], [.002, 10], [.005, 20], [.005, 10], [.01, 20], [.03, 20]].forEach(([niv, snr]) => {
    let vo = 0, vp = 0, vd = 0, so = 0, sp = 0, sd = 0;
    ecrits.forEach((c, i) => {
      const { x } = synth(c.notes, { sr: SR, rms: niv, graine: 500 + i, bruit: { snr }, reverb: { rt60: 1.2, drr: -3 } }), x16 = dec3(x); let pl = null;
      for (let j = 0; j + 683 < x16.length; j += 320) {
        const w = x16.subarray(j, j + 683), t = (j + 683) / 16000 - .02; let e = 0; for (let k = 0; k < 683; k++) e += w[k] * w[k]; const r = Math.sqrt(e / 683);
        pl = pl == null ? r : r < pl ? pl + (r - pl) * .2 : pl * (1 + .05 * .02);
        const porte = Math.max(1.5e-4, pl * 1.6), ouvert = r > porte, n = verite(c.notes, t), sil = silence(c.notes, t);
        if (!n && !sil) continue; const p = ouvert ? mpm(w, 16000, { k: .9 }) : null, det = p && p.conf > .7 && p.f > 70 && p.f < 1100;
        if (n) { vo++; if (ouvert) vp++; if (det && Math.round(midiDe(p.f)) === n.midi) vd++; } else { so++; if (ouvert) sp++; if (det) sd++; }
      }
    });
    console.log(`  RMS ${String(niv).padEnd(6)} bruit -${snr} dB : voisées ouvertes ${pct(vp, vo).padStart(5)} %, note juste ${pct(vd, vo).padStart(5)} % ; silence ouvert ${pct(sp, so).padStart(5)} %, fausse note dans le silence ${pct(sd, so).padStart(5)} %`);
  });
}

function justesse() {
  console.log('\n== C. Justesse en cents sur note tenue sans vibrato, médiane de l\'erreur absolue ==');
  const ops = { sr: SR, rms: .03, vibrato: { cents: 0 }, instable: 0, souffle: 0, glisse: 0, bruit: { snr: 40 } };
  const registres = [45, 52, 57, 64, 69, 76, 81];
  const algos = { 'YIN actuel 48 kHz': (w) => yinActuel(w, SR), 'YIN 16 kHz': (w, w16) => yinP(w16, 16000, { W: 450, seuil: .15, repli: false }), 'MPM 16 kHz': (w, w16) => mpm(w16, 16000, { k: .9 }) };
  for (const a in algos) {
    const res = [];
    for (const m of registres) {
      const { x } = synth([{ midi: m, start: .1, dur: 2, voy: 0 }], ops), x16 = dec3(x), e = [];
      for (let i = SR * .4; i + N <= SR * 1.9; i += 4800) { const w = x.subarray(i, i + N), i16 = Math.floor(i / 3), w16 = x16.subarray(i16, i16 + 683), p = algos[a](w, w16); if (p) e.push(Math.abs(100 * (midiDe(p.f) - m))); }
      e.sort((u, v) => u - v); res.push(m + ':' + (e.length ? e[e.length >> 1].toFixed(2) : 'n/a'));
    }
    console.log('  ' + a.padEnd(20) + res.join('  '));
  }
}

function chrono() {
  console.log('\n== D. Temps de calcul par trame sur ce PC (pas un téléphone), 2000 trames ==');
  const { x } = synth(ecrits[0].notes, { sr: SR, rms: .03, bruit: { snr: 30 } }), x16 = dec3(x);
  const b = (nom, fn) => { const t0 = process.hrtime.bigint(); let nb = 0, i = 0; while (nb < 2000) { fn(i); nb++; i = (i + 800) % (x.length - N - 800); } const ms = Number(process.hrtime.bigint() - t0) / 1e6; console.log('  ' + nom.padEnd(44) + (ms / nb).toFixed(3) + ' ms par trame'); };
  b('échauffement', i => yinActuel(x.subarray(i, i + N), SR));
  b('YIN actuel 48 kHz (W 1024, lag 685)', i => yinActuel(x.subarray(i, i + N), SR));
  b('YIN 16 kHz (W 450, lag 228)', i => { const j = Math.floor(i / 3); yinP(x16.subarray(j, j + 683), 16000, { W: 450, repli: false }); });
  b('MPM 16 kHz (N 683, lag 228)', i => { const j = Math.floor(i / 3); mpm(x16.subarray(j, j + 683), 16000); });
  b('MPM 48 kHz (N 2048, lag 685)', i => mpm(x.subarray(i, i + N), SR));
  const t0 = process.hrtime.bigint(), y = dec3(x), s = x.length / SR; console.log('  ' + 'décimation par 3, par seconde de son'.padEnd(44) + (Number(process.hrtime.bigint() - t0) / 1e6 / s).toFixed(3) + ' ms');
  console.log('  (' + y.length + ' échantillons rendus)');
}

function accordage() {
  console.log('\n== E. Effet d\'un accordage décalé sur la note arrondie : YIN actuel, voix avec vibrato ±30 c ==');
  [[0, 0], [20, 0], [30, 0], [40, 0], [45, 0], [-40, 0], [40, 1]].forEach(([cents, parSec]) => {
    const c = nouveauCompte(); let bascules = 0, tot = 0;
    ecrits.forEach((e, i) => {
      const { x } = synth(e.notes, { sr: SR, rms: .03, graine: 200 + i, bruit: { snr: 30 }, accordage: { cents, parSec } });
      let prev = null, prevN = null;
      trames(x, (w, tFin) => { const n = verite(e.notes, tFin - .025); const p = yinActuel(w, SR), ok = p && p.conf > .8 ? p : null; compte(c, n, ok, false); if (n && ok) { const m = Math.round(midiDe(ok.f)); if (prevN === n && prev !== null && m !== prev) bascules++; prev = m; prevN = n; tot++; } });
    });
    console.log(`  ${String(cents).padStart(4)} c, ${parSec} c/s : note juste ${pct(c.juste, c.v).padStart(5)} %, autre note ${pct(c.autre, c.v).padStart(5)} %, ${(1000 * bascules / tot).toFixed(1).padStart(6)} bascules pour 1000 trames à l'intérieur d'une même note`);
  });
}

porteRMS();
porteAdaptative();
scenesAlgos();
justesse();
chrono();
accordage();
