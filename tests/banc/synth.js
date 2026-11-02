'use strict';
/* Banc d'essai audio : générateur de signaux et de chants à vérité connue. Aucune dépendance.
   synth(notes, opts) rend un Float32Array. chant(spec) écrit une mélodie, ses accords et sa tonalité.
   Auto-test : node tests/banc/synth.js
   Limite : voix synthétique. Elle est plus régulière qu'une vraie voix, donc les chiffres obtenus sont optimistes. */

function alea(graine) {
  let a = (graine * 2654435761) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const mod12 = n => ((n % 12) + 12) % 12;

/* FFT radix 2 en place, pour la réverbération */
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang), m = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < m; j++) { const a = i + j, b = a + m, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function convolue(x, h) {
  let n = 1; while (n < x.length + h.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(x); br.set(h); fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] - ai[i] * bi[i]; ai[i] = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; }
  fft(ar, ai, true);
  const y = new Float32Array(x.length); for (let i = 0; i < y.length; i++) y[i] = ar[i];
  return y;
}

/* Voyelles : formants (Hz) ; la fondamentale n'est pas le partiel le plus fort, comme sur une vraie voix */
const VOY = [[800, 1200, 2800], [500, 1700, 2500], [450, 800, 2800], [300, 2300, 3000], [320, 800, 2500]];
function ampHarmo(k, f0, voy) {
  const f = k * f0; let g = 0.04;
  voy.forEach((F, i) => { const B = 90 + 40 * i, a = [1, .6, .25][i]; g += a / (1 + Math.pow((f - F) / B, 2)); });
  return g / Math.sqrt(k);
}

/* Ajoute une note de voix dans y. Phase continue, vibrato, glissando d'attaque, micro-instabilité. */
function rendVoix(y, sr, n, prev, o, r, detune, retard) {
  const att = o.attaque ?? .04, rel = .05, gl = o.glisse ?? .06;
  const t0 = n.start + retard, t1 = n.start + n.dur + retard;
  const i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(y.length, Math.floor((t1 + rel) * sr));
  const vib = o.vibrato ?? { hz: 5.5, cents: 30, delai: .18 };
  const vibPhase = r() * 6.283, voy = VOY[n.voy ?? Math.floor(r() * VOY.length)];
  const f0ref = hz(n.midi), K = Math.min(16, Math.floor(Math.min(sr / 2 - 200, 5000) / f0ref));
  const amps = new Float64Array(K + 1); for (let k = 1; k <= K; k++) amps[k] = ampHarmo(k, f0ref, voy);
  const acc = o.accordage || {}, dep = (prev != null && n.start - prev.fin < .08) ? prev.midi : n.midi - .35;
  let ph = r() * 6.283, drift = 0, sf = o.souffle ?? .006, a = n.amp ?? 1;
  for (let i = i0; i < i1; i++) {
    const t = i / sr, u = t - t0;
    if ((i & 63) === 0) drift += (gauss(r) * (o.instable ?? .35) - drift * .04);
    const scoop = u < gl ? (dep - n.midi) * (1 - u / gl) * (1 - u / gl) : 0;
    const v = vib.cents && u > vib.delai ? vib.cents * Math.sin(6.283 * vib.hz * t + vibPhase) * Math.min(1, (u - vib.delai) / .2) : 0;
    const c = (acc.cents || 0) + (acc.parSec || 0) * t + detune + v + drift;
    const f = hz(n.midi + scoop + c / 100);
    ph += 6.283185307 * f / sr;
    const env = (u < att ? u / att : 1) * (t > t1 ? Math.max(0, 1 - (t - t1) / rel) : 1);
    const s1 = Math.sin(ph), c2 = 2 * Math.cos(ph); let p2 = 0, p1 = s1, s = amps[1] * s1;
    for (let k = 2; k <= K; k++) { const q = c2 * p1 - p2; p2 = p1; p1 = q; s += amps[k] * q; }
    y[i] += a * env * (s + sf * gauss(r));
  }
}

/* Piano additif : partiels légèrement inharmoniques, décroissance plus rapide dans l'aigu */
function rendPiano(y, sr, midis, start, dur) {
  midis.forEach((m, idx) => {
    const f0 = hz(m), B = m < 48 ? 3e-4 : 1e-4, K = Math.min(12, Math.floor(sr / 2.4 / f0)), v = idx === 0 ? 1 : .7;
    const i0 = Math.floor(start * sr), n = Math.min(y.length - i0, Math.floor((dur + .15) * sr));
    for (let k = 1; k <= K; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k), a = v / Math.pow(k, .9), tau = 1.8 / (1 + .35 * k), w = 6.283185307 * fk / sr;
      for (let j = 0; j < n; j++) { const t = j / sr, ferm = t > dur ? Math.max(0, 1 - (t - dur) / .15) : 1; y[i0 + j] += a * ferm * Math.exp(-t / tau) * Math.sin(w * j); }
    }
  });
}

/* Options : sr, rms (RMS de la voix pendant le chant), vibrato, attaque, glisse, souffle, instable,
   accordage {cents, parSec}, choeur {n, detune}, tierce (2e voix en tierces), bruit {snr},
   reverb {rt60, drr}, piano {accords:[{midis,start,dur}], db}, hp (coupe-bas en Hz), annonces [{start,dur}], graine. */
function synth(notes, o = {}) {
  const sr = o.sr || 48000, duree = (o.duree ?? Math.max(...notes.map(n => n.start + n.dur)) + 1), L = Math.ceil(duree * sr);
  const r = alea(o.graine ?? 1);
  let y = new Float64Array(L);
  const nv = o.choeur?.n || 1, parts = [notes];
  if (o.tierce) parts.push(notes.map(n => ({ ...n, midi: n.tierceMidi ?? n.midi + 4, amp: .8 })));
  parts.forEach(ns => {
    for (let v = 0; v < nv; v++) {
      const det = nv > 1 ? gauss(r) * (o.choeur.detune ?? 12) : 0;
      let prev = null;
      ns.forEach(n => { const ret = nv > 1 ? Math.abs(gauss(r)) * .02 : 0; rendVoix(y, sr, n, prev, o, r, det, ret); prev = { midi: n.midi, fin: n.start + n.dur }; });
    }
  });
  const reverb = o.reverb;
  if (reverb) {
    const n = Math.floor(reverb.rt60 * sr), h = new Float64Array(n); let e = 0;
    for (let i = Math.floor(.005 * sr); i < n; i++) { h[i] = gauss(r) * Math.exp(-6.91 * i / n); e += h[i] * h[i]; }
    const g = Math.sqrt(Math.pow(10, -(reverb.drr ?? 0) / 10) / e); for (let i = 0; i < n; i++) h[i] *= g;
    h[0] = 1; y = Float64Array.from(convolue(y, h));
  }
  // Mise à l'échelle de la voix : on règle le RMS pendant les notes.
  const masque = new Uint8Array(L); notes.forEach(n => { const a = Math.floor(n.start * sr), b = Math.min(L, Math.floor((n.start + n.dur) * sr)); for (let i = a; i < b; i++) masque[i] = 1; });
  let e = 0, c = 0; for (let i = 0; i < L; i++) if (masque[i]) { e += y[i] * y[i]; c++; }
  const rmsVoix = o.rms ?? .03, gain = rmsVoix / Math.sqrt(e / Math.max(1, c)); for (let i = 0; i < L; i++) y[i] *= gain;
  if (o.piano) {
    const p = new Float64Array(L); o.piano.accords.forEach(a => rendPiano(p, sr, a.midis, a.start, a.dur));
    let ep = 0, cp = 0; for (let i = 0; i < L; i++) if (p[i]) { ep += p[i] * p[i]; cp++; }
    const gp = rmsVoix * Math.pow(10, (o.piano.db ?? 0) / 20) / Math.sqrt(ep / Math.max(1, cp)); for (let i = 0; i < L; i++) y[i] += p[i] * gp;
  }
  if (o.annonces) {
    // Voix de synthèse du téléphone entendue par son propre micro : parole sur 100 à 220 Hz qui descend.
    const a = new Float64Array(L);
    o.annonces.forEach(s => { rendVoix(a, sr, { midi: 50 + r() * 6, start: s.start, dur: s.dur }, null, { vibrato: { cents: 0 }, glisse: s.dur, instable: 1.2 }, r, 0, 0); });
    const ga = rmsVoix * Math.pow(10, (o.annoncesDb ?? -3) / 20) / .5; for (let i = 0; i < L; i++) y[i] += a[i] * ga;
  }
  if (o.bruit) {
    // Bruit de salle : 1/f simplifié, plus fort dans le grave, RMS réglé par le rapport signal sur bruit.
    const b = new Float64Array(L); let b0 = 0, b1 = 0, eb = 0;
    for (let i = 0; i < L; i++) { const w = gauss(r); b0 = .997 * b0 + .03 * w; b1 = .9 * b1 + .1 * w; b[i] = b0 + .5 * b1 + .05 * w; eb += b[i] * b[i]; }
    const gb = rmsVoix * Math.pow(10, -o.bruit.snr / 20) / Math.sqrt(eb / L); for (let i = 0; i < L; i++) y[i] += b[i] * gb;
  }
  if (o.hp) {
    // Coupe-bas d'ordre 2 : modèle du micro de téléphone (hypothèse de banc, pas une mesure de téléphone).
    const w = Math.tan(Math.PI * o.hp / sr), q = Math.SQRT1_2, n = 1 / (1 + w / q + w * w), b0 = n, b1 = -2 * n, b2 = n, a1 = 2 * (w * w - 1) * n, a2 = (1 - w / q + w * w) * n;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < L; i++) { const x = y[i], v = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v; }
  }
  return { x: Float32Array.from(y), sr, duree };
}

/* ---------- Chants à vérité connue, lus depuis tests/corpus/chants.json (lecture seule) ---------- */
const DEG = { maj: { 1: [0, 'maj'], 2: [2, 'min'], 3: [4, 'min'], 4: [5, 'maj'], 5: [7, 'maj'], 6: [9, 'min'] },
              min: { 1: [0, 'min'], 3: [3, 'maj'], 4: [5, 'min'], 5: [7, 'maj'], 6: [8, 'maj'], 7: [10, 'maj'] } };
const GAMME = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10] }, PENTA = { maj: [0, 2, 4, 7, 9], min: [0, 3, 5, 7, 10] };
const lireCorpus = () => JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'corpus', 'chants.json'), 'utf8'));

/* Rend un chant du corpus : o = {transpose, couplets, modulation:{couplet, demi}, rubato (écart de tempo, .08 pour 8 %)}. Vérité : notes, accords (basse du corpus), tonalités. */
function chantCorpus(e, o = {}) {
  const tr = o.transpose || 0, bt = 60 / (o.bpm || e.bpm), notes = [], accords = [], tonalites = [{ t: 0, tonic: mod12(e.tonique + tr), mode: e.mode }];
  let t = 0; const couplets = o.couplets || 2;
  for (let c = 0; c < couplets; c++) {
    const dem = o.modulation && c >= o.modulation.couplet ? o.modulation.demi : 0, t0 = t;
    if (o.modulation && c === o.modulation.couplet) tonalites.push({ t: t0, tonic: mod12(e.tonique + tr + dem), mode: e.mode });
    e.notes.forEach(([m, d], i) => { if (m != null) { const suiv = e.notes[i + 1], fin = !suiv || suiv[0] == null || d >= 3; notes.push({ midi: m + tr + dem, start: t, dur: d * bt * (fin ? .92 : .97), fin, section: c }); } t += d * bt; });
    const longueur = t - t0; let b = 0;
    e.basse.forEach(([deg, d], ib) => { const q = DEG[e.mode][deg]; if (q && b * bt < longueur) accords.push({ start: t0 + b * bt, dur: Math.min(d * bt, longueur - b * bt), deg, root: mod12(e.tonique + tr + dem + q[0]), q: q[1], section: c, lettre: 'A', ib }); b += d; });
    t += bt; // respiration entre couplets
  }
  if (o.rubato) {
    // Tempo qui respire : t' = t + A sin(2 pi t / 12), attaques décalées de quelques ms. La vérité suit le même déformé.
    const A = o.rubato * 12 / (2 * Math.PI), def = u => u + A * Math.sin(2 * Math.PI * u / 12), r = alea(o.graine ?? 1);
    notes.forEach(n => { const a = def(n.start), b = def(n.start + n.dur); n.start = a + gauss(r) * .012; n.dur = b - a; });
    accords.forEach(x => { const a = def(x.start), b = def(x.start + x.dur); x.start = a; x.dur = b - a; }); tonalites.forEach(k => { k.t = def(k.t); });
  }
  return { notes, accords, tonalites, duree: t, bpm: o.bpm || e.bpm, mode: e.mode, tonique: mod12(e.tonique + tr), titre: e.titre, bt };
}

/* Vocalises : broderies et mélismes rapides sur les notes tenues, 9e et 11e de l'accord tenues avant de résoudre. La tonalité ne bouge pas.
   o = {pMelisme, pExt, pBlue, vitesse (notes par seconde), graine}. Ne change pas la vérité harmonique. */
function ornemente(c, o = {}) {
  const r = alea(o.graine ?? 1), vit = o.vitesse ?? 8, out = [], tn = c.tonique, pent = PENTA[c.mode].map(x => mod12(x + tn)), gam = GAMME[c.mode].map(x => mod12(x + tn));
  const accordA = t => c.accords.find(a => t >= a.start && t < a.start + a.dur);
  const voisin = (m, set, dir) => { let v = m + dir; for (let k = 0; k < 4 && !set.includes(mod12(v)); k++) v += dir; return v; };
  c.notes.forEach(n => {
    const ac = accordA(n.start + .01);
    if (n.dur >= .45 && ac && r() < (o.pExt ?? .25)) {
      const ext = mod12(ac.root + (r() < .5 ? 2 : 5));
      if (gam.includes(ext)) { let m = n.midi; for (let d = 0; d < 6; d++) { if (mod12(n.midi + d) === ext) { m = n.midi + d; break; } if (mod12(n.midi - d) === ext) { m = n.midi - d; break; } }
        const d1 = n.dur * .55; out.push({ ...n, midi: m, dur: d1, fin: false }, { ...n, start: n.start + d1, dur: n.dur - d1 }); return; }
    }
    if (n.dur >= .4 && r() < (o.pMelisme ?? .5)) {
      const pas = 1 / vit, nb = Math.min(8, Math.floor((n.dur * .7) / pas)); let m = n.midi, dir = r() < .5 ? 1 : -1;
      for (let i = 0; i < nb; i++) { out.push({ ...n, midi: m, start: n.start + i * pas, dur: pas * .95, fin: false }); m = voisin(m, pent, dir); if (r() < .3 || Math.abs(m - n.midi) > 7) dir = -dir; if (o.pBlue && r() < o.pBlue) m += dir; }
      out.push({ ...n, start: n.start + nb * pas, dur: n.dur - nb * pas }); return;
    }
    out.push(n);
  });
  return { ...c, notes: out };
}

/* Accompagnement piano : basse à la main gauche, triade à la main droite sur chaque accord */
function pianoDe(c, opts = {}) {
  return c.accords.map(a => {
    const basse = 36 + mod12(a.root) > 47 ? 24 + mod12(a.root) : 36 + mod12(a.root);
    const tri = [0, a.q === 'maj' ? 4 : 3, 7].map(i => 60 + mod12(a.root + i));
    return { midis: [basse, basse + 12, ...tri], start: a.start + (opts.retard || 0), dur: a.dur * .95, root: a.root };
  });
}

module.exports = { synth, chantCorpus, ornemente, lireCorpus, pianoDe, DEG, GAMME, alea, gauss, hz, mod12 };

if (require.main === module) {
  const assert = require('assert');
  const notes = [{ midi: 69, start: .2, dur: 1 }];
  const { x, sr } = synth(notes, { sr: 16000, rms: .01, vibrato: { cents: 0 }, instable: 0, souffle: 0, glisse: 0 });
  let e = 0, n = 0; for (let i = .4 * sr; i < 1 * sr; i++) { e += x[i] * x[i]; n++; }
  assert(Math.abs(Math.sqrt(e / n) - .01) < .002, 'RMS voix hors tolérance : ' + Math.sqrt(e / n));
  let zc = 0; for (let i = .4 * sr; i < 1 * sr; i++) if (x[i - 1] <= 0 && x[i] > 0) zc++;
  assert(zc > 100, 'voix muette');
  const corpus = lireCorpus(); const bilan = [];
  corpus.forEach(c => { const bn = c.notes.reduce((s, x) => s + x[1], 0), bb = c.basse.reduce((s, x) => s + x[1], 0); if (Math.abs(bn - bb) > .01) bilan.push(c.titre + ' notes ' + bn + ' basse ' + bb); });
  const c = chantCorpus(corpus[0]); assert(c.notes.length > 20 && c.accords.length >= 9 && c.duree > 30, 'chant mal formé');
  const o = ornemente(c, { graine: 2 }); assert(o.notes.length > c.notes.length, 'ornement sans effet');
  console.log('synth ok', { chants: corpus.length, notes: c.notes.length, duree: +c.duree.toFixed(1), orne: o.notes.length, ecarts: bilan });
}
