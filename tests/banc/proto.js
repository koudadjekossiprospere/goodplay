'use strict';
/* Prototype de l'architecture recommandée, pour la mesurer sur le banc. Ce n'est pas du code de production.
   Entrée : trames (t, midi, clarté, rms) toutes les 20 ms. Sorties : log.keys, log.chords, log.notes, log.accordage. */
const mod = n => ((n % 12) + 12) % 12;
const wrap = x => x - Math.round(x);
const PROFILS = {
  KS: [[6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]],
  TKP: [[.748, .060, .488, .082, .670, .460, .096, .715, .104, .366, .057, .400], [.712, .084, .474, .618, .049, .460, .105, .747, .404, .067, .133, .330]],
  AE: [[17.7661, .145624, 14.9265, .160186, 19.8049, 11.3587, .291248, 22.062, .145624, 8.15494, .232998, 4.95122], [18.2648, .737619, 14.0499, 16.8599, .702494, 14.4362, .702494, 18.6161, 4.56621, 1.93186, 7.37619, 1.75623]],
  BB: [[16.80, .86, 12.95, 1.41, 13.49, 11.93, 1.25, 20.28, 1.80, 8.04, .62, 10.57], [18.16, .69, 12.99, 13.34, 1.07, 11.15, 1.38, 21.07, 7.49, 1.53, .92, 10.21]]
};
const GAMMES = [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10, 11]];
function logProfil(nom, plancher) { return PROFILS[nom].map(p => { const s = p.reduce((a, b) => a + b, 0), q = p.map(v => Math.max(v / s, plancher)), z = q.reduce((a, b) => a + b, 0); return q.map(v => Math.log(v / z)); }); }

const CH = { maj: [[1, 0, 'maj', 1], [2, 2, 'min', .45], [3, 4, 'min', .2], [4, 5, 'maj', .9], [5, 7, 'maj', .9], [6, 9, 'min', .6]], min: [[1, 0, 'min', 1], [3, 3, 'maj', .4], [4, 5, 'min', .8], [5, 7, 'maj', .85], [6, 8, 'maj', .6], [7, 10, 'maj', .45]] };
const FLOW = { '5>1': .5, '4>5': .3, '4>1': .3, '2>5': .5, '6>4': .3, '1>4': .25, '1>5': .25, '6>2': .25, '3>6': .3, '7>3': .3 };

/* Transitions et a priori appris sur le corpus, en excluant le chant testé (exclu) pour ne pas tricher */
function apprendTransitions(corpus, exclu) {
  const tr = { maj: {}, min: {} }, pr = { maj: {}, min: {} };
  corpus.forEach((e, i) => { if (i === exclu) return; const seq = e.basse.map(b => b[0]); seq.forEach((d, j) => { pr[e.mode][d] = (pr[e.mode][d] || 0) + e.basse[j][1]; if (j && seq[j - 1] !== d) { const a = seq[j - 1]; tr[e.mode][a] = tr[e.mode][a] || {}; tr[e.mode][a][d] = (tr[e.mode][a][d] || 0) + 1; } }); });
  return { tr, pr };
}

function creeProto(o = {}) {
  const P = { clarte: .7, tauAccord: 5, hyst: .65, profil: 'AE', plancher: .012, attente: 8, margeLock: 0, phrasesLock: 0, noteLongue: 1.2, H: 8, margeMod: 2, phrasesMod: 2, tempsMod: 6, horsGamme: .05,
    fenetreCorrection: 60, margeCorrection: 3, penalite: 1.4, plafond: 3.5, pRacine: .32, pTon: .24, pAutre: .04, pHors: .012, attaque: .25, jeune: .9, surcout: 1, gainEvid: 4, memoire: true, anticipe: .25, ticks: null, oubli: .2, fenetreDecision: .6, K: 4, plancherBruit: 1.5e-4, facteurPorte: 1.6, ...o };
  const LP = logProfil(P.profil, P.plancher);
  const log = { keys: [], chords: [], notes: [], accordage: [], previsions: [], trames: 0, voisees: 0 };
  // Accordage
  let zr = 0, zi = 0, poids = 0, tune = 0, tuneInit = false;
  // Porte adaptative
  let plancher = null;
  // Médiane sur 3 trames
  const fen = [];
  // Notes
  let cur = null, pend = null, silenceDepuis = null, finPhraseVue = false;
  // Tonalité
  let key = null, L = new Float64Array(24), voiced = 0, finsPhrase = 0, cusum = new Float64Array(24), candDebut = new Float64Array(24).fill(-1), candPhrases = new Int32Array(24), candHors = new Float64Array(24), lockT = null, recentes = [];
  const idx = k => k.tonic * 2 + (k.mode === 'maj' ? 0 : 1), deKey = i => ({ tonic: i >> 1, mode: i & 1 ? 'min' : 'maj' });
  const logP = (i, pc) => LP[i & 1][mod(pc - (i >> 1))];
  const dansGamme = (i, pc) => GAMMES[i & 1].includes(mod(pc - (i >> 1)));
  const relatif = (a, b) => (a & 1) !== (b & 1) && mod((a >> 1) + ((a & 1) ? 3 : 9)) === (b >> 1);
  // Accords
  let iTick = 0, dernierTick = -9, cands = null, a = null, c = -1, dernierChg = -9, histo = [], chronologie = [], prevu = null;
  function initAccords() {
    cands = CH[key.mode].map(([deg, st, q, prior]) => { const root = mod(key.tonic + st), tons = [0, q === 'maj' ? 4 : 3, 7].map(x => mod(root + x)); return { deg, root, q, prior, tons }; });
    a = new Float64Array(6); c = -1; dernierChg = -9;
    const pr = P.transitions && P.transitions.pr[key.mode]; if (pr) { const n = Object.values(pr).reduce((x, y) => x + y, 0); cands.forEach((cd, i) => { a[i] = Math.log(((pr[cd.deg] || 0) + 1) / (n + 6)); }); }
  }
  const emissionLog = (pc, cd) => Math.log(pc === cd.root ? P.pRacine : cd.tons.includes(pc) ? P.pTon : dansGamme(idx(key), pc) ? P.pAutre : P.pHors);
  function coutChangement(deC, versC, t) {
    const row = P.transitions && P.transitions.tr[key.mode][cands[deC].deg]; let lt = 0;
    if (row) { const n = Object.values(row).reduce((x, y) => x + y, 0); lt = Math.log(((row[cands[versC].deg] || 0) + .5) / (n + 3)) + Math.log(3); }
    else lt = FLOW[cands[deC].deg + '>' + cands[versC].deg] || 0;
    return P.penalite - lt + (t - dernierChg < P.jeune ? P.surcout : 0);
  }
  function ajouteEvidenceAccord(pc, w, t) {
    if (!key) return;
    let mx = -1e9; for (let i = 0; i < 6; i++) { a[i] += w * P.gainEvid * emissionLog(pc, cands[i]); if (a[i] > mx) mx = a[i]; }
    // Plafond : un accord ne prend jamais plus de "plafond" d'avance, sinon le suivant arriverait trop tard.
    for (let i = 0; i < 6; i++) { a[i] -= mx; if (a[i] < -P.plafond) a[i] = -P.plafond; }
    if (c < 0) { let b = 0; for (let i = 1; i < 6; i++) if (a[i] > a[b]) b = i; change(b, t); return; }
    if (P.ticks) {
      while (iTick < P.ticks.length && P.ticks[iTick] <= t) { dernierTick = P.ticks[iTick++]; for (let i = 0; i < 6; i++) a[i] *= P.oubli; }
      if (t - dernierTick > P.fenetreDecision) return;
    }
    let b = -1, bs = -1e9; for (let i = 0; i < 6; i++) { if (i === c) continue; const m = a[i] - a[c] - coutChangement(c, i, t); if (m > bs) { bs = m; b = i; } }
    if (bs >= 0) change(b, t);
  }
  function change(b, t) {
    c = b; dernierChg = t; const cd = cands[b]; log.chords.push({ t, deg: cd.deg, root: cd.root, q: cd.q });
    // Date réelle estimée du changement : début de la note en cours, pour la mémoire des reprises.
    const dep = cur ? Math.max(cur.start, t - .6) : t; if (!P.grilleConnue) chronologie.push({ t: dep, b, root: cd.root, q: cd.q, deg: cd.deg });
  }
  function memoire(t) {
    // Dernières K notes déjà chantées ? Si oui on connaît l'accord suivant et sa date, à l'échelle du tempo courant.
    const n = histo.length - 1, K = P.K; if (n < K + 6) return;
    let meilleur = -1, lgM = 0;
    for (let j = n - 6; j >= K; j--) {
      let lg = 0; while (lg < 14 && j - lg >= 0 && histo[j - lg].pc === histo[n - lg].pc) lg++;
      if (lg >= K && lg > lgM) { lgM = lg; meilleur = j; }
    }
    if (meilleur < 0) { prevu = null; return; }
    const dp = histo[meilleur].t - histo[meilleur - K + 1].t, dn = histo[n].t - histo[n - K + 1].t, r = dp > 0 ? Math.min(1.25, Math.max(.8, dn / dp)) : 1;
    const courant = chronologie.filter(e => e.t <= histo[meilleur].t + .05).pop(), suivant = chronologie.find(e => e.t > histo[meilleur].t + .05);
    // Accord courant selon la mémoire : renforce sans attendre.
    if (courant && c !== courant.b) { a[courant.b] = Math.max(a[courant.b], a[c] + .5); change(courant.b, t); }
    if (!suivant || suivant.t - histo[meilleur].t > 4) { prevu = null; return; }
    if (suivant) { prevu = { b: suivant.b, quand: t + (suivant.t - histo[meilleur].t) * r, deg: suivant.deg, faitLe: t }; log.previsions.push({ t, quand: prevu.quand, root: suivant.root, q: suivant.q }); }
  }
  function appliquePrevision(t) {
    if (prevu && t >= prevu.quand - P.anticipe) { if (c !== prevu.b && t - prevu.faitLe < 3) { a[prevu.b] = 0; change(prevu.b, t); } prevu = null; }
  }

  function fermeNote(fin) {
    if (!cur) return;
    const end = cur.last + .02, dur = end - cur.start;
    if (dur >= .08) {
      const e = { midi: cur.midi, pc: mod(cur.midi), start: cur.start, end, fin: fin || dur >= P.noteLongue };
      log.notes.push(e); ajouteTonalite(e, dur);
    }
    cur = null;
  }
  function ajouteTonalite(e, dur) {
    const w = Math.min(dur, 1) * (e.fin ? 1.5 : 1); voiced += dur; if (e.fin) finsPhrase++;
    recentes.push({ pc: e.pc, w, t: e.end }); if (recentes.length > 200) recentes.shift();
    for (let i = 0; i < 24; i++) L[i] += w * logP(i, e.pc);
    const t = e.end;
    if (!key) {
      if (voiced >= P.attente && finsPhrase >= P.phrasesLock) {
        const ord = [...L.keys()].sort((x, y) => L[y] - L[x]);
        if (L[ord[0]] - L[ord[1]] >= P.margeLock || voiced >= P.attente * 2.5) setKey(deKey(ord[0]), t, false);
      }
      return;
    }
    const ic = idx(key);
    // Correction silencieuse pendant les premières secondes : le premier verrouillage peut être relatif ou voisin.
    if (t - lockT < P.fenetreCorrection) {
      const ord = [...L.keys()].sort((x, y) => L[y] - L[x]);
      if (ord[0] !== ic && L[ord[0]] - L[ic] >= P.margeCorrection) { setKey(deKey(ord[0]), t, false, true); return; }
    }
    // CUSUM : équivalent en ligne de Viterbi avec une pénalité de changement H.
    const hors = !dansGamme(ic, e.pc);
    for (let i = 0; i < 24; i++) {
      if (i === ic) continue;
      const av = cusum[i]; cusum[i] = Math.max(0, cusum[i] + w * (logP(i, e.pc) - logP(ic, e.pc)));
      if (av === 0 && cusum[i] > 0) { candDebut[i] = t; candPhrases[i] = 0; candHors[i] = 0; }
      if (cusum[i] === 0) { candDebut[i] = -1; continue; }
      if (e.fin) candPhrases[i]++;
      if (hors && dansGamme(i, e.pc)) candHors[i] += dur;
      const span = t - candDebut[i];
      if (cusum[i] >= P.H && !relatif(ic, i) && candPhrases[i] >= P.phrasesMod && span >= P.tempsMod && candHors[i] / Math.max(span, 1e-3) >= P.horsGamme) {
        // La preuve est atteinte : on prend la tonalité qui explique le mieux ces notes-là, seulement si elle se détache.
        const depuis = candDebut[i], sc = new Float64Array(24); recentes.forEach(x => { if (x.t >= depuis) for (let k = 0; k < 24; k++) sc[k] += x.w * logP(k, x.pc); });
        const ord = [...sc.keys()].filter(k => k !== ic).sort((x, y) => sc[y] - sc[x]);
        if (sc[ord[0]] - sc[ord[1]] < P.margeMod) continue;
        L = sc.slice(); setKey(deKey(ord[0]), t, true); lockT = t; return;
      }
    }
  }
  function setKey(k, t, isMod, corr) {
    key = { tonic: k.tonic, mode: k.mode }; if (lockT == null) lockT = t;
    cusum.fill(0); candDebut.fill(-1); candPhrases.fill(0); candHors.fill(0); initAccords(); chronologie = P.grilleConnue ? P.grilleConnue.map(a => ({ t: a.start, b: cands.findIndex(x => x.root === a.root && x.q === a.q), root: a.root, q: a.q, deg: a.deg })).filter(e => e.b >= 0) : []; if (isMod) histo = []; prevu = null;
        log.keys.push({ t, tonic: k.tonic, mode: k.mode, isMod: !!isMod, correction: !!corr });
  }

  function trame(t, midi, conf, rms, dt) {
    log.trames++;
    if (rms != null) { plancher = plancher == null ? rms : rms < plancher ? plancher + (rms - plancher) * .2 : plancher * (1 + .05 * dt); }
    const porte = Math.max(P.plancherBruit, (plancher ?? 0) * P.facteurPorte);
    const voise = midi != null && conf >= P.clarte && (rms == null || rms > porte);
    let m = null;
    if (voise) {
      log.voisees++;
      // Accordage circulaire sur les trames voisées : moyenne qui glisse avec une constante de temps tauAccord (temps chanté).
      const al = Math.max(dt / P.tauAccord, 1 / (poids / dt + 1)); poids += dt;
      const ph = 2 * Math.PI * (midi % 1); zr += al * (Math.cos(ph) - zr); zi += al * (Math.sin(ph) - zi);
      const est = Math.atan2(zi, zr) / (2 * Math.PI);
      if (!tuneInit) { tune = est; tuneInit = true; } else tune += wrap(est - tune);
      fen.push(midi - tune); if (fen.length > 3) fen.shift();
      m = [...fen].sort((x, y) => x - y)[fen.length >> 1];
      if (Math.floor(t) !== Math.floor(t - dt)) log.accordage.push({ t, cents: 100 * tune });
    } else fen.length = 0;
    if (m == null) {
      pend = null;
      if (cur && t - cur.last > .12) fermeNote(true);
    } else {
      const r = Math.round(m);
      if (cur && Math.abs(m - cur.midi) < P.hyst) { cur.last = t; pend = null; }
      else if (pend && pend.midi === r) {
        pend.n++;
        if (pend.n >= 2) { if (cur) fermeNote(false); cur = { midi: r, start: pend.t, last: t }; pend = null;
          histo.push({ pc: mod(r), t: cur.start }); if (histo.length > 500) histo.splice(0, 100);
          if (key) { ajouteEvidenceAccord(mod(r), P.attaque, t); if (P.memoire && c >= 0) memoire(t); } }
      } else pend = { midi: r, t, n: 1 };
    }
    if (key) { appliquePrevision(t); if (cur && t - cur.start < 1) ajouteEvidenceAccord(mod(cur.midi), dt, t); }
  }
  function finir(t) { fermeNote(true); return log; }
  return { trame, finir, log };
}
module.exports = { creeProto, PROFILS, apprendTransitions };
