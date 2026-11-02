'use strict';
/* Mesure 2 : tonalité et accords, moteur actuel contre prototype. Usage : node tests/banc/mesure-moteur.js [graine]
   Le premier passage synthétise et analyse (quelques minutes, un fil par coeur). Les trames sont gardées dans le dossier temporaire. */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), os = require('os'), path = require('path');
const { synth, chantCorpus, ornemente, lireCorpus, pianoDe, mod12 } = require('./synth.js');
const { mpm, creeDecimateur } = require('./hauteur.js');
const { creeMoteurActuel } = require('./moteur-actuel.js');
const { creeProto, apprendTransitions } = require('./proto.js');

const VERSION = 'v5-' + fs.statSync(path.join(__dirname, '..', 'corpus', 'chants.json')).size, CACHE = path.join(os.tmpdir(), 'goodplay-banc-' + VERSION);
const SALLE = { bruit: { snr: 20 }, reverb: { rt60: 1.2, drr: -3 } };
const SCENES = {
  'simple, studio': { style: 'simple', sc: { bruit: { snr: 35 } } },
  'simple, salle': { style: 'simple', sc: SALLE },
  'vocalises 9e 11e, studio': { style: 'vocalises', sc: { bruit: { snr: 35 } } },
  'vocalises 9e 11e, salle': { style: 'vocalises', sc: SALLE },
  'vocalises et notes bleues, salle': { style: 'vocalises', pBlue: .1, sc: SALLE },
  'simple, 4 couplets, salle': { style: 'simple', couplets: 4, sc: SALLE },
  'simple, rubato +-8 %': { style: 'simple', rubato: .08, sc: SALLE },
  'simple, accordage +25 c': { style: 'simple', sc: { bruit: { snr: 35 }, accordage: { cents: 25 } } },
  'simple, accordage +40 c': { style: 'simple', sc: { bruit: { snr: 35 }, accordage: { cents: 40 } } },
  'simple, +40 c et 1 c/s': { style: 'simple', sc: { bruit: { snr: 35 }, accordage: { cents: 40, parSec: 1 } } },
  'vocalises, +40 c et 1 c/s, salle': { style: 'vocalises', sc: { ...SALLE, accordage: { cents: 40, parSec: 1 } } },
  'choeur 5 voix, salle': { style: 'simple', sc: { ...SALLE, choeur: { n: 5, detune: 12 } } },
  'choeur 5 voix, vocalises, -35 c, salle': { style: 'vocalises', sc: { ...SALLE, choeur: { n: 5, detune: 12 }, accordage: { cents: -35 } } },
  'piano +6 dB sur les bons accords': { style: 'simple', sc: { bruit: { snr: 30 } }, piano: 6 },
  'annonces vocales entendues par le micro': { style: 'simple', sc: { bruit: { snr: 30 } }, annonces: true },
  'niveau .02 (porte par défaut .0175)': { style: 'simple', sc: { bruit: { snr: 25 } }, rms: .02 },
  'modulation +2 demi-tons, salle': { style: 'simple', sc: SALLE, mod: { demi: 2 } },
  'modulation +1 demi-ton, salle': { style: 'simple', sc: SALLE, mod: { demi: 1 } },
  'modulation +5 demi-tons, salle': { style: 'simple', sc: SALLE, mod: { demi: 5 } }
};

const CORPUS = lireCorpus(), MOITIE = process.env.MOITIE != null ? +process.env.MOITIE : null;
/* Chaque chant du corpus, deux couplets, en registre d'origine ou une octave plus bas selon l'indice, transposé selon la graine. */
function chants(graine, scene) {
  return CORPUS.map((e, i) => {
    const tr = ((graine * 5 + i * 7) % 12) - 5, moyenne = e.notes.filter(n => n[0] != null).reduce((s, n) => s + n[0], 0) / e.notes.filter(n => n[0] != null).length;
    const octave = i % 2 ? (moyenne + tr > 60 ? -12 : 0) : (moyenne + tr < 60 ? 12 : 0);
    let c = chantCorpus(e, { transpose: tr + octave, couplets: scene.couplets || (scene.mod ? 3 : 2), modulation: scene.mod ? { couplet: 2, demi: scene.mod.demi } : undefined, rubato: scene.rubato, graine: graine + i });
    if (scene.style === 'vocalises') c = ornemente(c, { graine: graine + i, pBlue: scene.pBlue });
    return c;
  });
}

function analyse(sceneNom, idx, graine) {
  const fichier = path.join(CACHE, Buffer.from(sceneNom).toString('hex').slice(0, 40) + '-' + idx + '-' + graine + '.json');
  if (fs.existsSync(fichier)) return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const scene = SCENES[sceneNom], c = chants(graine, scene)[idx];
  const o = { sr: 48000, rms: scene.rms ?? .03, graine: graine + idx * 7 + 1, duree: c.duree + 1, ...scene.sc };
  if (scene.piano != null) o.piano = { accords: pianoDe(c), db: scene.piano };
  if (scene.annonces) o.annonces = c.accords.filter((a, i) => i === 0 || a.root !== c.accords[i - 1].root).map(a => ({ start: a.start + .9, dur: .55 }));
  const { x } = synth(c.notes, o);
  const m = creeMoteurActuel(48000); const log = m.rejoue(x);
  const dec = creeDecimateur(3), x16 = dec(x), N = 683, pas = 320, tr = [];
  for (let i = 0; i + N < x16.length; i += pas) {
    const w = x16.subarray(i, i + N); let e = 0; for (let j = 0; j < N; j++) e += w[j] * w[j];
    const p = mpm(w, 16000, { k: .9 });
    const ok = p && p.f > 70 && p.f < 1100;
    tr.push([+((i + N) / 16000).toFixed(3), ok ? +(69 + 12 * Math.log2(p.f / 440)).toFixed(3) : null, ok ? +p.conf.toFixed(3) : 0, +Math.sqrt(e / N).toFixed(5)]);
  }
  const res = { actuel: { keys: log.keys, chords: log.chords, nbNotes: log.notes.length, ouvertes: log.ouvertes / log.trames, voisees: log.voisees / log.trames }, tr };
  fs.writeFileSync(fichier, JSON.stringify(res));
  return res;
}

/* ---------- Métriques ---------- */
const memeAccord = (d, a) => d && d.root === a.root && d.q === a.q;
function afficheA(chords, t) { let d = null; for (const e of chords) { if (e.t > t) break; d = e; } return d; }
function metriques(c, log) {
  const tv = t => { let k = c.tonalites[0]; for (const x of c.tonalites) if (x.t <= t) k = x; return k; };
  const keys = log.keys.filter(k => !k.nouveauChant), mods = keys.filter(k => k.isMod);
  const r = { corrections: keys.filter(k => k.correction).length, lock: null, lockOk: false, lockRel: false, faussesMod: 0, nbMods: mods.length, tempsJuste: 0, tempsTotal: 0, modVraie: null, nouveauxChants: log.keys.filter(k => k.nouveauChant).length };
  if (keys.length) {
    r.lock = keys[0].t; const v = tv(keys[0].t), f = keys[0];
    r.lockOk = f.tonic === v.tonic && f.mode === v.mode; r.lockRel = !r.lockOk && f.mode !== v.mode && mod12(v.tonic + (v.mode === 'maj' ? 9 : 3)) === f.tonic;
    for (let t = keys[0].t; t < c.duree; t += .25) { let k = keys[0]; for (const x of keys) if (x.t <= t) k = x; const w = tv(t); r.tempsTotal++; if (k.tonic === w.tonic && k.mode === w.mode) r.tempsJuste++; }
    mods.forEach(m => { const w = tv(m.t); if (!(m.tonic === w.tonic && m.mode === w.mode)) r.faussesMod++; });
    if (c.tonalites.length > 1) { const T = c.tonalites[1]; const d = keys.find(k => k.t > T.t && k.tonic === T.tonic && k.mode === T.mode); r.modVraie = d ? d.t - T.t : -1; }
  }
  const acc = c.accords; r.chg = 0; r.surLeTemps = 0; r.a300 = 0; r.a1s = 0; r.latences = []; r.rates = 0; r.couv = 0; r.couvTot = 0; r.chgRep = 0; r.temRep = 0;
  const chords = log.chords;
  acc.forEach((a, i) => {
    if (keys.length && a.start > keys[0].t) for (let t = a.start + .1; t < a.start + a.dur; t += .1) { r.couvTot++; if (memeAccord(afficheA(chords, t), a)) r.couv++; }
    if (i === 0 || (a.root === acc[i - 1].root && a.q === acc[i - 1].q) || !keys.length || a.start <= keys[0].t + .5) return;
    r.chg++;
    const rep = a.section > 0 && c.accords.some((b, j) => j < i && b.lettre === a.lettre && b.section < a.section);
    if (rep) r.chgRep++;
    const auTemps = memeAccord(afficheA(chords, a.start + .1), a);
    if (auTemps) r.surLeTemps++; if (auTemps && rep) r.temRep++;
    if (memeAccord(afficheA(chords, a.start + .3), a)) r.a300++;
    if (memeAccord(afficheA(chords, a.start + 1), a)) r.a1s++;
    let lat = null; for (let t = a.start; t < a.start + a.dur; t += .02) { if (memeAccord(afficheA(chords, t), a)) { lat = t - a.start; break; } }
    if (lat == null) r.rates++; else r.latences.push(lat);
  });
  return r;
}
function cumule(list) {
  const sum = k => list.reduce((s, r) => s + (r[k] || 0), 0), lat = list.flatMap(r => r.latences).sort((a, b) => a - b), locks = list.filter(r => r.lock != null);
  const med = a => a.length ? a[a.length >> 1] : NaN, p90 = a => a.length ? a[Math.floor(a.length * .9)] : NaN;
  const corrections = list.reduce((a, r) => a + r.corrections, 0), dets = list.filter(r => r.modVraie != null), detOk = dets.filter(r => r.modVraie >= 0).map(r => r.modVraie).sort((a, b) => a - b);
  return { corrections, n: list.length, sansTon: list.length - locks.length, lockMed: med(locks.map(r => r.lock).sort((a, b) => a - b)), lockOk: 100 * locks.filter(r => r.lockOk).length / Math.max(1, locks.length), lockRel: 100 * locks.filter(r => r.lockRel).length / Math.max(1, locks.length), fausses: sum('faussesMod'), chantsAvecFausse: list.filter(r => r.faussesMod > 0).length, tempsJuste: 100 * sum('tempsJuste') / Math.max(1, sum('tempsTotal')), couv: 100 * sum('couv') / Math.max(1, sum('couvTot')), surTemps: 100 * sum('surLeTemps') / Math.max(1, sum('chg')), a300: 100 * sum('a300') / Math.max(1, sum('chg')), a1s: 100 * sum('a1s') / Math.max(1, sum('chg')), rates: 100 * sum('rates') / Math.max(1, sum('chg')), latMed: med(lat), latP90: p90(lat), repTemps: 100 * sum('temRep') / Math.max(1, sum('chgRep')), det: dets.length, detOk: detOk.length, detMed: med(detOk) };
}
const f = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : ' - ';
function ligne(nom, s) { return `  ${nom.padEnd(9)} ton: ${f(s.lockMed).padStart(5)} s, juste ${f(s.lockOk, 0).padStart(3)} %, relatif ${f(s.lockRel, 0).padStart(3)} %, temps juste ${f(s.tempsJuste, 0).padStart(3)} %, fausses mod ${String(s.fausses).padStart(3)} (${s.chantsAvecFausse}/${s.n} chants), corrections ${s.corrections}${s.sansTon ? ', sans ton ' + s.sansTon : ''} | accords: couverture ${f(s.couv, 0).padStart(3)} %, sur le temps ${f(s.surTemps, 0).padStart(3)} %, à 300 ms ${f(s.a300, 0).padStart(3)} %, à 1 s ${f(s.a1s, 0).padStart(3)} %, latence méd ${f(s.latMed, 2).padStart(5)} s p90 ${f(s.latP90, 2).padStart(5)} s, ratés ${f(s.rates, 0).padStart(3)} %, reprises sur le temps ${f(s.repTemps, 0).padStart(3)} %${s.det ? ` | vraies mod trouvées ${s.detOk}/${s.det}, délai méd ${f(s.detMed)} s` : ''}`; }

/* Grille oracle pour mesurer ce que vaudrait une connaissance parfaite du temps : 'frontieres' (vrais changements d'accord) ou n temps. */
function grilleOracle(c, g) {
  if (g === 'frontieres') return c.accords.map(a => a.start);
  const debuts = c.accords.filter(a => a.ib === 0).map(a => a.start), out = []; debuts.forEach((d, j) => { const fin = debuts[j + 1] ?? c.duree; for (let t = d; t < fin - .01; t += g * c.bt) out.push(t); }); return out;
}
function protoSur(res, opts, i, c) {
  const o = { transitions: apprendTransitions(CORPUS, i), ...opts }; if (o.grille && c) o.ticks = grilleOracle(c, o.grille);
  if (o.grilleJuste && c) o.grilleConnue = c.accords.filter(a => a.section === 0); // grille du 1er couplet supposée juste : corrigée à la main ou déjà connue
  const p = creeProto(o); let pt = 0;
  res.tr.forEach(([t, m, cf, rms]) => { p.trame(t, m, cf, rms, .02); pt = t; });
  return p.finir(pt);
}

module.exports = { SCENES, chants, analyse, metriques, cumule, protoSur };
if (!isMainThread) {
  parentPort.on('message', j => { const res = analyse(j.scene, j.idx, j.graine); parentPort.postMessage({ ok: 1, ...j }); });
} else if (require.main === module) {
  const graine = +(process.argv[2] || 1), opts = JSON.parse(process.argv[3] || '{}'), filtre = process.argv[4];  // shortcut: un seul jeu de transpositions par graine, relancer avec une autre graine pour varier
  fs.mkdirSync(CACHE, { recursive: true });
  const jobs = []; for (const s in SCENES) { if (filtre && !s.includes(filtre)) continue; const n = chants(graine, SCENES[s]).length; for (let i = 0; i < n; i++) jobs.push({ scene: s, idx: i, graine }); }
  const nbW = Math.max(1, os.cpus().length - 1); let fait = 0, prochain = 0;
  const fin = () => {
    console.log(`Graine ${graine}. Voix synthétique sur les ${CORPUS.length} chants du corpus, deux couplets.`);
    console.log(`Prototype : ${JSON.stringify(opts)}`);
    const tot = { actuel: [], proto: [] };
    for (const s in SCENES) {
      if (filtre && !s.includes(filtre)) continue;
      const cs = chants(graine, SCENES[s]), ra = [], rp = [], rpSans = [];
      let ouv = 0, voi = 0;
      cs.forEach((c, i) => { if (MOITIE != null && i % 2 !== MOITIE) return; const res = analyse(s, i, graine); ra.push(metriques(c, res.actuel)); ouv += res.actuel.ouvertes; voi += res.actuel.voisees; rp.push(metriques(c, protoSur(res, opts, i, c))); rpSans.push(metriques(c, protoSur(res, { ...opts, memoire: false }, i, c))); });
      const nb = ra.length; if (!nb) continue; console.log(`\n${s}  (${nb} chants, porte ouverte ${f(100 * ouv / nb, 0)} %, trames voisées moteur actuel ${f(100 * voi / nb, 0)} %)`);
      console.log(ligne('actuel', cumule(ra))); console.log(ligne('proto', cumule(rp))); console.log(ligne('proto-mém', cumule(rpSans)));
    }
    process.exit(0);
  };
  if (!jobs.length) { console.log('rien à faire'); process.exit(0); }
  const manque = jobs.filter(j => !fs.existsSync(path.join(CACHE, Buffer.from(j.scene).toString('hex').slice(0, 40) + '-' + j.idx + '-' + j.graine + '.json')));
  if (!manque.length) fin();
  else for (let w = 0; w < nbW; w++) {
    const wk = new Worker(__filename); const envoi = () => { if (prochain < manque.length) wk.postMessage(manque[prochain++]); else wk.terminate(); };
    wk.on('message', () => { fait++; if (fait % 40 === 0) console.error('fait', fait, '/', manque.length); if (fait === manque.length) fin(); else envoi(); });
    wk.on('error', e => { console.error(e); process.exit(1); });
    envoi();
  }
}
