'use strict';
/* Compare des modèles neuronaux de hauteur à MPM, dans le vrai GP.Moteur, sur les mêmes signaux. Aucune dépendance du projet : modèles et moteurs d'exécution vivent hors du dépôt.
   node tests/banc/compare-ia.js --ia <dossier> --pcm <ag.f32> [--partie reglage|controle] [--candidats mpm,swift2k2] [--voix] [--scene regex] [--silence] [--sortie x.json]
   <dossier> contient dl-swiftf0/, dl-crepe/, dl-basicpitch/, rt-ort/, rt-tfjs/. Voir docs/recherche/ia-oreille.md.
   Réglage : chants pairs, graine 1, et vraie voix. Contrôle : chants impairs, graine 2, jamais pour régler.
   Limite : voix synthétique et vraie voix sans vérité note à note. Sur la vraie voix on ne compare que des symptômes. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { SCENES, CORPUS, chantDe, executer, metriques, cumule, rendre } = require('../mesure.js');
const { ecouter, bilan, verite } = require('../vraies-voix.js');
const silence = require('./silence.js'), { lireCorpus } = require('./synth.js');
const GP = globalThis.GP; require('../../js/reconnaissance.js'); try { require('../../js/base-hymnes.js'); } catch (e) { /* facultative */ }

const A = process.argv.slice(2), opt = n => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : null; };
const IA = opt('--ia') || process.env.GOODPLAY_IA, PCM = opt('--pcm') || process.env.GOODPLAY_PCM;
const SR = 16000, N = 683, MPM_RETARD = .021; // MPM : le centre de sa fenêtre de 683 échantillons est 21 ms avant la fin
const hzMidi = f => 69 + 12 * Math.log2(f / 440);

/* Confiance du modèle vers l'échelle de la clarté : le seuil de voisement du modèle tombe sur `clarte` (.7), 1 reste 1. Les seuils du moteur ne bougent pas. */
const echelle = (c, s) => c < s ? .7 * c / s : .7 + .3 * (c - s) / (1 - s);
assert.strictEqual(echelle(.5, .5), .7); assert.strictEqual(echelle(1, .35), 1);

let _ort = null;
const ort = () => { if (!_ort) { _ort = require(path.join(IA, 'rt-ort/node_modules/onnxruntime-web')); _ort.env.wasm.numThreads = 1; _ort.env.logLevel = 'error'; } return _ort; };
const sessions = {};
const session = async f => sessions[f] || (sessions[f] = await ort().InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(IA, f))), { executionProviders: ['wasm'], logSeverityLevel: 3 }));

/* Gain lent : SwiftF0 ne normalise pas le niveau. Pics sur des blocs de 0,256 s, max sur 2 s. */
function gainLent(y, o) {
  if (!o.agc) return () => 1;
  const B = 4096, n = Math.ceil(y.length / B), pics = new Float32Array(n);
  for (let b = 0; b < n; b++) { let p = 0; for (let i = b * B, e = Math.min(y.length, i + B); i < e; i++) { const a = Math.abs(y[i]); if (a > p) p = a; } pics[b] = p; }
  return fin => { const b = Math.floor(fin / B); let p = 0; for (let k = Math.max(0, b - 8); k <= Math.min(n - 1, b); k++) if (pics[k] > p) p = pics[k]; return p > o.pic ? 1 : Math.min(o.agc, o.pic / Math.max(p, 1e-5)); };
}

/* SwiftF0 en flux causal : toutes les k trames de 16 ms, on passe la fin du signal connu au modèle et on lit les k trames finies depuis L trames. Une trame sort donc (L+k)*16 ms après son centre. */
async function suitSwift(y, o) {
  const s = await session('dl-swiftf0/model.onnx'), O = ort(), H = 256, L = o.L, k = o.k, W = 12 + L + k, n = Math.floor(y.length / H), midi = new Float32Array(n).fill(NaN), conf = new Float32Array(n), fmin = new O.Tensor('float32', [70], []), fmax = new O.Tensor('float32', [1100], []), gain = gainLent(y, o);
  // À 10 trames, tout le champ récepteur est connu : le flux rend le même résultat qu'une passe entière, bien plus rapide au banc.
  if (L >= 10 && !o.agc) for (let d = 0; d < n; d += 1875) {
    const f = Math.min(n, d + 1875 + 24), b = y.subarray(Math.max(0, d - 24) * H, f * H), d0 = Math.max(0, d - 24), r = await s.run({ audio: new O.Tensor('float32', b, [1, b.length]), fmin, fmax });
    for (let j = d; j < Math.min(n, d + 1875); j++) { const i = j - d0, p = r.pitch.data[i]; let pic = 0; for (let q = Math.max(0, j * H - 256), z = Math.min(y.length, j * H + 256); q < z; q++) { const a = Math.abs(y[q]); if (a > pic) pic = a; } if (p > 0 && pic >= 1e-3) { midi[j] = hzMidi(p); conf[j] = echelle(r.confidence.data[i], o.s); } }
  } else for (let e = k; e <= n; e += k) {
    const d = Math.max(0, e - W), b = y.slice(d * H, e * H), g = gain(e * H); if (g !== 1) for (let i = 0; i < b.length; i++) b[i] *= g;
    let pic = 0; for (let i = Math.max(0, b.length - 1024); i < b.length; i++) { const a = Math.abs(b[i]); if (a > pic) pic = a; }
    const r = await s.run({ audio: new O.Tensor('float32', b, [1, b.length]), fmin, fmax });
    for (let j = Math.max(0, e - L - k); j < e - L; j++) { const i = j - d, p = r.pitch.data[i]; if (p > 0 && pic >= 1e-3) { midi[j] = hzMidi(p); conf[j] = echelle(r.confidence.data[i], o.s); } }
  }
  const D = L + k, retard = D * H / SR;
  return { retard, lit: t => { const j = Math.floor(t * SR / H + 1e-6) - D; return j >= 0 && j < n && conf[j] > 0 ? { midi: midi[j], conf: conf[j] } : null; } };
}

/* CREPE tiny, modèle TF.js du dépôt officiel, normalisation et décodage de son crepe.js. Une trame par tic du moteur. */
let _crepe = null;
async function chargeCrepe() {
  if (_crepe) return _crepe;
  const tf = require(path.join(IA, 'rt-tfjs/node_modules/@tensorflow/tfjs')), wasm = require(path.join(IA, 'rt-tfjs/node_modules/@tensorflow/tfjs-backend-wasm'));
  wasm.setWasmPaths(path.join(IA, 'rt-tfjs/node_modules/@tensorflow/tfjs-backend-wasm/dist') + path.sep); await tf.setBackend('wasm'); await tf.ready();
  const dir = path.join(IA, 'dl-crepe/model'), mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8')), man = mj.weightsManifest;
  const bufs = man.flatMap(g => g.paths.map(p => fs.readFileSync(path.join(dir, p)))), tot = Buffer.concat(bufs);
  const modele = await tf.loadLayersModel({ load: async () => ({ modelTopology: mj.modelTopology.model_config ? mj.modelTopology.model_config : mj.modelTopology, weightSpecs: man.flatMap(g => g.weights), weightData: tot.buffer.slice(tot.byteOffset, tot.byteOffset + tot.length) }) });
  return _crepe = { tf, modele };
}
async function suitCrepe(y, o) {
  const { tf, modele } = await chargeCrepe(), P = 320, n = Math.floor(y.length / P), midi = new Float32Array(n).fill(NaN), conf = new Float32Array(n), F = new Float32Array(1024);
  for (let j = 0; j < n; j++) {
    const fin = (j + 1) * P; if (fin < 1024) continue;
    let m = 0, e = 0; for (let i = 0; i < 1024; i++) { F[i] = y[fin - 1024 + i]; m += F[i]; } m /= 1024;
    for (let i = 0; i < 1024; i++) { F[i] -= m; e += F[i] * F[i]; } const sd = Math.sqrt(e / 1024); if (sd < 1e-7) continue; for (let i = 0; i < 1024; i++) F[i] /= sd;
    const a = tf.tidy(() => modele.predict(tf.tensor2d(F, [1, 1024])).dataSync());
    let c = 0; for (let i = 1; i < 360; i++) if (a[i] > a[c]) c = i;
    let ws = 0, cs = 0; for (let i = Math.max(0, c - 4); i < Math.min(360, c + 5); i++) { ws += a[i]; cs += a[i] * (1997.3794084376191 + i * 7180 / 359); }
    midi[j] = hzMidi(10 * Math.pow(2, cs / ws / 1200)); conf[j] = echelle(a[c], o.s);
  }
  return { retard: .032, lit: t => { const j = Math.round(t / .02) - 1; return j >= 0 && j < n && conf[j] > 0 ? { midi: midi[j], conf: conf[j] } : null; } };
}

/* Basic Pitch : fenêtre fixe de 43844 échantillons à 22,05 kHz, polyphonique. On lit le pic de `contour` entre 70 et 1100 Hz, L trames (11,6 ms) avant le bord, une fenêtre tous les `tous` s. */
function reechantillonne(x, srIn, srOut) {
  const R = srIn / srOut, n = Math.floor(x.length / R), y = new Float32Array(n), Q = 12, fc = Math.min(1, 1 / R) * .9;
  for (let i = 0; i < n; i++) { const c = i * R, c0 = Math.round(c); let s = 0, z = 0; for (let j = Math.max(0, c0 - Q * 2); j <= Math.min(x.length - 1, c0 + Q * 2); j++) { const u = (j - c) * fc, h = (Math.abs(u) < 1e-9 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) * (.5 + .5 * Math.cos(Math.PI * (j - c) / (Q * 2 + 1))); s += h * x[j]; z += h; } y[i] = s / z; }
  return y;
}
async function suitBasicPitch(x48, o) {
  const s = await session('dl-basicpitch/nmp.onnx'), O = ort(), y = reechantillonne(x48, 48000, 22050), L0 = 43844, SRB = 22050, hop = 256, T = 172, nb = 264, base = 27.5 * Math.pow(2, -1 / 36);
  const pasFen = Math.round(o.tous * SRB), f = new Map(), lo = Math.ceil(36 * Math.log2(70 / base)), hi = Math.floor(36 * Math.log2(1100 / base));
  for (let fin = pasFen; fin <= y.length; fin += pasFen) {
    const b = new Float32Array(L0), a = y.subarray(Math.max(0, fin - L0), fin); b.set(a, L0 - a.length);
    const r = await s.run({ 'serving_default_input_2:0': new O.Tensor('float32', b, [1, L0, 1]) }), c = r['StatefulPartitionedCall:0'].data;
    const nbT = Math.round(pasFen / hop) + 1;
    for (let k = 0; k < nbT; k++) {
      const fr = T - 1 - o.L - k; if (fr < 0) break;
      const tc = (fin - L0 + fr * hop) / SRB; let mx = 0, im = -1; for (let q = lo; q <= hi; q++) { const v = c[fr * nb + q]; if (v > mx) { mx = v; im = q; } }
      if (im >= 0) { const a1 = c[fr * nb + im - 1] || 0, a2 = c[fr * nb + im + 1] || 0, w = a1 + mx + a2, ic = im + (a2 - a1) / w; f.set(Math.round(tc / .02), { midi: hzMidi(base * Math.pow(2, ic / 36)), conf: echelle(mx, o.s) }); }
    }
  }
  const retard = o.tous + o.L * hop / SRB + hop / SRB;
  return { retard, lit: t => { const v = f.get(Math.round((t - retard) / .02)); return v && v.conf > 0 ? v : null; } };
}

const CAND = {
  mpm: null,
  swift10k1: y => suitSwift(y, { L: 10, k: 1, s: .5 }),
  swift4k2: y => suitSwift(y, { L: 4, k: 2, s: .5 }),
  swift2k2: y => suitSwift(y, { L: 2, k: 2, s: .35 }),
  'swift2k2.agc': y => suitSwift(y, { L: 2, k: 2, s: .35, agc: 64, pic: .05 }),
  crepe: y => suitCrepe(y, { s: .5 }),
  basicpitch: (y, x) => suitBasicPitch(x, { L: 4, tous: .24, s: .3 })
};
const FOURNI = JSON.parse(opt('--def') || '{}'); // essais au réglage : {"nom":{"L":3,"k":2,"s":.4,"agc":64,"pic":.05}}
for (const n in FOURNI) CAND[n] = y => suitSwift(y, FOURNI[n]);

/* Remplace MPM par le modèle, le reste de _analyse ne change pas : raies de secteur, sons graves purs, niveau. Le niveau est relu au même centre que la hauteur. */
function brancher(m, det) {
  const dec = Math.max(0, Math.round((det.retard - MPM_RETARD) / .02)), hr = [], hc = [];
  m._analyse = function (t) {
    const w = this.fenetre, tb = this.tampon, d = this.nTampon; let e = 0, ed = 0;
    for (let j = 0; j < N; j++) { const v = tb[(d + j) % N]; w[j] = v; e += v * v; if (j) { const q = w[j] - w[j - 1]; ed += q * q; } }
    hr.push(Math.sqrt(e / N)); hc.push(e > 0 ? SR / (2 * Math.PI) * Math.sqrt(ed / e) : 0);
    const i = Math.max(0, hr.length - 1 - dec), rms = hr[i], cent = hc[i], p = det.lit(t);
    let ok = !!p; if (ok) { const f = 440 * Math.pow(2, (p.midi - 69) / 12); ok = f > 70 && f < 1100; if (ok && this.rf.lignes.some(g => Math.abs(12 * Math.log2(f / g)) < .5)) ok = false; if (ok && f < this.P.pureMax && cent < this.P.pureRap * f) ok = false; }
    this.hauteur(t, ok ? p.midi : null, ok ? p.conf : 0, rms);
  };
}
const decime = x48 => new GP.Moteur({ sr: 48000 }).dec(x48);

/* Notes justes : part du temps de chaque note de la vérité où le moteur tient la bonne classe, et part du temps de note du moteur sans vérité dessous (fausses). */
function notesJustes(c, notes, retard) {
  let tv = 0, ok = 0, tn = 0, faux = 0; const v = c.notes;
  for (const n of v) { tv += n.dur; for (const e of notes) { const a = Math.max(n.start, e.debut - retard), b = Math.min(n.start + n.dur, e.fin - retard); if (b > a && GP.mod(e.midi - n.midi) === 0) ok += b - a; } }
  for (const e of notes) { const d = e.fin - e.debut; tn += d; let bon = 0; for (const n of v) { const a = Math.max(n.start, e.debut - retard), b = Math.min(n.start + n.dur, e.fin - retard); if (b > a && GP.mod(e.midi - n.midi) === 0) bon += b - a; } faux += Math.max(0, d - bon); }
  return { tv, ok, tn, faux };
}

async function scene(nomC, nomS, graine, idx) {
  const c = chantDe(graine, nomS, idx), x = rendre(nomS, idx, graine, c), f = CAND[nomC], det = f ? await f(decime(x), x) : null, notes = [];
  const log = executer(c, { x, prepare: m => { m.on('note', e => notes.push(e)); if (det) brancher(m, det); } }, 'base', {});
  assert(notes.length, `aucune note : ${nomC}, ${nomS}, chant ${idx}`);
  const r = metriques(c, log), nj = notesJustes(c, notes, det ? det.retard : MPM_RETARD);
  return { ...r, nj };
}
const SCENES_IA = ['simple, studio', 'RMS .002', 'RMS .005', 'simple, salle', 'église 3 m', 'vocalises, salle', 'piano 0 dB', 'piano +6 dB', 'piano +12 dB'];
SCENES['église 3 m'] = { style: 'simple', sc: { bruit: { snr: 12 }, reverb: { rt60: 1.8, drr: -6 } }, rms: .02 };

async function synthetique(nomC, partie, filtre) {
  const P = { reglage: { graine: 1, idx: CORPUS.map((_, i) => i).filter(i => i % 2 === 0) }, controle: { graine: 2, idx: CORPUS.map((_, i) => i).filter(i => i % 2 === 1) } }[partie], out = {};
  for (const s of SCENES_IA.filter(n => !filtre || new RegExp(filtre).test(n))) {
    const l = []; for (const idx of P.idx) l.push(await scene(nomC, s, P.graine, idx));
    const u = cumule(l), tv = l.reduce((a, r) => a + r.nj.tv, 0), ok = l.reduce((a, r) => a + r.nj.ok, 0), tn = l.reduce((a, r) => a + r.nj.tn, 0), fx = l.reduce((a, r) => a + r.nj.faux, 0);
    out[s] = { notesJustes: 100 * ok / tv, tempsFaux: 100 * fx / Math.max(tn, 1e-9), ton: u.tempsJuste, verrou: u.lock, premier: u.lockOk, sansTon: u.sansTon, couv: u.couv, couvP1: u.couvP1, couvRep: u.couvRep, lat: 1000 * u.latMed, latP90: 1000 * u.latP90, t300: u.a300, manques: u.rates, fausses: u.fausses };
    console.log(nomC.padEnd(14), s.padEnd(18), `notes ${out[s].notesJustes.toFixed(1)} %, faux ${out[s].tempsFaux.toFixed(1)} %, ton ${out[s].ton.toFixed(0)} %, verrou ${u.lock.toFixed(1)} s, 1er ${u.lockOk.toFixed(0)} %, couv ${u.couv.toFixed(0)} %, 1re passe ${u.couvP1.toFixed(0)} %, reprise ${u.couvRep.toFixed(0)} %, lat ${out[s].lat.toFixed(0)} ms, T+300 ${u.a300.toFixed(0)} %, fausses ${u.fausses}`);
  }
  return out;
}

async function vraieVoix(nomC) {
  const b = fs.readFileSync(PCM), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), f = CAND[nomC], det = f ? await f(decime(x), x) : null;
  const hyp = [], r = ecouter(x, 48000, {}, m => { if (det) brancher(m, det); m.on('tonaliteHypotheses', e => hyp.push({ t: m.tNow, liste: e.liste })); });
  const bb = bilan(r), v = verite(r);
  const rec = new GP.Reconnaissance({ chants: [...lireCorpus(), ...(GP.baseHymnes || [])] }), reconnus = [], perdus = []; rec.on('chantReconnu', e => reconnus.push(e)).on('chantPerdu', e => perdus.push(e));
  r.ev.note.forEach(n => rec.note(n));
  // Part du temps où Do♯ majeur figure dans les hypothèses affichées, avant la première tonalité sûre.
  let dsH = 0, tot = 0; hyp.forEach((h, i) => { const fin = i + 1 < hyp.length ? hyp[i + 1].t : r.m.tNow, d = fin - h.t; tot += d; if (h.liste.some(k => k.tonic === 1 && k.mode === 'maj')) dsH += d; });
  const nom = k => GP.nomNote(k.tonic, k) + (k.mode === 'maj' ? ' maj' : ' min'), premHyp = hyp.find(h => h.t >= 5);
  const res = { premier: bb.premier, tons: bb.tons.map(k => `${k.nom} (${k.t.toFixed(1)} s)`).join(' > '), hypotheses5s: premHyp ? premHyp.liste.map(k => `${nom(k)} ${k.p.toFixed(2)}`).join(', ') : '', hypDoD: tot ? 100 * dsH / tot : 0, brefs: bb.brefs, notes: bb.notes, durMed: 1000 * bb.durMed, octMin: bb.octMin, phrases: bb.phrases, accMin: bb.accMin, refMin: bb.refMin, cases: bb.cases, gamme: v.gamme, ton: v.ton, reconnu: reconnus.map(e => `${e.titre} à ${e.t.toFixed(1)} s, tonique ${GP.nomNote(e.tonique)}`).join(' ; ') || 'non', perdus: perdus.length, retard: det ? 1000 * det.retard : 21 };
  console.log(nomC.padEnd(14), JSON.stringify(res));
  return res;
}

async function silences(nomC) {
  const f = CAND[nomC], out = {}; let notes = 0, accords = 0, cases = 0, trames = 0;
  for (const n in silence.SCENES) {
    const { x, fin } = silence.SCENES[n](), det = f ? await f(x, f.length > 1 ? reechantillonne(x, SR, 48000) : x) : null, m = new GP.Moteur({ sr: SR }), apres = fin + .05 + (det ? det.retard : 0); if (det) brancher(m, det);
    const r = { notes: 0, accords: 0, trames: 0 }; let t = 0;
    m.on('note', e => { if (e.debut >= apres) r.notes++; }).on('accord', () => { if (t >= apres) r.accords++; }).on('niveau', e => { if (e.signal && t >= apres) r.trames++; });
    for (let i = 0; i < x.length; i += 320) { const b = x.subarray(i, Math.min(x.length, i + 320)); t = (i + b.length) / SR; m.trame(b, t); }
    r.cases = m.grille.filter(c => c.t >= apres).length; out[n] = r; notes += r.notes; accords += r.accords; cases += r.cases; trames += r.trames;
  }
  console.log(nomC.padEnd(14), 'silence', JSON.stringify({ notes, accords, cases, trames, detail: Object.fromEntries(Object.entries(out).filter(([, r]) => r.notes || r.accords || r.cases).map(([n, r]) => [n, r])) }));
  return { notes, accords, cases, trames, detail: out };
}

/* Coût en navigateur, un seul fil, avec ralentissement CDP. Ce n'est pas un vrai téléphone : le ralentissement ne reproduit ni le cache, ni la mémoire, ni la chauffe. */
const PAGE_COUT = `<!doctype html><meta charset=utf-8><body><script src=/projet/js/theorie.js></script><script src=/projet/js/moteur.js></script><script src=/ia/rt-ort/node_modules/onnxruntime-web/dist/ort.wasm.min.js></script><script src=/ia/rt-tfjs/node_modules/@tensorflow/tfjs/dist/tf.min.js></script><script src=/ia/rt-tfjs/node_modules/@tensorflow/tfjs-backend-wasm/dist/tf-backend-wasm.min.js></script><script>
const stats=(l,sec)=>{const s=[...l].sort((a,b)=>a-b),z=l.reduce((a,b)=>a+b,0);return{appels:l.length,p50:+s[s.length>>1].toFixed(2),p95:+s[Math.floor(s.length*.95)].toFixed(2),max:+s[s.length-1].toFixed(2),msParSeconde:+(z/sec).toFixed(1)}};
window.prepa=async()=>{
  const b=await(await fetch('/pcm')).arrayBuffer();window.x=new Float32Array(b);window.y=new GP.Moteur({sr:48000}).dec(x);
  ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths='/ia/rt-ort/node_modules/onnxruntime-web/dist/';
  const t0=performance.now();window.sw=await ort.InferenceSession.create('/ia/dl-swiftf0/model.onnx',{executionProviders:['wasm']});const t1=performance.now();
  window.bp=await ort.InferenceSession.create('/ia/dl-basicpitch/nmp.onnx',{executionProviders:['wasm']});const t2=performance.now();
  tf.wasm.setWasmPaths('/ia/rt-tfjs/node_modules/@tensorflow/tfjs-backend-wasm/dist/');await tf.setBackend('wasm');await tf.ready();
  const a=await(await fetch('/ia/dl-crepe/model/model.json')).json();
  const buf=await Promise.all(a.weightsManifest.flatMap(g=>g.paths).map(p=>fetch('/ia/dl-crepe/model/'+p).then(r=>r.arrayBuffer())));const tot=new Uint8Array(buf.reduce((n,c)=>n+c.byteLength,0));let o=0;for(const c of buf){tot.set(new Uint8Array(c),o);o+=c.byteLength;}
  window.cr=await tf.loadLayersModel({load:async()=>({modelTopology:a.modelTopology.model_config||a.modelTopology,weightSpecs:a.weightsManifest.flatMap(g=>g.weights),weightData:tot.buffer})});
  return{swiftCharge:+(t1-t0).toFixed(0),bpCharge:+(t2-t1).toFixed(0),simd:tf.env().getBool('WASM_HAS_SIMD_SUPPORT'),secondes:y.length/16000};
};
window.moteurSeul=async()=>{const m=new GP.Moteur({sr:48000}),l=[],P=960,N=Math.min(x.length,30*48000);for(let i=0;i<N;i+=P){const f=x.subarray(i,i+P),a=performance.now();m.trame(f,(i+f.length)/48000);l.push(performance.now()-a);}return stats(l,N/48000)};
window.moteurSansMpm=async()=>{const m=new GP.Moteur({sr:48000}),l=[],P=960,N=Math.min(x.length,30*48000);m._analyse=function(t){const w=this.fenetre,tb=this.tampon,d=this.nTampon;let e=0;for(let j=0;j<683;j++){const v=tb[(d+j)%683];w[j]=v;e+=v*v}this.hauteur(t,null,0,Math.sqrt(e/683))};for(let i=0;i<N;i+=P){const f=x.subarray(i,i+P),a=performance.now();m.trame(f,(i+f.length)/48000);l.push(performance.now()-a);}return stats(l,N/48000)};
window.swift=async(L,k,sec=15,g=12)=>{const H=256,W=g+L+k,n=Math.min(Math.floor(y.length/H),Math.floor(sec*16000/H)),l=[],fmin=new ort.Tensor('float32',[70],[]),fmax=new ort.Tensor('float32',[1100],[]);for(let e=W;e<=n;e+=k){const b=y.slice((e-W)*H,e*H),a=performance.now();await sw.run({audio:new ort.Tensor('float32',b,[1,b.length]),fmin,fmax});l.push(performance.now()-a);}return stats(l,(n-W)*H/16000)};
window.crepe=async(sec=10)=>{const F=new Float32Array(1024),l=[],P=320,n=Math.floor(sec*16000/P);for(let j=4;j<n;j++){const fin=(j+1)*P;let m=0,e=0;const a=performance.now();for(let i=0;i<1024;i++){F[i]=y[fin-1024+i];m+=F[i]}m/=1024;for(let i=0;i<1024;i++){F[i]-=m;e+=F[i]*F[i]}const sd=Math.sqrt(e/1024)||1;for(let i=0;i<1024;i++)F[i]/=sd;tf.tidy(()=>cr.predict(tf.tensor2d(F,[1,1024])).dataSync());l.push(performance.now()-a);}return stats(l,sec)};
window.bpitch=async(tous=.24,sec=10)=>{const L0=43844,z=new Float32Array(L0),l=[],pas=Math.round(tous*22050),N=Math.floor(sec*22050);const R=16000/22050;for(let fin=L0;fin<N+L0;fin+=pas){for(let i=0;i<L0;i++)z[i]=y[Math.floor((fin-L0+i)*R)]||0;const a=performance.now();await bp.run({'serving_default_input_2:0':new ort.Tensor('float32',z,[1,L0,1])});l.push(performance.now()-a);}return stats(l,sec)};
</script>`;
async function cout() {
  const http = require('http'), os = require('os'), { spawn } = require('child_process'), RACINE = path.join(__dirname, '..', '..');
  const nav = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
  const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.json': 'application/json' };
  const srv = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (u === '/') return r.writeHead(200, { 'content-type': 'text/html' }).end(PAGE_COUT);
    if (u === '/pcm') return r.end(fs.readFileSync(PCM));
    const f = u.startsWith('/ia/') ? path.join(IA, u.slice(4)) : u.startsWith('/projet/') ? path.join(RACINE, u.slice(8)) : null;
    if (!f || !fs.existsSync(f)) return r.writeHead(404).end();
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const dos = fs.mkdtempSync(path.join(os.tmpdir(), 'cout-')), port = srv.address().port, nv = spawn(nav, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + dos, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  const fini = () => { nv.kill(); srv.close(); };
  try {
    let portD = null; for (let i = 0; i < 100 && !portD; i++) { await new Promise(o => setTimeout(o, 100)); try { portD = fs.readFileSync(path.join(dos, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) { /* pas encore */ } }
    const cibles = await (await fetch(`http://127.0.0.1:${portD}/json`)).json(), ws = new WebSocket(cibles.find(c => c.type === 'page').webSocketDebuggerUrl); await new Promise(o => { ws.onopen = o; });
    let id = 0; const att = new Map(); ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && att.has(d.id)) { att.get(d.id)(d); att.delete(d.id); } };
    const cdp = (method, params = {}) => new Promise(o => { const i = ++id; att.set(i, o); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async js => { const r = await cdp('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result.value; };
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await new Promise(o => setTimeout(o, 1500));
    const res = { prepa: await ev('prepa()') }; console.log(JSON.stringify(res.prepa));
    const essais = JSON.parse(opt('--essais') || '{"moteurSeul":"moteurSeul()","moteurSansMpm":"moteurSansMpm()","swift L4 k2":"swift(4,2)","swift L2 k2":"swift(2,2)","swift L1 k2":"swift(1,2)","swift L4 k1":"swift(4,1)","swift L10 k1":"swift(10,1)","crepe tiny 20 ms":"crepe()","crepe tiny 40 ms":"crepe().then(s=>({...s,msParSeconde:+(s.msParSeconde/2).toFixed(1),note:\'la moitie des trames\'}))","basic pitch 240 ms":"bpitch(.24)"}');
    for (const rate of [1, 4, 6]) {
      await cdp('Emulation.setCPUThrottlingRate', { rate });
      for (const n in essais) { const s = await ev(essais[n]); res[`x${rate} ${n}`] = s; console.log(`x${rate}`.padEnd(4), n.padEnd(20), JSON.stringify(s)); }
    }
    const ep = opt('--sortie'); if (ep) fs.writeFileSync(ep, JSON.stringify(res, null, 1));
  } finally { fini(); }
}

module.exports = { CAND, brancher }; // vraies-voix-libres.js réutilise les mêmes oreilles
if (require.main === module) (async () => {
  assert(IA, '--ia : dossier des modèles');
  if (A.includes('--cout')) return cout();
  const noms = (opt('--candidats') || 'mpm').split(','), partie = opt('--partie'), res = {}, sortie = opt('--sortie');
  for (const c of noms) {
    res[c] = {};
    if (A.includes('--voix')) res[c].voix = await vraieVoix(c);
    if (A.includes('--silence')) res[c].silence = await silences(c);
    if (partie) res[c][partie] = await synthetique(c, partie, opt('--scene'));
  }
  if (sortie) fs.writeFileSync(sortie, JSON.stringify(res, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
