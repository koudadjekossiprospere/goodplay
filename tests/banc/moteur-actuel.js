'use strict';
/* Copie du moteur de index.html (lignes 509 à 521 et 553 à 649), seuils compris. Seul le DOM est remplacé par des journaux.
   Si index.html change, cette copie ne suit pas : c'est la photographie de l'existant, pas une dépendance. */
const { yinActuel: yin } = require('./hauteur.js');
const mod = n => ((n % 12) + 12) % 12;
const sameKey = (a, b) => a && b && a.tonic === b.tonic && a.mode === b.mode;
const relative = (a, b) => a && b && a.mode !== b.mode && mod(a.tonic + (a.mode === 'maj' ? 9 : 3)) === b.tonic;
const Q = { maj: [0, 4, 7], min: [0, 3, 7] };
const MAJ_STEP = [0, 0, 2, 4, 5, 7, 9, 11], MIN_STEP = { 1: 0, 3: 3, 4: 5, 5: 7, 6: 8, 7: 10 };
function cands(k) {
  if (k.mode === 'maj') return [[1, 'maj', 1], [2, 'min', .45], [3, 'min', .2], [4, 'maj', .9], [5, 'maj', .9], [6, 'min', .6]].map(([d, q, p]) => ({ deg: d, root: mod(k.tonic + MAJ_STEP[d]), q, prior: p }));
  return [[1, 'min', 1], [3, 'maj', .4], [4, 'min', .8], [5, 'maj', .85], [6, 'maj', .6], [7, 'maj', .45]].map(([d, q, p]) => ({ deg: d, root: mod(k.tonic + MIN_STEP[d]), q, prior: p }));
}
const FLOW = { '5>1': .08, '4>5': .04, '4>1': .04, '2>5': .07, '6>4': .04, '1>4': .03, '1>5': .03, '6>2': .03, '3>6': .04, '7>3': .04 };
const KMAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KMIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) { let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12; let s = 0, sa = 0, sb = 0; for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; } return sa && sb ? s / Math.sqrt(sa * sb) : 0; }
function keyCorr(h, k) { const r = h.map((_, i) => h[(i + k.tonic) % 12]); return corr(r, k.mode === 'maj' ? KMAJ : KMIN); }
function rankKeys(h) { const o = []; for (let t = 0; t < 12; t++) for (const m of ['maj', 'min']) o.push({ tonic: t, mode: m, r: keyCorr(h, { tonic: t, mode: m }) }); return o.sort((a, b) => b.r - a.r); }

function creeMoteurActuel(sr, opts = {}) {
  const S = { chordLen: 1.6, sens: .55, keyMode: 'auto', autoMod: true, newGap: 15, ...opts };
  const log = { keys: [], chords: [], notes: [], trames: 0, ouvertes: 0, voisees: 0 };
  let key = null, keyHist = new Array(12).fill(0), voiced = 0;
  let events = [], curNote = null, pend = null, lastCloseT = -1, lastCloseSilence = false, winStart = null, lastVoiceT = 0, songPending = false;
  let chord = null, trans = {}, lastPitchT = 0, modCand = null;
  const buf = new Float32Array(2048);
  let ctxT = 0;

  function tick() {
    const t = ctxT;
    let rms = 0; for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / buf.length);
    const thr = 0.004 + (1 - S.sens) * 0.03;
    let midi = null;
    log.trames++; if (rms > thr) log.ouvertes++;
    if (rms > thr) { const p = yin(buf, sr); if (p && p.conf > .8 && p.f > 70 && p.f < 1100) midi = 69 + 12 * Math.log2(p.f / 440); }
    if (midi != null) { log.voisees++; if (songPending) { songPending = false; newSong(t); } lastVoiceT = t; lastPitchT = t; }
    onPitch(midi, t);
    if (key && !songPending && lastVoiceT && t - lastVoiceT > S.newGap) songPending = true;
    if (!key) tryLockKey(t); else maybeDecide(t);
  }
  function onPitch(m, t) {
    if (m == null) { pend = null; if (curNote && t - curNote.last > .12) { closeNote(curNote, true); curNote = null; } return; }
    const r = Math.round(m);
    if (curNote && r === curNote.midi) { curNote.last = t; pend = null; return; }
    if (pend && pend.midi === r) { pend.n++; if (pend.n >= 2) { if (curNote) closeNote(curNote, false); curNote = { midi: r, start: pend.t, last: t }; pend = null; } }
    else pend = { midi: r, t, n: 1 };
  }
  function closeNote(n, bySilence) {
    const end = n.last + .04, dur = end - n.start; if (dur < .08) return;
    const e = { midi: n.midi, pc: mod(n.midi), start: n.start, end, fin: bySilence }; events.push(e); if (events.length > 600) events.splice(0, 150);
    keyHist[e.pc] += dur * (bySilence ? 1.7 : 1); voiced += dur; lastCloseT = end; lastCloseSilence = bySilence;
    log.notes.push(e);
  }
  function tryLockKey(t) {
    const distinct = keyHist.filter(v => v > .05).length, rk = rankKeys(keyHist);
    if (voiced >= 4 && distinct >= 4 && (rk[0].r - rk[1].r >= .04 || voiced >= 8)) setKey({ tonic: rk[0].tonic, mode: rk[0].mode }, t, false);
  }
  function setKey(k, t, isMod) {
    key = { tonic: k.tonic, mode: k.mode }; winStart = t; chord = null; modCand = null;
    if (isMod) trans = {};
    log.keys.push({ t, tonic: key.tonic, mode: key.mode, isMod });
  }
  function checkModulation(t) {
    if (!S.autoMod || S.keyMode !== 'auto') return;
    const recent = new Array(12).fill(0); let v = 0;
    events.forEach(e => { if (e.end > t - 14) { const d = e.end - Math.max(e.start, t - 14); recent[e.pc] += d * (e.fin ? 1.7 : 1); v += d; } });
    if (v < 5) { modCand = null; return; }
    const rk = rankKeys(recent), top = rk[0], curR = keyCorr(recent, key);
    if (sameKey(top, key) || relative(top, key) || top.r - curR < .15) { modCand = null; return; }
    if (modCand && sameKey(modCand.k, top)) { if (t - modCand.since >= 5) setKey(top, t, true); }
    else modCand = { k: { tonic: top.tonic, mode: top.mode }, since: t };
  }
  function windowWeights(t0, t1) {
    const w = new Array(12).fill(0); let tot = 0;
    const list = events.filter(e => e.end > t0);
    if (curNote) list.push({ pc: mod(curNote.midi), start: curNote.start, end: curNote.last + .04 });
    list.forEach((e, i) => { const d = Math.max(0, Math.min(e.end, t1) - Math.max(e.start, t0)); if (!d) return;
      const bonus = (i === list.length - 1 ? 1.5 : 1) * (Math.abs(e.start - t0) < .15 ? 1.25 : 1); w[e.pc] += d * bonus; tot += d * bonus; });
    return { w, tot };
  }
  function maybeDecide(t) {
    if (winStart == null) return;
    const { w, tot } = windowWeights(winStart, t);
    const phraseEnd = !curNote && lastCloseSilence && lastCloseT > winStart && t - lastCloseT > .3 && tot > .4;
    if ((t - winStart >= S.chordLen && tot >= .35) || phraseEnd) { decide(w, tot, phraseEnd, t); winStart = t; checkModulation(t); }
    else if (t - winStart > S.chordLen * 3 && tot < .1) winStart = t;
  }
  function decide(w, tot, phraseEnd, t) {
    const sc = c => { const tones = Q[c.q].map(i => mod(c.root + i)); let s = 0;
      for (let pc = 0; pc < 12; pc++) { if (!w[pc]) continue; const x = w[pc] / tot; s += pc === c.root ? x * 1.25 : tones.includes(pc) ? x : -x * .7; }
      s += c.prior * .18;
      if (chord) { if (chord.deg === c.deg) s += .06; s += Math.min((trans[chord.deg] || {})[c.deg] || 0, 4) * .03; s += FLOW[chord.deg + '>' + c.deg] || 0; }
      return s; };
    const scored = cands(key).map(c => ({ c, s: sc(c) })).sort((a, b) => b.s - a.s);
    let best = scored[0];
    if (chord && best.c.deg !== chord.deg) { const keep = scored.find(x => x.c.deg === chord.deg); if (keep && best.s - keep.s < .05) best = keep; }
    const nc = best.c;
    if (!chord || nc.deg !== chord.deg) {
      if (chord) { trans[chord.deg] = trans[chord.deg] || {}; trans[chord.deg][nc.deg] = (trans[chord.deg][nc.deg] || 0) + 1; }
      chord = Object.assign({}, nc);
      log.chords.push({ t, deg: nc.deg, root: nc.root, q: nc.q });
    }
  }
  function newSong(t) { log.keys.push({ t, nouveauChant: true }); key = null; keyHist.fill(0); voiced = 0; chord = null; trans = {}; modCand = null; winStart = null; }

  /* Rejoue un signal comme le ferait setInterval(tick, 40) sur l'AnalyserNode : les 2048 derniers échantillons à chaque tic. */
  function rejoue(x) {
    const pas = .04 * sr;
    for (let i = 2048; i < x.length; i += pas) { const fin = Math.floor(i); ctxT = fin / sr; buf.set(x.subarray(fin - 2048, fin)); tick(); }
    if (curNote) { closeNote(curNote, true); curNote = null; }
    return log;
  }
  return { rejoue, log };
}
module.exports = { creeMoteurActuel, rankKeys, keyCorr };
