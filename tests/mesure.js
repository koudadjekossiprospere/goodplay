'use strict';
/* Banc unique de goodplay : exerce le vrai GP.Moteur sur des signaux audio synthétiques à vérité connue.
   node tests/mesure.js            tout (réglage : chants pairs, graine 1 ; contrôle : chants impairs, graine 2)
   node tests/mesure.js --rapide   sous-ensemble, pour vérifier que le banc tourne
   node tests/mesure.js --pairs    réglage seulement : c'est le seul mode à utiliser pour régler le moteur
   Options : --trames (rejoue les trames de hauteur gardées en cache au lieu de refaire l'audio), --scene texte, --params '{"cout":1}'
   Limite : voix synthétique et réverbération modélisée. Les écarts sont solides, les valeurs absolues optimistes. */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), os = require('os'), path = require('path');
const { synth, chantCorpus, ornemente, lireCorpus, pianoDe, mod12, alea, gauss } = require('./banc/synth.js');
const { creeMoteurActuel } = require('./banc/moteur-actuel.js');
require('../js/theorie.js'); require('../js/moteur.js');
const GP = globalThis.GP;

const STUDIO = { bruit: { snr: 35 } }, SALLE = { bruit: { snr: 20 }, reverb: { rt60: 1.2, drr: -3 } };
const REPRISE = ['base', 'sansMem', 'correction', 'tape'];
const SCENES = {
  'simple, studio': { style: 'simple', sc: STUDIO, var: [...REPRISE, 'actuel'] },
  'simple, salle': { style: 'simple', sc: SALLE, var: [...REPRISE, 'actuel'] },
  'vocalises, studio': { style: 'vocalises', sc: STUDIO },
  'vocalises, salle': { style: 'vocalises', sc: SALLE, var: ['base', 'correction'] },
  'vocalises et notes bleues, salle': { style: 'vocalises', pBlue: .1, sc: SALLE },
  'simple, 4 couplets, salle': { style: 'simple', couplets: 4, sc: SALLE },
  'rubato 8 %, salle': { style: 'simple', rubato: .08, sc: SALLE, var: ['base', 'tape'] },
  'voix grave, studio': { style: 'simple', grave: true, sc: STUDIO },
  'accordage +40 c': { style: 'simple', sc: { ...STUDIO, accordage: { cents: 40 } } },
  '+40 c et 1 c/s': { style: 'simple', sc: { ...STUDIO, accordage: { cents: 40, parSec: 1 } } },
  'vocalises, +40 c et 1 c/s, salle': { style: 'vocalises', sc: { ...SALLE, accordage: { cents: 40, parSec: 1 } } },
  'choeur 5 voix, salle': { style: 'simple', sc: { ...SALLE, choeur: { n: 5, detune: 12 } } },
  'choeur, vocalises, -35 c, salle': { style: 'vocalises', sc: { ...SALLE, choeur: { n: 5, detune: 12 }, accordage: { cents: -35 } } },
  'piano 0 dB': { style: 'simple', sc: { bruit: { snr: 30 } }, piano: 0, var: ['sansContre', 'base', 'piano'] },
  'piano +6 dB': { style: 'simple', sc: { bruit: { snr: 30 } }, piano: 6, var: ['sansContre', 'base', 'piano', 'basse'] },
  'piano +12 dB': { style: 'simple', sc: { bruit: { snr: 30 } }, piano: 12, var: ['sansContre', 'base', 'piano'] },
  'piano +6 dB, voix grave': { style: 'simple', grave: true, sc: { bruit: { snr: 30 } }, piano: 6, var: ['sansContre', 'base', 'piano'] },
  'annonces vocales': { style: 'simple', sc: { bruit: { snr: 30 } }, annonces: true },
  'RMS .002': { style: 'simple', sc: { bruit: { snr: 25 } }, rms: .002 },
  'RMS .005': { style: 'simple', sc: { bruit: { snr: 25 } }, rms: .005 },
  'RMS .01': { style: 'simple', sc: { bruit: { snr: 25 } }, rms: .01 },
  'RMS .03': { style: 'simple', sc: { bruit: { snr: 25 } }, rms: .03 },
  'modulation +2, salle': { style: 'simple', sc: SALLE, mod: { demi: 2 } },
  'modulation +1, salle': { style: 'simple', sc: SALLE, mod: { demi: 1 } },
  'modulation +5, salle': { style: 'simple', sc: SALLE, mod: { demi: 5 } }
};
const CORPUS = lireCorpus();
const CACHE = path.join(os.tmpdir(), 'goodplay-mesure-' + fs.statSync(path.join(__dirname, 'corpus', 'chants.json')).size);

/* Chaque chant du corpus transposé selon la graine, en voix de femme (pairs) ou d'homme (impairs). */
function chantDe(graine, nomScene, i) {
  const s = SCENES[nomScene], e = CORPUS[i], tr = ((graine * 5 + i * 7) % 12) - 5, ns = e.notes.filter(n => n[0] != null), moyenne = ns.reduce((a, n) => a + n[0], 0) / ns.length;
  let octave = i % 2 ? (moyenne + tr > 60 ? -12 : 0) : (moyenne + tr < 60 ? 12 : 0);
  if (s.grave) octave = -12 * Math.round((moyenne + tr - 53) / 12);
  let c = chantCorpus(e, { transpose: tr + octave, couplets: s.couplets || (s.mod ? 3 : 2), modulation: s.mod ? { couplet: 2, demi: s.mod.demi } : undefined, rubato: s.rubato, graine: graine + i });
  if (s.style === 'vocalises') c = ornemente(c, { graine: graine + i, pBlue: s.pBlue });
  return c;
}
function rendre(nomScene, i, graine, c) {
  const s = SCENES[nomScene], o = { sr: 48000, rms: s.rms ?? .03, graine: graine + i * 7 + 1, duree: c.duree + 1, ...s.sc };
  if (s.piano != null) o.piano = { accords: pianoDe(c), db: s.piano };
  if (s.annonces) o.annonces = c.accords.filter((a, j) => j === 0 || a.root !== c.accords[j - 1].root).map(a => ({ start: a.start + .9, dur: .55 }));
  return synth(c.notes, o).x;
}

/* Fait tourner le moteur sur l'audio (x) ou sur des trames déjà calculées, et note ce que le pianiste voit à chaque instant. */
function executer(c, source, variante, params) { // source.prepare(m) : compare-ia y branche un autre détecteur
  const V = { sansMem: { memoire: false }, sansContre: { basseAbs: 0, clarteSure: 0 }, piano: { clarteSuggeree: .95 } }[variante] || {}, reglages = { params: { ...params, ...V } };
  if (variante === 'basse') reglages.basseReelle = true;
  const m = new GP.Moteur({ sr: source.x ? 48000 : 16000, reglages });
  const log = { keys: [], chords: [], notes: 0, trames: [], grille: m.grille, tempo8: null, corrigees: 0, corrPost: 0, lettres: [] };
  if (source.prepare) source.prepare(m);
  let now = 0, dernierAffiche = null;
  const affiche = (root, q) => { if (dernierAffiche !== root + q) { log.chords.push({ t: now, root, q }); dernierAffiche = root + q; } };
  m.on('tonalite', k => { const l = log.keys[log.keys.length - 1]; if (!l || l.tonic !== k.tonic || l.mode !== k.mode) log.keys.push({ t: now, tonic: k.tonic, mode: k.mode, isMod: k.modulation, correction: !!k.correction, delaiPreuve: k.correction ? m.delaiCorrection : null }); });
  m.on('accord', a => { affiche(a.racine, a.q); if (variante === 'piano') m.notesSuggerees([...GP.notesAccord(a.racine, a.q)]); });
  m.on('accordCorrige', a => { if (!a.parMusicien && !a.mots) log.corrPost++; if (a.index === m.grille.length - 1) affiche(a.accord.racine, a.accord.q); });
  m.on('grilleRefaite', () => { const l = m.grille[m.grille.length - 1]; if (l) affiche(l.racine, l.q); });
  m.on('note', () => { log.notes++; });
  m.on('phrase', p => { if (p.lettre) log.lettres.push(p.lettre); });
  m.on('tempo', e => { if (now <= 8) log.tempo8 = e.bpm; if (e.tape) log.bpmTape = e.bpm; });
  log.temps = []; m.on('temps', e => log.temps.push(e.t));
  // Le pianiste simulé corrige toute la grille juste avant la reprise.
  const avant = c.accords.find(a => a.section === 1), tCorr = variante === 'correction' && avant ? avant.start - .5 : Infinity; let corrFaite = false;
  const r = alea(97), taps = [];
  if (variante === 'tape') { const n0 = c.notes[0].start; for (let i = 0; i < 8; i++) taps.push(n0 + i * c.bt + gauss(r) * .02); if (avant) for (let i = 0; i < 4; i++) taps.push(avant.start + i * c.bt + gauss(r) * .02); }
  const pilote = t => {
    now = t;
    while (taps.length && taps[0] <= t) m.taperTempo(taps.shift());
    if (!corrFaite && t >= tCorr) { corrFaite = true; log.corrigees = corrigerTout(m, c); }
  };
  if (source.x) {
    const pas = 960, x = source.x, avantH = m.hauteur.bind(m);
    if (source.garde) m.hauteur = (t, md, cf, rms) => { log.trames.push([+t.toFixed(4), md == null ? null : +md.toFixed(3), +cf.toFixed(3), +rms.toFixed(5)]); avantH(t, md, cf, rms); };
    for (let i = 0; i < x.length; i += pas) { const f = x.subarray(i, Math.min(x.length, i + pas)), t = (i + f.length) / 48000; pilote(t); m.trame(f, t); }
  } else for (const [t, md, cf, rms] of source.tr) { pilote(t); m.hauteur(t, md, cf, rms); }
  log.grille = m.grille; log.fin = now;
  return log;
}
/* Pour chaque case, ce que corrigerait le pianiste : le degré de la vérité au milieu de la case, si la tonalité le permet. */
function corrigerTout(m, c) {
  let n = 0;
  m.grille.forEach((g, i) => {
    const mid = g.t + g.dur / 2, a = c.accords.find(x => mid >= x.start && mid < x.start + x.dur);
    if (!a || (g.racine === a.root && g.q === a.q)) return;
    const d = Object.keys(GP.DEGRES[g.ton.mode]).find(de => { const z = GP.accordDeDegre(g.ton, +de); return z.racine === a.root && z.q === a.q; });
    if (d) { m.corriger(i, +d); n++; }
  });
  return n;
}

/* ---------- Métriques ---------- */
const memeAccord = (d, a) => d && d.root === a.root && d.q === a.q;
const afficheA = (ch, t) => { let d = null; for (const e of ch) { if (e.t > t) break; d = e; } return d; };
function metriques(c, log) {
  const tv = t => { let k = c.tonalites[0]; for (const x of c.tonalites) if (x.t <= t) k = x; return k; };
  const keys = log.keys, mods = keys.filter(k => k.isMod), lock = keys.length ? keys[0].t : null;
  const r = { mode: c.mode, n: 1, notes: log.notes, lock, lockOk: 0, corrections: keys.filter(k => k.correction).length, fausses: 0, tempsJuste: 0, tempsTotal: 0, modVraie: null, chg: 0, a300: 0, rates: 0, latences: [], couv: 0, couvTot: 0, couvP1: 0, totP1: 0, p1d0: 0, totd0: 0, couvRep: 0, totRep: 0, chgRep: 0, avantRep: 0, a300Rep: 0, finale: 0, finaleTot: 0, corrPost: log.corrPost, corrigees: log.corrigees, tempo8: 0, ecartsTemps: [], bpmTape: log.bpmTape ? Math.abs(log.bpmTape / c.bpm - 1) : null };
  // Rattrapage : un premier verrou faux, le temps qu'il faut pour dire juste, et l'écart entre la preuve qui change et la correction.
  r.delaisPreuve = keys.filter(k => k.correction && k.delaiPreuve != null).map(k => k.delaiPreuve);
  if (keys.length) {
    const v = tv(keys[0].t); r.lockOk = keys[0].tonic === v.tonic && keys[0].mode === v.mode ? 1 : 0;
    r.relatif = GP.relatif(keys[0], v) ? 1 : 0;
    if (!r.lockOk && c.tonalites.length === 1) { const j = keys.find(k => k.tonic === v.tonic && k.mode === v.mode); r.rattrape = j ? j.t - keys[0].t : -1; }
    for (let t = lock; t < c.duree; t += .25) { let k = keys[0]; for (const x of keys) if (x.t <= t) k = x; const w = tv(t); r.tempsTotal++; if (k.tonic === w.tonic && k.mode === w.mode) r.tempsJuste++; }
    mods.forEach(m => { const w = tv(m.t); if (!(m.tonic === w.tonic && m.mode === w.mode)) r.fausses++; });
    if (c.tonalites.length > 1) { const T = c.tonalites[1], d = keys.find(k => k.t > T.t && k.tonic === T.tonic && k.mode === T.mode); r.modVraie = d ? d.t - T.t : -1; }
  }
  if (log.tempo8) { const p = 60 / log.tempo8; if (Math.min(...[.5, 1, 2, 3, 1.5].map(k => Math.abs(p / (k * c.bt) - 1))) < .04) r.tempo8 = 1; }
  const ch = log.chords, g = log.grille, acc = c.accords;
  if (log.temps && log.temps.length) acc.forEach((a, i) => { if (i && a.start > 15) r.ecartsTemps.push(Math.min(...log.temps.map(x => Math.abs(x - a.start)))); });
  acc.forEach((a, i) => {
    for (let t = a.start + .1; t < a.start + a.dur; t += .1) {
      const vu = memeAccord(afficheA(ch, t), a) ? 1 : 0;
      if (a.section === 0) { r.totd0++; r.p1d0 += vu; }
      if (keys.length && t > lock) { r.couvTot++; r.couv += vu; if (a.section === 0) { r.totP1++; r.couvP1 += vu; } else { r.totRep++; r.couvRep += vu; } }
      r.finaleTot++; const ca = g.find(x => t >= x.t && t < x.t + Math.max(x.dur, .001)) || null; if (ca && ca.racine === a.root && ca.q === a.q) r.finale++;
    }
    if (i === 0 || (a.root === acc[i - 1].root && a.q === acc[i - 1].q) || !keys.length || a.start <= lock + .5) return;
    r.chg++;
    const rep = a.section > 0; if (rep) r.chgRep++;
    if (memeAccord(afficheA(ch, a.start + .3), a)) { r.a300++; if (rep) r.a300Rep++; }
    if (rep && memeAccord(afficheA(ch, a.start - .05), a)) r.avantRep++;
    let lat = null; for (let t = a.start; t < a.start + a.dur; t += .02) if (memeAccord(afficheA(ch, t), a)) { lat = t - a.start; break; }
    if (lat == null) r.rates++; else r.latences.push(lat);
  });
  return r;
}
function metriquesActuel(c, log) { return metriques(c, { keys: log.keys.filter(k => !k.nouveauChant), chords: log.chords, grille: [], notes: log.notes.length, corrPost: 0, corrigees: 0 }); }
function cumule(l) {
  const S = k => l.reduce((a, r) => a + (r[k] || 0), 0), pc = (a, b) => b ? 100 * S(a) / S(b) : NaN, lat = l.flatMap(r => r.latences).sort((a, b) => a - b), locks = l.filter(r => r.lock != null), det = l.filter(r => r.modVraie != null), ok = det.filter(r => r.modVraie >= 0).map(r => r.modVraie).sort((a, b) => a - b);
  const med = a => a.length ? a[a.length >> 1] : NaN;
  const raf = l.filter(r => r.rattrape != null), rok = raf.filter(r => r.rattrape >= 0).map(r => r.rattrape).sort((a, b) => a - b), dp = l.flatMap(r => r.delaisPreuve || []).sort((a, b) => a - b);
  return { relatif: S('relatif'), faux: raf.length, fauxOk: rok.length, ratMed: med(rok), ratMax: rok.length ? rok[rok.length - 1] : NaN, preuveMed: med(dp), preuveMax: dp.length ? dp[dp.length - 1] : NaN, n: l.length, notes: S('notes'), sansTon: l.length - locks.length, fausses: S('fausses'), tempsJuste: pc('tempsJuste', 'tempsTotal'), lock: med(locks.map(r => r.lock).sort((a, b) => a - b)), lockOk: locks.length ? 100 * S('lockOk') / locks.length : NaN, corrections: S('corrections'), couv: pc('couv', 'couvTot'), couvP1: pc('couvP1', 'totP1'), p1d0: pc('p1d0', 'totd0'), couvRep: pc('couvRep', 'totRep'), finale: pc('finale', 'finaleTot'), latMed: med(lat), latP90: lat.length ? lat[Math.floor(lat.length * .9)] : NaN, a300: pc('a300', 'chg'), rates: pc('rates', 'chg'), avantRep: pc('avantRep', 'chgRep'), a300Rep: pc('a300Rep', 'chgRep'), det: det.length, detOk: ok.length, detMed: med(ok), corrPost: S('corrPost'), corrigees: S('corrigees'), tempo8: 100 * S('tempo8') / Math.max(1, l.length), chg: S('chg'), ecartTemps: med(l.flatMap(r => r.ecartsTemps).sort((a, b) => a - b)), bpmTape: med(l.filter(r => r.bpmTape != null).map(r => r.bpmTape).sort((a, b) => a - b)) };
}

/* ---------- Travail d'un chant ---------- */
function travail(j) {
  const s = SCENES[j.scene], c = chantDe(j.graine, j.scene, j.idx), vs = j.variantes || s.var || ['base'], out = {};
  const fic = path.join(CACHE, Buffer.from(j.scene).toString('hex').slice(0, 60) + '-' + j.idx + '-' + j.graine + '.json');
  let tr = j.trames && fs.existsSync(fic) ? JSON.parse(fs.readFileSync(fic, 'utf8')) : null, x = null;
  const audio = () => { if (!x) x = rendre(j.scene, j.idx, j.graine, c); return x; };
  if (!tr) {
    const log = executer(c, { x: audio(), garde: true }, 'base', j.params); tr = log.trames;
    assertSignal(j, log); out.base = metriques(c, log);
    if (j.trames) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(fic, JSON.stringify(tr)); }
  }
  for (const v of vs) {
    if (out[v]) continue;
    if (v === 'actuel') { const lg = creeMoteurActuel(48000).rejoue(audio()); out.actuel = metriquesActuel(c, lg); continue; }
    if (v === 'basse') { out.basse = metriques(c, executer(c, { x: audio() }, 'basse', j.params)); continue; }
    out[v] = metriques(c, executer(c, { tr }, v, j.params));
  }
  return out;
}
/* Contrôle anti-faux chiffres : un chant muet ou sans note ne doit pas se glisser dans une moyenne. */
function assertSignal(j, log) { if (!log.notes) throw new Error(`aucune note entendue : ${j.scene}, chant ${j.idx}`); if (!log.trames.length) throw new Error('aucune trame'); }

/* ---------- Impression ---------- */
const f = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '-';
const COL = [['fausses', 'fausses', 3, s => s.fausses], ['ton %', 'ton', 5, s => f(s.tempsJuste)], ['verrou', 'lock', 6, s => f(s.lock, 1)], ['1er ok', 'lockOk', 6, s => f(s.lockOk)], ['corr', 'c', 4, s => s.corrections], ['couv', 'couv', 4, s => f(s.couv)], ['1re p', 'p1', 5, s => f(s.couvP1)], ['repr', 'r', 4, s => f(s.couvRep)], ['finale', 'fi', 6, s => f(s.finale)], ['lat ms', 'l', 6, s => f(1000 * s.latMed)], ['p90 ms', 'p', 6, s => f(1000 * s.latP90)], ['T+300', 't', 5, s => f(s.a300)], ['manq', 'm', 4, s => f(s.rates)], ['mod', 'mod', 5, s => s.det ? `${s.detOk}/${s.det}` : ''], ['délai', 'dl', 5, s => s.det ? f(s.detMed, 1) : '']];
const ligne = (nom, s) => nom.padEnd(44) + COL.map(([, , w, fn]) => String(fn(s)).padStart(Math.max(w, 0) + 1)).join('') + (s.sansTon ? `  sans ton ${s.sansTon}` : '');
const entete = () => ''.padEnd(44) + COL.map(([t, , w]) => t.padStart(Math.max(w, t.length) + 1).slice(-(w + 1))).join('');

async function pool(jobs) {
  const res = [], nb = Math.max(1, Math.min(os.cpus().length - 1, jobs.length)), wks = []; let i = 0, fait = 0;
  await new Promise((ok, ko) => {
    for (let w = 0; w < nb; w++) {
      const wk = new Worker(__filename, { workerData: { travailleur: true } }); wks.push(wk);
      const suite = () => { if (i < jobs.length) wk.postMessage({ n: i, j: jobs[i++] }); };
      wk.on('message', m => { res[m.n] = m.r; if (++fait === jobs.length) ok(); else suite(); });
      wk.on('error', ko);
      suite();
    }
  });
  wks.forEach(w => w.terminate());
  return res;
}

async function main() {
  const A = process.argv.slice(2), rapide = A.includes('--rapide'), pairsSeuls = A.includes('--pairs'), trames = A.includes('--trames'), ixS = A.indexOf('--scene'), filtre = ixS >= 0 ? A[ixS + 1] : null, ixP = A.indexOf('--params'), params = ixP >= 0 ? JSON.parse(A[ixP + 1]) : {};
  const t0 = Date.now();
  let scenes = Object.keys(SCENES); if (filtre) scenes = scenes.filter(s => s.includes(filtre));
  if (rapide) scenes = ['simple, studio', 'simple, salle', 'modulation +2, salle'];
  const IDX = [...CORPUS.keys()], parties = { reglage: { graine: 1, idx: IDX.filter(i => i % 2 === 0) }, controle: { graine: 2, idx: IDX.filter(i => i % 2 === 1) } };
  if (rapide) { parties.reglage.idx = [0, 12]; parties.controle.idx = [1, 11]; }
  if (pairsSeuls) delete parties.controle;
  const ixG = A.indexOf('--graine'); if (ixG >= 0) { delete parties.reglage; parties.controle = { graine: +A[ixG + 1], idx: IDX }; } // graine neuve sur tous les chants : contrôle de plus, jamais pour régler
  const jobs = []; for (const nom in parties) for (const s of scenes) for (const idx of parties[nom].idx) jobs.push({ partie: nom, scene: s, idx, graine: parties[nom].graine, trames, params, variantes: rapide ? ['base', 'sansMem', 'correction', 'actuel'].filter(v => (SCENES[s].var || ['base']).includes(v)) : null });
  const res = await pool(jobs);
  const par = {}; jobs.forEach((j, n) => { for (const v in res[n]) { const k = j.partie + '|' + j.scene + '|' + v; (par[k] = par[k] || []).push({ ...res[n][v], idx: j.idx }); } });
  const S = (p, s, v = 'base') => par[`${p}|${s}|${v}`] ? cumule(par[`${p}|${s}|${v}`]) : null;
  const NOM = { reglage: 'RÉGLAGE, chants pairs, graine 1', controle: ixG >= 0 ? `CONTRÔLE DE PLUS, tous les chants, graine ${A[ixG + 1]}` : 'CONTRÔLE, chants impairs, graine 2' };
  for (const p in parties) {
    console.log(`\n==== ${NOM[p]} (${parties[p].idx.length} chants) ====\n${entete()}`);
    for (const s of scenes) for (const v of (SCENES[s].var || ['base'])) { const c = S(p, s, v); if (c) console.log(ligne(`${s}${v === 'base' ? '' : ' [' + v + ']'}`, c)); }
    const tout = scenes.flatMap(s => par[`${p}|${s}|base`] || []), fm = tout.reduce((a, r) => a + r.fausses, 0), rendus = tout.length;
    const parMode = m => cumule(tout.filter(r => r.mode === m && !r.modVraie));
    for (const s of [...scenes.filter(x => /^(simple, studio|simple, salle|vocalises, salle)$/.test(x)), null]) { const c = s ? S(p, s) : cumule(tout); console.log(`Rattrapage, ${s || 'toutes scènes'} : premiers verrous faux ${c.faux}/${c.n} (dont relatif ${c.relatif}), rattrapés ${c.fauxOk}, en ${f(c.ratMed, 1)} s (médiane), ${f(c.ratMax, 1)} s (max) ; ${c.corrections} corrections, ${f(c.preuveMed, 1)} s après que la preuve a changé (médiane), ${f(c.preuveMax, 1)} s (max)`); }
    console.log(`\nFausses modulations, toutes scènes : ${fm} sur ${rendus} rendus`);
    if (tout.length) for (const m of ['maj', 'min']) { const c = parMode(m); console.log(`  ${m} : ton juste ${f(c.tempsJuste)} %, couverture ${f(c.couv)} %, grille finale ${f(c.finale)} %`); }
    const reprise = (s, v) => { const c = S(p, s, v); return c ? `1re passe ${f(c.couvP1)} %, reprise ${f(c.couvRep)} %, juste 50 ms avant le temps ${f(c.avantRep)} %, T+300 ${f(c.a300Rep)} %, grille finale ${f(c.finale)} %` : ''; };
    for (const s of ['simple, studio', 'simple, salle', 'vocalises, salle']) if (S(p, s)) {
      console.log(`Reprises, ${s}`);
      for (const v of ['sansMem', 'base', 'correction']) if (S(p, s, v)) console.log(`  ${({ sansMem: 'sans mémoire', base: 'mémoire', correction: 'mémoire et grille corrigée' })[v].padEnd(28)} ${reprise(s, v)}${v === 'correction' ? `  (${S(p, s, v).corrigees} cases corrigées)` : ''}`);
      const c = S(p, s, 'tape'); if (c) console.log(`  ${'tempo tapé'.padEnd(28)} ${reprise(s, 'tape')}, latence ${f(1000 * c.latMed)} ms ; écart du temps à l'accord suivant ${f(1000 * c.ecartTemps)} ms contre ${f(1000 * S(p, s).ecartTemps)} ms sans taper ; erreur de tempo ${f(100 * c.bpmTape, 1)} %`);
      const a = S(p, s, 'actuel'); if (a) console.log(`  ${'ancien moteur'.padEnd(28)} ton ${f(a.tempsJuste)} %, couverture ${f(a.couv)} %, latence ${f(1000 * a.latMed)} ms, T+300 ${f(a.a300)} %, fausses ${a.fausses}`);
      console.log(`  tempo juste à 8 s : ${f(S(p, s).tempo8)} % des chants ; corrections a posteriori : ${S(p, s).corrPost}`);
    }
    if (!rapide && (S(p, 'piano +6 dB'))) { console.log('Piano voisin : sans contre-mesure / canal de basse et clarté / plus notes suggérées'); for (const s of ['piano 0 dB', 'piano +6 dB', 'piano +12 dB', 'piano +6 dB, voix grave']) { const a = S(p, s, 'sansContre'), b = S(p, s), c = S(p, s, 'piano'); if (a && b && c) console.log(`  ${s.padEnd(24)} ton ${f(a.tempsJuste)} / ${f(b.tempsJuste)} / ${f(c.tempsJuste)} %, couverture ${f(a.couv)} / ${f(b.couv)} / ${f(c.couv)} %, verrou ${f(a.lock)} / ${f(b.lock)} / ${f(c.lock)} s, fausses ${a.fausses} / ${b.fausses} / ${c.fausses}`); } }
    if (!rapide && S(p, 'piano +6 dB', 'basse')) { const b = S(p, 'piano +6 dB', 'basse'); console.log(`Basse réelle (piano +6 dB) : couverture ${f(b.couv)} %, latence ${f(1000 * b.latMed)} ms, ton juste ${f(b.tempsJuste)} %`); }
  }
  const cible = parties.controle ? 'controle' : 'reglage', st = S(cible, 'simple, studio');
  if (!st) { console.log(`\nDurée : ${((Date.now() - t0) / 1000).toFixed(0)} s`); return; }
  const tousC = scenes.flatMap(s => par[`${cible}|${s}|base`] || []), fm = tousC.reduce((a, r) => a + r.fausses, 0), fmp = scenes.flatMap(s => (SCENES[s].var || []).includes('piano') ? par[`${cible}|${s}|piano`] || [] : []).reduce((a, r) => a + r.fausses, 0);
  const crit = [['0 fausse modulation', fm + fmp === 0, `${fm + fmp}`], ['tonalité juste >= 90 % du temps en studio', st.tempsJuste >= 90, f(st.tempsJuste, 1) + ' %'], ['latence médiane <= 150 ms', st.latMed <= .15, f(1000 * st.latMed) + ' ms'], ['couverture >= 60 % en studio, première passe', st.couvP1 >= 60, f(st.couvP1, 1) + ' %'], ['couverture reprise > première passe', st.couvRep > st.couvP1, `${f(st.couvRep, 1)} contre ${f(st.couvP1, 1)} %`]];
  console.log(`\n==== CRITÈRES sur ${cible === 'controle' ? 'le contrôle' : 'le réglage (indicatif)'}${rapide ? ', sous-ensemble --rapide (indicatif)' : ''} ====`);
  crit.forEach(([n, ok, v]) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n} : ${v}`));
  console.log(`\nDurée : ${((Date.now() - t0) / 1000).toFixed(0)} s, ${jobs.length} rendus${trames ? ', depuis les trames en cache' : ''}. Voix synthétique : valeurs absolues optimistes.`);
  return { crit };
}

module.exports = { SCENES, CORPUS, chantDe, rendre, executer, metriques, cumule, pool, CACHE };
if (!isMainThread && workerData && workerData.travailleur) {
  parentPort.on('message', ({ n, j }) => parentPort.postMessage({ n, r: travail(j) }));
} else if (isMainThread && require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
