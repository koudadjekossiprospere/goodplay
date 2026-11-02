'use strict';
/* Mesure 4 : accordage adaptatif, tempo à partir des attaques, basse réelle. Usage : node tests/banc/mesure-appoint.js [partie]
   Lancer mesure-moteur.js d'abord : les trames viennent de son dossier temporaire. */
const { synth, chantCorpus, lireCorpus, pianoDe, mod12 } = require('./synth.js');
const { creeDecimateur } = require('./hauteur.js');
const { creeProto, apprendTransitions } = require('./proto.js');
const { SCENES, chants, analyse } = require('./mesure-moteur.js');
const corpus = lireCorpus(), GRAINE = 1, partie = process.argv[2];

/* ---------- Accordage ---------- */
function accordage() {
  console.log('== A. Accordage estimé par moyenne circulaire glissante : erreur absolue en cents, médiane et 90e centile sur 15 chants ==');
  const INSTANTS = [2, 4, 6, 10, 20, 40];
  [['simple, accordage +25 c', 25, 0], ['simple, accordage +40 c', 40, 0], ['simple, +40 c et 1 c/s', 40, 1], ['vocalises, +40 c et 1 c/s, salle', 40, 1], ['choeur 5 voix, vocalises, -35 c, salle', -35, 0]].forEach(([nom, c0, ps]) => {
    const err = INSTANTS.map(() => []);
    chants(GRAINE, SCENES[nom]).forEach((c, i) => {
      const res = analyse(nom, i, GRAINE), p = creeProto({ memoire: false }); let t0v = null;
      res.tr.forEach(([t, m, cf, rms]) => { p.trame(t, m, cf, rms, .02); });
      const log = p.log.accordage;
      INSTANTS.forEach((T, k) => { const e = log.find(a => a.t >= T); if (!e) return; const v = c0 + ps * e.t, d = e.cents - v, w = d - 100 * Math.round(d / 100); err[k].push(Math.abs(w)); });
    });
    const s = err.map((a, k) => { a.sort((x, y) => x - y); return `${INSTANTS[k]} s: ${a.length ? a[a.length >> 1].toFixed(1) : '-'}/${a.length ? a[Math.floor(a.length * .9)].toFixed(1) : '-'}`; }).join('  ');
    console.log(`  ${nom.padEnd(42)} ${s}`);
  });
}

/* ---------- Tempo ---------- */
function periode(onsets, now, win = 12) {
  const rec = onsets.filter(t => t > now - win && t <= now); if (rec.length < 5) return null;
  let bp = null, bs = -1;
  for (let p = .3; p <= 1.25; p *= 1.015) {
    let s = 0;
    for (let i = 0; i < rec.length; i++) for (let j = i + 1; j < rec.length; j++) { const d = rec[j] - rec[i]; if (d > 4) break; const k = Math.round(d / p), e = d - k * p; if (k) s += Math.exp(-e * e / (2 * .025 * .025)) / Math.sqrt(k); }
    s *= Math.exp(-Math.pow(Math.log2(p / .65), 2) / (2 * .8 * .8));
    if (s > bs) { bs = s; bp = p; }
  }
  // Phase : moyenne circulaire des attaques récentes modulo la période
  let zr = 0, zi = 0; rec.forEach(t => { const w = 2 * Math.PI * t / bp, g = Math.exp((t - now) / 5); zr += g * Math.cos(w); zi += g * Math.sin(w); });
  return { p: bp, phi: Math.atan2(zi, zr) / (2 * Math.PI) * bp };
}
function tempo() {
  console.log('\n== B. Tempo estimé depuis les attaques de notes (changements de hauteur), 15 chants ==');
  ['simple, studio', 'vocalises 9e 11e, salle', 'simple, rubato +-8 %'].forEach(nom => {
    const ok = { 8: [0, 0], 15: [0, 0], 30: [0, 0] }, erreurs = [];
    chants(GRAINE, SCENES[nom]).forEach((c, i) => {
      const res = analyse(nom, i, GRAINE), p = creeProto({ memoire: false }); res.tr.forEach(([t, m, cf, rms]) => p.trame(t, m, cf, rms, .02)); p.finir(c.duree);
      const on = p.log.notes.map(n => n.start), bt = c.bt;
      [8, 15, 30].forEach(T => { const e = periode(on, T); ok[T][1]++; if (!e) return; const rs = [.5, 1, 2, 3, 1.5].map(k => Math.abs(e.p / (k * bt) - 1)); if (Math.min(...rs) < .04) ok[T][0]++; });
      c.accords.forEach(a => { if (a.start < 15) return; const e = periode(on, a.start - .1); if (!e) return; const k = (a.start - e.phi) / e.p, d = (k - Math.round(k)) * e.p; erreurs.push(Math.abs(d)); });
    });
    erreurs.sort((x, y) => x - y);
    console.log(`  ${nom.padEnd(28)} bon tempo à 4 % près (à l'octave ou au ternaire près) : à 8 s ${ok[8][0]}/${ok[8][1]}, à 15 s ${ok[15][0]}/${ok[15][1]}, à 30 s ${ok[30][0]}/${ok[30][1]} ; écart du temps prédit à l'attaque d'accord suivante : médiane ${(1000 * erreurs[erreurs.length >> 1]).toFixed(0)} ms, 90e centile ${(1000 * erreurs[Math.floor(erreurs.length * .9)]).toFixed(0)} ms`);
  });
}

/* ---------- Basse réelle ---------- */
const dec8 = creeDecimateur(8, 95), dec3 = creeDecimateur(3);
function basseTrame(x2k, i, W, han) {
  // Sonde de Goertzel sur Mi1 à Sol3. Le 2e harmonique compte aussi : un petit micro atténue la fondamentale.
  const mags = new Float64Array(70);
  for (let m = 28; m <= 67; m++) {
    const f = 440 * Math.pow(2, (m - 69) / 12), w = 2 * Math.cos(2 * Math.PI * f / 2000); let s1 = 0, s2 = 0;
    for (let j = 0; j < W; j++) { const s = x2k[i + j] * han[j] + w * s1 - s2; s2 = s1; s1 = s; }
    mags[m] = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - w * s1 * s2));
  }
  let bm = -1, bv = 0, moy = 0; for (let m = 28; m <= 55; m++) { const v = mags[m] + .6 * mags[m + 12]; moy += v; if (v > bv) { bv = v; bm = m; } }
  return { pc: mod12(bm), m: bm, force: bv / (moy / 28 + 1e-12) };
}
function basse() {
  console.log('\n== C. Basse réelle : piano (basse + triade) près du micro, fenêtre de Hann de 256 ms sur 2 kHz, coupe-bas simulé du téléphone ==');
  const W = 512, han = new Float64Array(W); for (let i = 0; i < W; i++) han[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (W - 1));
  const cas = [[0, 0, 0], [0, 100, 0], [0, 150, 0], [-12, 100, 0], [-12, 150, 0], [0, 100, -6], [0, 100, 6], [-12, 100, 6], [-12, 150, -6]];
  cas.forEach(([oct, hp, db]) => {
    let juste = 0, tot = 0; const lat = []; let cal = 0;
    [0, 3, 6, 9, 12].forEach(i => {
      const c = chantCorpus(corpus[i], { couplets: 1, transpose: (i % 5) - 2 + oct + (corpus[i].notes.find(n => n[0])[0] < 60 && oct === 0 ? 12 : 0) });
      const { x } = synth(c.notes, { sr: 48000, rms: .02, graine: 300 + i, bruit: { snr: 25 }, piano: { accords: pianoDe(c), db }, hp: hp || undefined, duree: c.duree + 1 });
      const x2k = dec8(dec3(x)), dt = .05;
      c.accords.forEach((a, ia) => {
        // Justesse sur le corps de l'accord, puis latence jusqu'à deux trames justes.
        let ok2 = 0, trouvee = null;
        for (let t = a.start; t < a.start + a.dur - .03; t += dt) {
          const iFin = Math.floor(t * 2000), i0 = iFin - W; if (i0 < 0) continue;
          const b = basseTrame(x2k, i0, W, han);
          if (t >= a.start + .3) { tot++; if (b.pc === a.root) juste++; }
          if (b.pc === a.root) { ok2++; if (ok2 === 2 && trouvee == null) trouvee = t - a.start; } else ok2 = 0;
        }
        if (ia && a.root !== c.accords[ia - 1].root) { if (trouvee != null) lat.push(trouvee); else cal++; }
      });
    });
    lat.sort((u, v) => u - v);
    console.log(`  voix ${oct ? "d'homme" : 'de femme'}, coupe-bas ${String(hp || 'aucun').padEnd(5)} Hz, piano ${String(db).padStart(3)} dB : fondamentale juste ${(100 * juste / tot).toFixed(0).padStart(3)} %, latence médiane ${lat.length ? (1000 * lat[lat.length >> 1]).toFixed(0) : '-'} ms, changements manqués ${(100 * cal / (lat.length + cal || 1)).toFixed(0)} %`);
  });
  const t0 = process.hrtime.bigint(), buf = new Float32Array(W + 10); for (let k = 0; k < 500; k++) basseTrame(buf, 0, W, han);
  console.log(`  coût : ${(Number(process.hrtime.bigint() - t0) / 1e6 / 500).toFixed(3)} ms par trame sur ce PC`);
}

if (!partie || partie === 'accordage') accordage();
if (!partie || partie === 'tempo') tempo();
if (!partie || partie === 'basse') basse();
