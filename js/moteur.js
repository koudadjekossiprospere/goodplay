/* Moteur d'écoute : hauteur, accordage, notes, tonalité, accords, tempo, mémoire de phrase. Sans DOM.
   Paramètres repris de docs/recherche/audio.md, réglés sur les chants pairs du corpus (node tests/mesure.js). */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  if (!GP.mod && typeof require === 'function') require('./theorie.js');
  const { mod, GAMMES } = GP;

  const SR = 16000, N = 683, PAS = 320, DT = PAS / SR;
  // Recherche du ronflement : Goertzel de 70 à 250 Hz par pas de 2 Hz, sur des blocs de 0,512 s à 2 kHz.
  const RF_DEC = 8, RF_N = 1024, RF_PAS = 2, RF_B = 91, RF_F = k => 70 + k * RF_PAS;
  const RF_W = Float64Array.from({ length: RF_B }, (_, k) => 2 * Math.cos(2 * Math.PI * RF_F(k) * RF_DEC / SR)), RF_H = Float64Array.from({ length: RF_N }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (RF_N - 1)));

  const P0 = {
    // Hauteur et notes
    k: .9, clarte: .7, tauAccord: 5, hyst: .65, noteMin: .09, noteLongue: 1.2, silence: .12, plancherBruit: 1.5e-4, facteurPorte: 1.6,
    // Vraies voix : vibrato large (un demi-ton demande plus de trames qu'un vrai saut), phrase = pause d'au moins pauseMin s et pauseRel fois l'écart médian entre attaques, après phraseMin s chantées.
    ronfle: true, ronfleBlocs: 12, ronfleForce: 8, ronfleQ: 8, ronfleNiveau: 16, plie: 8.5, tauReg: 2, lisse: 3, confirme: 2, confirmeDemi: 4, pureMax: 300, pureRap: 1.25, repriseApres: 1, confirmeReprise: 7, pauseMin: .2, pauseRel: .25, phraseMin: 6, vitAccord: .04, priseAccord: 2,
    // Tonalité : probable dès que la preuve suffit (attenteMin s chantées, notesLock notes différentes, margeLock nats d'avance), au plus tard après `attente` s ; sûre après 60 s ou une avance nette. Le relatif n'est jamais une modulation.
    attente: 8, limiteTon: 4.6, attenteMin: 3, notesLock: 4, margeLock: .4, margeSure: 6, voixSure: 20, hypMin: .1, fenetreCorrection: 60, margeCorrection: 1.2, H: 8, margeMod: 3, margeModeMod: 6, phrasesMod: 2, tempsMod: 6, horsGamme: .05, plancherProfil: .012,
    // Profil de cantiques et a priori majeur (157 cantiques sur 189), réglés sur les pairs de tests/banc/tonalite-hymnes.js et de balayage-tonalite.js. 'ae' et 0 pour l'ancien réglage.
    profil: 'hymnes', priorMaj: .5,
    // Raison apprise (js/raison.js, poids dans js/raison-poids.js) : 'apprise' la remplace au profil ci-dessus, modulations comprises ; 'profil' garde l'ancien calcul (et reste le repli sans les poids).
    raison: 'apprise',
    // Accords : aucun bonus sur la fondamentale, la note chantée est souvent la tierce ou la quinte.
    // Rythme harmonique : quitter un accord de moins de `jeune` s coûte `surcout` ; plus de case sous `caseMin` s, ni de crochet A B A sous `blip` s si `blipFrac` du chant de B tient dans A. Une vraie basse garde ses propres valeurs.
    ambigu: .5, clarteAcc: .9, margeAcc: 3, margeJeuneAcc: 3, caseTenue: 2, pAccord: .28, pGamme: .04, pHors: .012, gain: 4, attaque: .25, noteRapide: .2, cout: 1, coutTrans: 2, jeune: 2, jeuneBasse: .9, surcout: 1, duree: 1, retard: 1.5, caseMin: .6, caseMinBasse: .3, fenetreDecode: 300, blip: 2, blipFrac: .3, pSept: .12,
    // Mémoire de phrase : règle 7 du bassiste, distance de mélodie et non correspondance exacte
    K: 8, K2: 4, D: 2, appui: .15, poidsMem: .5, poidsCorrige: 3, anticipe: .25, horizon: 4, ecartMin: 3, memoire: true,
    // Piano voisin : les notes sous la tessiture vont au canal de basse, une note peu claire ne prouve pas une modulation.
    // clarteSuggeree : écarter une note suggérée et peu claire ; aucun gain mesuré, donc coupé (.95 pour le réactiver).
    clarteSure: .9, clarteSuggeree: 0, tessMin: 56, basseDur: .3, basseMin: 2, basseAbs: 44.5, basseRel: 10, basseVoix: 47.5, biaisMaj: .2,
    // Basse réelle
    forceBasse: 3, gainBasse: 4
  };

  /* Aarden-Essen : le profil le mieux mesuré sur des mélodies (audio.md) */
  const AE = [[17.7661, .145624, 14.9265, .160186, 19.8049, 11.3587, .291248, 22.062, .145624, 8.15494, .232998, 4.95122], [18.2648, .737619, 14.0499, 16.8599, .702494, 14.4362, .702494, 18.6161, 4.56621, 1.93186, 7.37619, 1.75623]];
  /* Cantiques : durées par degré des 95 cantiques pairs de la base (tests/banc/tonalite-hymnes.js). La tonique pèse plus, le 4e degré moins que dans les chants populaires d'Essen. */
  const HY = [[24.2, 0, 14, .1, 18, 6.8, .7, 21, 0, 9.4, .3, 5.3], [23.2, 1.5, 10.1, 18.1, .3, 15.3, 0, 20.3, 4.3, .5, 5.4, .8]];
  const logProfil = (pl, prof = AE) => prof.map(p => { const s = p.reduce((a, b) => a + b, 0), q = p.map(v => Math.max(v / s, pl)), z = q.reduce((a, b) => a + b, 0); return q.map(v => Math.log(v / z)); });

  /* Fondamentales entendues à la basse : ordres de grandeur du corpus de basse (1, 4, 5 : 89 % du temps) */
  const LB = [[.42, .01, .05, .005, .02, .2, .005, .22, .005, .06, .005, .01], [.42, .01, .02, .05, .005, .18, .005, .18, .05, .005, .06, .015]].map(p => p.map(Math.log));

  /* docs/recherche/transitions-basse.json : note de basse, répétition exclue */
  const TRANSITIONS = {
    maj: { 1: { 2: .07, 3: .06, 4: .38, 5: .32, 6: .14, 7: .03 }, 2: { 1: .13, 3: .12, 4: .06, 5: .62, 6: .05, 7: .02 }, 3: { 1: .08, 2: .14, 4: .38, 5: .06, 6: .32, 7: .02 }, 4: { 1: .5, 2: .05, 3: .05, 5: .32, 6: .05, 7: .03 }, 5: { 1: .62, 2: .04, 3: .05, 4: .12, 6: .15, 7: .02 }, 6: { 1: .1, 2: .24, 3: .07, 4: .36, 5: .2, 7: .03 }, 7: { 1: .66, 2: .03, 3: .12, 4: .02, 5: .05, 6: .12 } },
    min: { 1: { 2: .04, 3: .08, 4: .26, 5: .24, 6: .2, 7: .18 }, 2: { 1: .15, 3: .1, 4: .05, 5: .62, 6: .05, 7: .03 }, 3: { 1: .15, 2: .05, 4: .24, 5: .1, 6: .28, 7: .18 }, 4: { 1: .34, 2: .03, 3: .07, 5: .38, 6: .06, 7: .12 }, 5: { 1: .66, 2: .02, 3: .05, 4: .09, 6: .14, 7: .04 }, 6: { 1: .1, 2: .04, 3: .08, 4: .2, 5: .3, 7: .28 }, 7: { 1: .3, 2: .02, 3: .32, 4: .06, 5: .1, 6: .2 } }
  };

  /* Décimation par filtre polyphasé (sinc fenêtré) : marche pour tout rapport, y compris 44,1 kHz vers 16 kHz. */
  function creeDecimateur(srIn, srOut = SR, taps = 47, phases = 64) {
    const R = srIn / srOut, fc = .45 / R, c = (taps - 1) / 2, H = [];
    for (let p = 0; p < phases; p++) {
      const h = new Float32Array(taps), d = p / phases; let s = 0;
      for (let i = 0; i < taps; i++) { const u = i - c - d, sinc = Math.abs(u) > 1e-9 ? Math.sin(2 * Math.PI * fc * u) / (Math.PI * u) : 2 * fc; h[i] = sinc * (.54 + .46 * Math.cos(Math.PI * u / (c + 1))); s += h[i]; }
      for (let i = 0; i < taps; i++) h[i] /= s;
      H.push(h);
    }
    const mem = new Float32Array(taps); let pos = taps; // pos : indice flottant du prochain échantillon de sortie dans (mem + x)
    return x => {
      const L = x.length, y = new Float32Array(Math.ceil(L / R) + 2); let n = 0;
      while (pos + taps <= taps + L) {
        const o = Math.floor(pos), h = H[Math.min(phases - 1, Math.floor((pos - o) * phases))], b = o - taps; let v = 0;
        for (let i = 0; i < taps; i++) { const j = b + i; v += h[i] * (j < 0 ? mem[j + taps] : x[j]); }
        y[n++] = v; pos += R;
      }
      pos -= L;
      if (L >= taps) mem.set(x.subarray(L - taps)); else { mem.copyWithin(0, L); mem.set(x, taps - L); }
      return y.subarray(0, n);
    };
  }

  /* MPM (McLeod et Wyvill 2005). conf = clarté. */
  const NSDF = new Float32Array(400);
  function mpm(x, sr, k) {
    const L0 = x.length, maxT = Math.min(Math.floor(sr / 70), L0 - 2), minT = Math.floor(sr / 1100), n = NSDF;
    for (let t = 0; t <= maxT; t++) { let r = 0, m = 0; const L = L0 - t; for (let i = 0; i < L; i++) { const a = x[i], b = x[i + t]; r += a * b; m += a * a + b * b; } n[t] = m ? 2 * r / m : 0; }
    const pics = []; let t = 1, max = 0; while (t <= maxT && n[t] > 0) t++;
    while (t < maxT) {
      while (t < maxT && n[t] <= 0) t++;
      let bm = -2, bi = -1; while (t <= maxT && n[t] > 0) { if (n[t] > bm && t < maxT && n[t] >= n[t + 1] && n[t] >= n[t - 1]) { bm = n[t]; bi = t; } t++; }
      if (bi > 0 && bi >= minT) { pics.push(bi); if (bm > max) max = bm; }
    }
    if (!pics.length) return null;
    const tau = pics.find(p => n[p] >= k * max);
    let bt = tau; if (tau > 0 && tau < maxT) { const a = n[tau - 1], b = n[tau], c = n[tau + 1], den = a + c - 2 * b; if (den) bt = tau + .5 * (a - c) / den; }
    return { f: sr / bt, conf: n[tau] };
  }

  /* Coupe-bande d'ordre 2 (Audio EQ Cookbook) */
  function creeCoupe(f, Q) {
    const w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * Q), a0 = 1 + al, b1 = -2 * Math.cos(w) / a0, b0 = 1 / a0, a2 = (1 - al) / a0; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return v => { const s = b0 * v + b1 * x1 + b0 * x2 - b1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = s; return s; };
  }

  /* Distance d'édition de Q à la meilleure sous-suite de S qui finit à chaque position (Sellers). Rend la meilleure fin. */
  const distance = (a, b) => { let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const q = [i]; for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = q; } return p[b.length]; };
  function aligne(Q, S, jMax, prefere) {
    const K = Q.length; let col = new Int32Array(K + 1), bestD = 1e9, bestJ = -1;
    for (let i = 0; i <= K; i++) col[i] = i;
    for (let j = 0; j <= jMax; j++) {
      const nv = new Int32Array(K + 1), v = S[j];
      for (let i = 1; i <= K; i++) nv[i] = Math.min(col[i - 1] + (Q[i - 1] === v ? 0 : 1), col[i] + 1, nv[i - 1] + 1);
      col = nv;
      if (col[K] < bestD || (col[K] === bestD && j === prefere)) { bestD = col[K]; bestJ = j; }
    }
    return { d: bestD, j: bestJ };
  }

  class Moteur {
    constructor({ sr = SR, reglages = {} } = {}) {
      this.reglages = { basseReelle: false, modulationAuto: true, tempsNouveauChant: 15, tonalite: null, ...reglages };
      this.P = { ...P0, ...(reglages.params || {}) };
      this.LP = logProfil(this.P.plancherProfil, this.P.profil === 'hymnes' ? HY : AE);
      this.R = this.P.raison === 'apprise' && GP.Raison && GP.raisonPoids ? new GP.Raison(this.P.raisonParams || {}) : null; // sans ses poids, l'ancien calcul reste
      this.ecouteurs = {};
      this.definirSr(sr);
      this.reinit();
    }
    on(nom, fn) { (this.ecouteurs[nom] = this.ecouteurs[nom] || []).push(fn); return this; }
    _emet(nom, d) { const l = this.ecouteurs[nom]; if (l) for (const f of l) f(d); }
    definirSr(sr) { this.sr = sr; this.dec = sr === SR ? null : creeDecimateur(sr); }

    reinit() {
      this.definirSr(this.sr); // mêmes entrées, mêmes sorties : la mémoire du décimateur repart à zéro aussi
      this.grille = []; this.tampon = new Float32Array(N); this.nTampon = 0; this.depuisPas = 0; this.fenetre = new Float32Array(N);
      this.plancher = null; this.tNow = 0; this.nChant = 0; this.suggerees = new Set(); this.taps = []; this.tape = null; this.derniereVoix = null;
      this.coupes = []; this.rf = { s: 0, nd: 0, n: 0, b: new Float64Array(RF_N), c: new Int32Array(RF_B), mn: new Float64Array(RF_B), mx: new Float64Array(RF_B), lignes: [] };
      if (this.reglages.basseReelle) { this.dec2k = creeDecimateur(SR, 2000, 63); this.tB = new Float32Array(512); this.nB = 0; this.pasB = 0; this.basse = null; }
      this._nouveauChantEtat();
      if (this.reglages.tonalite) { this._fixeTon(this.reglages.tonalite, 0, false); this.etat = 'sure'; }
    }
    _nouveauChantEtat() {
      this.zr = 0; this.zi = 0; this.poids = 0; this.accordage = 0; this.accordageInit = false; this.fen = []; this.reg = null; this.tVoix = 0; this.finAttente = null; this.tPhrase = 0; this.tete = null; this.delaiCorrection = null; this.tFinNote = -1e9; this.tChange = -1e9;
      this.cur = null; this.pend = null; this.bc = null; this.tempsBasse = 0; this.fige = false; this.tess = null; this.hauts = []; this.notes = []; this.mel = []; this.dernierAlign = -1; this.prevu = null; this.phrases = []; this.debutPhrase = 0; this.nLettres = 0;
      this.key = null; this.etat = null; this.L = this._apriori(); this.sigHyp = ''; this.voise = 0; this.finsPhrase = 0; this.lockT = null; this.recentes = []; this.provi = -1;
      this.cusum = new Float64Array(24); this.candDebut = new Float64Array(24).fill(-1); this.candPhrases = new Int32Array(24); this.candHors = new Float64Array(24);
      if (this.R) this.R.reinit();
      this.cands = null; this.delta = null; this.entree = null; this.courant = -1; this.rapide = false; this.iDecode = 0;
      this.onsets = []; this.resteB = []; this.mesureCourante = null; this.tempoAuto = null; this.dernierTempo = 0; this.numTemps = 0; this.prochainTemps = null;
    }
    nouveauChant(t) { this.nChant++; this._nouveauChantEtat(); this._emet('nouveauChant', { t }); if (this.reglages.tonalite) { this._fixeTon(this.reglages.tonalite, t, false); this.etat = 'sure'; } }

    /* ---------- Entrée audio ---------- */
    trame(x, t) {
      const y = this.dec ? this.dec(x) : x, L = y.length, tb = this.tampon, co = this.coupes;
      for (let i = 0; i < L; i++) {
        let v = y[i]; for (let j = 0; j < co.length; j++) v = co[j](v);
        tb[this.nTampon] = v; this.nTampon = (this.nTampon + 1) % N; this.depuisPas++;
        if (this.depuisPas >= PAS) { this.depuisPas = 0; this._analyse(t - (L - 1 - i) / SR); }
        if (this.dec2k) this._basseEntree(v);
        if (this.P.ronfle) this._ronfleEntree(y[i]);
      }
    }
    /* Ronflement du secteur ou d'un moteur de disque : une raie grave immobile que MPM prend pour une voix, et qui remplit le seuil de bruit. Une voix bouge, un piano change de note : `ronfleBlocs` blocs de suite sur la même raie (6 s), à niveau constant, c'est la machine. On la coupe avant l'analyse et on oublie les notes qu'elle a déjà fait entendre. Couper une voix qui tiendrait cette note n'efface pas sa période : les harmoniques la portent. */
    _ronfleEntree(v) {
      const r = this.rf; r.s += v; if (++r.nd < RF_DEC) return;
      r.b[r.n++] = r.s / RF_DEC; r.s = 0; r.nd = 0; if (r.n < RF_N) return;
      r.n = 0; const mg = new Float64Array(RF_B);
      for (let k = 0; k < RF_B; k++) { const w = RF_W[k]; let s1 = 0, s2 = 0; for (let i = 0; i < RF_N; i++) { const s = r.b[i] * RF_H[i] + w * s1 - s2; s2 = s1; s1 = s; } mg[k] = s1 * s1 + s2 * s2 - w * s1 * s2; }
      const srt = mg.slice().sort(), med = srt[RF_B >> 1], ici = new Float64Array(RF_B), P = this.P;
      for (let k = 1; k < RF_B - 1; k++) if (mg[k] > mg[k - 1] && mg[k] >= mg[k + 1] && mg[k] >= P.ronfleForce * med) for (let j = k - 1; j <= k + 1; j++) ici[j] = Math.max(ici[j], mg[k]);
      for (let k = 1; k < RF_B - 1; k++) {
        // Compte par fréquence, sans glisser d'un bin à l'autre, et à niveau constant : une voix revient sur ses notes, mais jamais au même niveau pendant des secondes.
        if (!ici[k]) { r.c[k] = 0; continue; }
        if (!r.c[k]) { r.mn[k] = ici[k]; r.mx[k] = ici[k]; } else { r.mn[k] = Math.min(r.mn[k], ici[k]); r.mx[k] = Math.max(r.mx[k], ici[k]); }
        if (++r.c[k] >= P.ronfleBlocs && r.mx[k] <= P.ronfleNiveau * r.mn[k] && mg[k] >= mg[k - 1] && mg[k] >= mg[k + 1] && !r.lignes.some(f => Math.abs(f - RF_F(k)) < 12)) {
          const a = mg[k - 1], b = mg[k], c = mg[k + 1], f = RF_F(k) + RF_PAS * .5 * (a - c) / (a - 2 * b + c);
          r.lignes.push(f); this.coupes.push(creeCoupe(f, P.ronfleQ)); this._oublieBande(69 + 12 * Math.log2(f / 440));
        }
      }
    }
    /* shortcut: rien à refaire si la tonalité est déjà verrouillée (raie vue après 4 s de chant), à revoir si un cas réel le demande. */
    _oublieBande(m) {
      if (this.key) return;
      const garde = e => Math.abs(e.midi - m) > 2.5, ns = this.notes.filter(garde), tf = this.recentes.filter(x => ns.some(e => e.fin === x.t));
      this.notes = ns; this.recentes = tf; this.L = this._apriori(); this.voise = 0; this.finsPhrase = 0; this.provi = -1; this.zr = 0; this.zi = 0; this.poids = 0; this.accordageInit = false; this.fen = []; this.reg = null; this.hauts = []; this.tess = null; this.mel = this.mel.filter(x => garde(x.note)); this.debutPhrase = 0; this.pend = null;
      if (this.cur && !garde(this.cur)) { this.cur = null; this._emet('noteCourante', null); }
      for (const x of tf) for (let i = 0; i < 24; i++) this.L[i] += x.w * this._logP(i, x.pc);
      for (const e of ns) this.voise += e.fin - e.debut;
      if (this.R) { this.R.reinit(); for (const e of ns) this.R.note(e); this.L = Float64Array.from(this.R.la); } // la tonalité n'est pas encore affichée : on rejoue sans décider
    }
    _analyse(t) {
      const w = this.fenetre, tb = this.tampon, d = this.nTampon; let e = 0;
      for (let j = 0; j < N; j++) { const v = tb[(d + j) % N]; w[j] = v; e += v * v; }
      const p = mpm(w, SR, this.P.k); let ok = p && p.f > 70 && p.f < 1100;
      // Un son grave presque pur (choc, moteur, ventilateur) n'est pas une voix : une voix grave porte ses harmoniques.
      if (ok && this.rf.lignes.some(f => Math.abs(12 * Math.log2(p.f / f)) < .5)) ok = false; // bourdon riche en harmoniques : la coupe n'efface que sa fondamentale
      if (ok && p.f < this.P.pureMax) { let ed = 0; for (let j = 1; j < N; j++) { const d = w[j] - w[j - 1]; ed += d * d; } if (e > 0 && SR / (2 * Math.PI) * Math.sqrt(ed / e) < this.P.pureRap * p.f) ok = false; }
      this.hauteur(t, ok ? 69 + 12 * Math.log2(p.f / 440) : null, ok ? p.conf : 0, Math.sqrt(e / N));
    }

    /* Trame de hauteur : point d'entrée après l'analyse. Sert aussi au banc pour rejouer des trames déjà calculées. */
    hauteur(t, midi, conf, rms, dt = DT) {
      this.tNow = t; const P = this.P;
      this.plancher = this.plancher == null ? rms : rms < this.plancher ? this.plancher + (rms - this.plancher) * .2 : this.plancher * (1 + .05 * dt);
      const porte = Math.max(P.plancherBruit, this.plancher * P.facteurPorte), voiseBrut = midi != null && conf >= P.clarte && rms > porte, grave = voiseBrut && this._estBasse(midi), voise = voiseBrut && !grave;
      this._canalBasse(grave ? midi : null, t);
      this._emet('niveau', { rms, bruit: this.plancher, signal: voise });
      let m = null;
      if (voise) {
        // Registre : un détecteur saute d'une octave quand un harmonique domine. La classe de hauteur ne change pas, on la garde dans le registre du moment.
        if (P.plie) { const d = midi - this.reg; if (this.reg == null) this.reg = midi; else { if (Math.abs(d) >= P.plie) midi -= 12 * Math.round(d / 12); this.reg += (midi - this.reg) * dt / P.tauReg; } }
        const al = Math.max(dt / P.tauAccord, 1 / (this.poids / dt + 1)); this.poids += dt;
        const ph = 2 * Math.PI * (midi % 1); this.zr += al * (Math.cos(ph) - this.zr); this.zi += al * (Math.sin(ph) - this.zi);
        const est = Math.atan2(this.zi, this.zr) / (2 * Math.PI);
        // Vitesse bornée après la prise : dans un choeur l'estimation saute, et sans borne l'accordage glisse d'un demi-ton entier et renomme toutes les notes.
        if (!this.accordageInit) { this.accordage = est; this.accordageInit = true; } else { const e = est - this.accordage - Math.round(est - this.accordage), v = P.vitAccord * dt; this.accordage += this.poids < P.priseAccord ? e : Math.max(-v, Math.min(v, e)); }
        const fe = this.fen; fe.push(midi - this.accordage); if (fe.length > P.lisse) fe.shift();
        m = fe.slice().sort((a, b) => a - b)[fe.length >> 1];
        if (this.derniereVoix != null && t - this.derniereVoix > this.reglages.tempsNouveauChant && this.key) this.nouveauChant(t);
        this.derniereVoix = t;
      } else this.fen.length = 0;
      if (voise) this.tVoix = t;
      // Seule une absence de voix ferme la note : une hauteur qui hésite (glissando, seconde voix) n'est pas une respiration.
      if (m == null) { this.pend = null; if (this.cur && t - this.tVoix > P.silence) this._fermeNote(true); }
      else {
        const r = Math.round(m), c = this.cur;
        if (c && Math.abs(m - c.midi) < P.hyst) { c.last = t; c.somme += m - c.midi; c.nb++; c.clarte += conf; this.pend = null; }
        else if (this.pend && this.pend.midi === r) {
          // Après un vrai silence, une note doit tenir avant d'exister : un choc ou un bruit bref n'ouvre rien. Son début reste daté de l'attaque.
          if (++this.pend.n >= (!c && t - this.tFinNote > P.repriseApres ? P.confirmeReprise : c && Math.abs(r - c.midi) === 1 ? P.confirmeDemi : P.confirme)) { if (c) this._fermeNote(false); this._ouvreNote(r, this.pend.t, t, conf); this.pend = null; }
        } else this.pend = { midi: r, t, n: 1 };
      }
      if (this.finAttente != null && !this.cur && t - this.finAttente >= this._seuilPhrase()) {
        if (this.key) this._decode(this.finAttente);
        if (this.finAttente - this.tPhrase >= P.phraseMin) { this._finPhrase(this.finAttente); this.tPhrase = this.finAttente; }
        this.finAttente = null;
      }
      if (this.key) {
        this._appliquePrevision(t);
        const cu = this.cur;
        if (cu && !this.fige && t - cu.debut < P.duree && !this._ecartee(cu.midi, cu.clarte / cu.nb)) { this._evidence(mod(cu.midi), dt); this._decide(t); }
      }
      if (this.cur && !this.cur.appui && t - this.cur.debut >= P.appui) this._appuie(this.cur);
      this._tempo(t);
    }

    /* Sous la tessiture du chant, c'est la main gauche du piano, pas la voix : la note ne doit ni couper la mélodie, ni passer pour elle. */
    _estBasse(midi) {
      const P = this.P; if (!P.basseAbs || this.tess == null || this.tess < P.tessMin) return false; // une voix grave partage le registre de la main gauche : on ne sait plus trier
      return midi < P.basseAbs || (midi < P.basseVoix && this.tess - midi >= P.basseRel);
    }
    _canalBasse(midi, t) {
      const b = this.bc;
      if (midi == null) { if (b && t - b.last > this.P.silence) { this._noteBasse(b); this.bc = null; } return; }
      const r = Math.round(midi);
      if (b && r === b.midi) { b.last = t; return; }
      if (b) this._noteBasse(b);
      this.bc = { midi: r, debut: t, last: t };
    }
    /* Les fondamentales d'un accompagnement disent la tonalité par un autre profil que la mélodie : 1, 4, 5 dominent. Jamais les accords : ce serait s'écouter soi-même. */
    _noteBasse(b) {
      const dur = b.last + DT - b.debut, P = this.P; if (dur < P.basseDur || this.reglages.tonalite) return;
      this.tempsBasse += dur; if (this.tempsBasse < P.basseMin) return; // une sous-octave de réverbération n'est pas un accompagnement
      const pc = mod(b.midi), w = Math.min(dur, 1);
      // La Raison apprise a appris sur un flux où la basse du piano se mêle à la voix (tests/donnees/concert.js) : une hauteur à la fois, donc dans l'ordre du temps.
      if (this.R) { this._tonaliteApprise({ midi: b.midi, pc, debut: b.debut, fin: b.last + DT, clarteMoy: 1, fin_de_phrase: false }, dur); return; }
      for (let i = 0; i < 24; i++) this.L[i] += w * (LB[i & 1][mod(pc - (i >> 1))] + (i & 1 ? 0 : P.biaisMaj));
      this.voise += dur;
      if (!this.key) { const i = this._meilleur(); if (this._verrouPret(i)) this._fixeTon(this._de(i), b.last, false); }
    }

    /* Note dont la classe vient d'être suggérée, entendue avec une clarté faible : sans doute notre propre piano. */
    _ecartee(midi, clarte) { return this.P.clarteSuggeree > 0 && clarte < this.P.clarteSuggeree && this.suggerees.has(mod(midi)); }
    notesSuggerees(a) { this.suggerees = new Set(a.map(mod)); }

    _ouvreNote(r, debut, t, conf) {
      const c = this.cur = { midi: r, debut, last: t, somme: 0, nb: 1, clarte: conf, appui: false }; this.finAttente = null;
      this._emet('noteCourante', { midi: r, debut });
      this.onsets.push(debut); if (this.onsets.length > 80) this.onsets.shift();
      if (this.tape) this._resynchro(debut);
      if (this.key && !this._ecartee(r, conf)) { this._attaque(mod(r), debut, t); this._decide(t); }
      return c;
    }
    _fermeNote(pause) {
      const c = this.cur; if (!c) return;
      this.cur = null; this._emet('noteCourante', null);
      const fin = c.last + DT, dur = fin - c.debut; this.rapide = dur < this.P.noteRapide; this.tFinNote = fin;
      if (dur < this.P.noteMin) return;
      if (!c.appui && this.mel.length && this.mel[this.mel.length - 1] === c.ref) this.mel.pop();
      if (c.midi >= 48) { const h = this.hauts; h.push(c.midi); if (h.length > 40) h.shift(); this.tess = h.slice().sort((a, b) => a - b)[h.length >> 1]; }
      const e = c; e.pc = mod(c.midi); e.fin = fin; e.cents = Math.round(100 * (c.somme / c.nb)); e.fin_de_phrase = pause || dur >= this.P.noteLongue; e.clarteMoy = c.clarte / c.nb;
      { const l = this.grille[this.grille.length - 1]; if (l && l.chant === this.nChant && fin > l.t + l.dur) l.dur = fin - l.t; } // la case en cours dure jusqu'à la dernière note entendue
      this.notes.push(e); this._emet('note', { midi: e.midi, pc: e.pc, debut: e.debut, fin: e.fin, cents: e.cents, fin_de_phrase: e.fin_de_phrase });
      this._tonalite(e, dur);
      if (dur >= this.P.noteLongue && this.key) this._decode(fin); // pas à chaque respiration : la grille ne se réécrit qu'au bout d'une note longue ou d'une vraie pause
      if (pause) this.finAttente = fin; // une note longue sans respiration ne termine pas une phrase
    }

    /* Une phrase finit sur une vraie pause, à l'échelle du chant : une respiration de quelques dixièmes dans un chant lent n'en est pas une. */
    _seuilPhrase() {
      const P = this.P, ns = this.notes, n = ns.length, iv = []; for (let i = Math.max(1, n - 16); i < n; i++) iv.push(ns[i].debut - ns[i - 1].debut);
      return Math.max(P.pauseMin, iv.length < 4 ? 0 : P.pauseRel * iv.sort((a, b) => a - b)[iv.length >> 1]);
    }

    /* ---------- Tonalité ---------- */
    _ix(k) { return k.tonic * 2 + (k.mode === 'maj' ? 0 : 1); }
    _de(i) { return { tonic: i >> 1, mode: i & 1 ? 'min' : 'maj' }; }
    _logP(i, pc) { return this.LP[i & 1][mod(pc - (i >> 1))]; }
    _dansGamme(i, pc) { return GAMMES[i & 1 ? 'min' : 'maj'].includes(mod(pc - (i >> 1))); }
    _confiance(v, i) { let z = 0; const m = Math.max(...v); for (let x = 0; x < v.length; x++) z += Math.exp(v[x] - m); return Math.exp(v[i] - m) / z; }

    _apriori() { const L = new Float64Array(24); for (let i = 0; i < 24; i += 2) L[i] = this.P.priorMaj || 0; return L; }
    _meilleur() { let b = 0; for (let i = 1; i < 24; i++) if (this.L[i] > this.L[b]) b = i; return b; }
    /* Les tonalités encore possibles, avec leur probabilité. Émis quand la liste change d'un dixième : l'interface montre un choix tant que l'avance est faible. */
    _hypotheses() {
      if (this.etat === 'sure' || !this.voise) return;
      const P = this.P, m = Math.max(...this.L), z = this.L.reduce((a, v) => a + Math.exp(v - m), 0), l = [...this.L.keys()].map(i => ({ i, p: Math.exp(this.L[i] - m) / z })).filter(x => x.p >= P.hypMin).sort((a, b) => b.p - a.p).slice(0, 4);
      const sig = l.map(x => x.i + ':' + Math.round(x.p * 10)).join(); if (sig === this.sigHyp) return; this.sigHyp = sig;
      this._emet('tonaliteHypotheses', { liste: l.map(x => ({ ...this._de(x.i), p: x.p })) });
    }

    /* Verrou adaptatif (tests/banc/balayage-tonalite.js). Exiger une avance sur le relatif a fait perdre des premiers verrous au banc : la correction silencieuse s'en charge. */
    _verrouPret(b) {
      const P = this.P, r = this.recentes; if (this.voise >= P.attente) return true;
      if (new Set(r.map(x => x.pc)).size >= 2 && r[r.length - 1].t - r[0].d >= P.limiteTon) return true; // promesse au musicien : une tonalité en 5 s, corrigée ensuite si la preuve change
      if (this.voise < P.attenteMin || new Set(this.recentes.map(x => x.pc)).size < P.notesLock) return false;
      const kb = this._de(b);
      for (let i = 0; i < 24; i++) if (i !== b && this.L[b] - this.L[i] < P.margeLock && !GP.relatif(kb, this._de(i))) return false;
      return true;
    }

    /* Raison apprise : elle décide seule (affichage, « sûre », modulation) ; le moteur applique et prévient l'interface. */
    _tonaliteApprise(e, dur) {
      const ecartee = this._ecartee(e.midi, e.clarteMoy), t = e.fin;
      this.voise += ecartee ? 0 : dur; if (e.fin_de_phrase) this.finsPhrase++;
      this.recentes.push({ pc: e.pc, w: ecartee ? 0 : Math.min(dur, 1), t, d: e.debut }); if (this.recentes.length > 200) this.recentes.shift();
      if (ecartee) return;
      const d = this.R.note(e);
      this.L = Float64Array.from(this.R.la);
      this._hypotheses();
      if (this.reglages.tonalite) return;
      if (!this.key) { const b = this.R.meilleure(); if (b !== this.provi && this.voise > 1) { this.provi = b; this._emet('tonaliteProvisoire', { ...this._de(b), confiance: Math.exp(this.R.la[b]), etat: 'provisoire' }); } }
      if (!d) return;
      const k = { tonic: d.tonic, mode: d.mode };
      if (!this.key || this.key.tonic !== k.tonic || this.key.mode !== k.mode) {
        if (this.key && !d.modulation) this.delaiCorrection = t - d.depuis;
        this._fixeTon(k, t, !!d.modulation, !!this.key && !d.modulation, d.modulation ? d.depuis : 0);
      }
      if (this.etat !== d.etat) {
        this.etat = d.etat;
        // Sûre, ou de nouveau probable si la preuve faiblit : l'interface doit le savoir, « sûre » ne reste jamais affiché à tort.
        this._emet('tonalite', { ...this.key, confiance: d.p, modulation: false, de: null, etat: d.etat, t });
        if (d.etat === 'sure') this._emet('tonaliteHypotheses', { liste: [{ ...this.key, p: d.p }] });
      }
    }

    _tonalite(e, dur) {
      if (this.R) return this._tonaliteApprise(e, dur);
      const P = this.P, ecartee = this._ecartee(e.midi, e.clarteMoy), w = ecartee ? 0 : Math.min(dur, 1), t = e.fin; // docs/noyau-musicien.md, principe 2 : une fin de phrase n'est pas la tonique, elle ne compte que pour l'accord
      this.voise += ecartee ? 0 : dur; if (e.fin_de_phrase) this.finsPhrase++;
      this.recentes.push({ pc: e.pc, w, t, d: e.debut }); if (this.recentes.length > 200) this.recentes.shift();
      for (let i = 0; i < 24; i++) this.L[i] += w * this._logP(i, e.pc);
      this._hypotheses();
      if (this.reglages.tonalite) return;
      if (!this.key) {
        const b = this._meilleur();
        if (b !== this.provi && this.voise > 1) { this.provi = b; this._emet('tonaliteProvisoire', { ...this._de(b), confiance: this._confiance(this.L, b), etat: 'provisoire' }); }
        if (this._verrouPret(b)) this._fixeTon(this._de(b), t, false);
        return;
      }
      const ic = this._ix(this.key);
      if (this.etat === 'probable') {
        const b = this._meilleur();
        if (b === ic) this.tete = null; else if (!this.tete || this.tete.i !== b) this.tete = { i: b, t }; // depuis quand la preuve désigne une autre tonalité : sert à mesurer le rattrapage
        if (t - this.lockT < P.fenetreCorrection && b !== ic && this.L[b] - this.L[ic] >= P.margeCorrection) { this.delaiCorrection = t - this.tete.t; this._fixeTon(this._de(b), t, false, true); return; }
        let av = 1e12; for (let i = 0; i < 24; i++) if (i !== ic && this.L[ic] - this.L[i] < av) av = this.L[ic] - this.L[i];
        if (t - this.lockT >= P.fenetreCorrection || (P.margeSure && this.voise >= P.voixSure && av >= P.margeSure)) { this.etat = 'sure'; const cf = this._confiance(this.L, ic); this._emet('tonalite', { ...this.key, confiance: cf, modulation: false, de: null, etat: 'sure', t }); this._emet('tonaliteHypotheses', { liste: [{ ...this.key, p: cf }] }); }
      }
      if (!this.reglages.modulationAuto) return;
      // Preuve de modulation : CUSUM. Une tonalité sûre ne bouge pas sur une note entendue sans netteté.
      if (P.clarteSure > 0 && e.clarteMoy < P.clarteSure) return;
      const hors = !this._dansGamme(ic, e.pc);
      for (let i = 0; i < 24; i++) {
        if (i === ic) continue;
        const av = this.cusum[i]; this.cusum[i] = Math.max(0, av + w * (this._logP(i, e.pc) - this._logP(ic, e.pc)));
        if (av === 0 && this.cusum[i] > 0) { this.candDebut[i] = t; this.candPhrases[i] = 0; this.candHors[i] = 0; }
        if (this.cusum[i] === 0) { this.candDebut[i] = -1; continue; }
        if (e.fin_de_phrase) this.candPhrases[i]++;
        if (hors && this._dansGamme(i, e.pc)) this.candHors[i] += dur;
        const span = t - this.candDebut[i];
        if (this.cusum[i] >= P.H && !GP.relatif(this._de(ic), this._de(i)) && this.candPhrases[i] >= P.phrasesMod && span >= P.tempsMod && this.candHors[i] / Math.max(span, 1e-3) >= P.horsGamme) {
          const depuis = this.candDebut[i], sc = new Float64Array(24);
          this.recentes.forEach(x => { if (x.t >= depuis) for (let k = 0; k < 24; k++) sc[k] += x.w * this._logP(k, x.pc); });
          const ord = [...sc.keys()].filter(k => k !== ic).sort((x, y) => sc[y] - sc[x]);
          if (ord[0] !== i || sc[i] - sc[ord[1]] < ((i & 1) !== (ic & 1) ? P.margeModeMod : P.margeMod)) continue;
          this.L = sc.slice(); this._fixeTon(this._de(i), t, true, false, depuis);
          return;
        }
      }
    }
    _fixeTon(k, t, modulation, correction = false, depuis = 0) {
      const de = this.key;
      this.key = { tonic: k.tonic, mode: k.mode }; this.etat = modulation ? 'sure' : 'probable'; this.tete = null; this.cusum.fill(0); this.candDebut.fill(-1); this.candPhrases.fill(0); this.candHors.fill(0);
      this.lockT = (this.lockT == null || modulation) ? t : this.lockT;
      this.prevu = null; this.dernierAlign = -1;
      for (const x of this.mel) if (x.t >= (modulation ? depuis : 0)) x.tonic = k.tonic; // l'alignement compare des notes relatives à la tonique : une reprise modulée reste une reprise
      const cf = this._confiance(this.L, this._ix(this.key));
      this._emet('tonalite', { ...this.key, confiance: cf, modulation, de, etat: this.etat, correction, t });
      if (modulation) this._emet('tonaliteHypotheses', { liste: [{ ...this.key, p: cf }] });
      this._refaire(modulation ? depuis : 0, t);
    }
    /* Pour l'interface : tonalité imposée par le musicien */
    fixerTonalite(k, t = this.tNow) { this.reglages.tonalite = k; this._fixeTon(k, t, false); this.etat = 'sure'; }
    reprendreTonaliteAuto() { this.reglages.tonalite = null; }

    /* ---------- Accords : Viterbi en ligne, sur les attaques ---------- */
    _initFiltre() {
      const m = this.key.mode;
      this.cands = GP.diatonique(this.key).map(c => ({ ...c, tons: GP.notesAccord(c.racine, c.q) }));
      this.E = this.cands.map(c => this._ligneE(c));
      this.delta = this.cands.map(c => c.deg === 1 ? 0 : -1); this.entree = this.cands.map(() => -9); this.courant = -1;
      this.logT = {}; const T = TRANSITIONS[m];
      for (const a in T) { this.logT[a] = {}; for (const b in T[a]) this.logT[a][b] = Math.log(T[a][b] * 3); }
    }
    _ligneE(c) {
      const P = this.P, l = new Float64Array(12), g = GAMMES[this.key.mode];
      for (let pc = 0; pc < 12; pc++) l[pc] = Math.log(c.tons.includes(pc) ? P.pAccord : g.includes(mod(pc - this.key.tonic)) ? P.pGamme : P.pHors);
      // Mineur : la sensible n'existe que dans le 5 majeur, et le 5 majeur refuse le 7e degré naturel.
      // Le 5 s'entend souvent 5 septième : le 4e degré chanté ne le contredit pas tout à fait.
      if (c.deg === 5) l[mod(c.racine + 10)] = Math.log(P.pSept);
      if (this.key.mode === 'min') { const se = mod(this.key.tonic + 11), so = mod(this.key.tonic + 10); if (!c.tons.includes(se)) l[se] = Math.log(P.pHors); else l[so] = Math.log(P.pHors); }
      return l;
    }
    _assureCand(deg) {
      let i = this.cands.findIndex(c => c.deg === deg); if (i >= 0) return i;
      const a = GP.accordDeDegre(this.key, deg); if (!a) return -1;
      const c = { ...a, tons: GP.notesAccord(a.racine, a.q).slice(0, 3) };
      this.cands.push(c); this.E.push(this._ligneE(c)); this.delta.push(Math.min(...this.delta)); this.entree.push(-9);
      return this.cands.length - 1;
    }
    _cout(j, i, t) {
      const P = this.P, lt = (this.logT[this.cands[j].deg] || {})[this.cands[i].deg];
      return Math.max(0, P.cout - P.coutTrans * (lt == null ? Math.log(.3) : lt) + (t - this.entree[j] < (this.reglages.basseReelle ? P.jeuneBasse : P.jeune) ? P.surcout : 0));
    }
    /* Viterbi en ligne : un accord ne peut changer qu'à une attaque. L'avance d'un accord sur un autre reste bornée par le coût du changement. */
    _attaque(pc, debut, t) {
      this.fige = false;
      const P = this.P, d = this.delta, n = d.length, nd = new Array(n), ent = this.entree.slice();
      for (let i = 0; i < n; i++) {
        let v = d[i], from = i;
        for (let j = 0; j < n; j++) if (j !== i) { const x = d[j] - this._cout(j, i, debut); if (x > v) { v = x; from = j; } }
        nd[i] = v; if (from !== i) ent[i] = debut;
      }
      this.delta = nd; this.entree = ent;
      const a = (this.rapide ? 0 : P.attaque) * P.gain; // dans une vocalise, l'attaque ne prouve rien
      for (let i = 0; i < n; i++) nd[i] += a * this.E[i][pc];
      this._normalise();
    }
    _evidence(pc, dt) { const g = this.P.gain * dt, d = this.delta; for (let i = 0; i < d.length; i++) d[i] += g * this.E[i][pc]; this._normalise(); }
    _normalise() { const d = this.delta; let m = -1e12; for (let i = 0; i < d.length; i++) if (d[i] > m) m = d[i]; for (let i = 0; i < d.length; i++) d[i] -= m; }
    _decide(t, force = false) {
      if (this.fige) return;
      const d = this.delta; let b = 0; for (let i = 1; i < d.length; i++) if (d[i] > d[b]) b = i;
      if (b === this.courant) return;
      // Une case affichée tient : sur une note entendue sans netteté (voix réelle, choeur), il faut une avance nette pour la quitter, plus nette encore si elle vient de naître. Une broderie ne change rien, une note franche passe sans délai.
      if (!force && this.courant >= 0 && this.cur && (this.rapide || this.cur.clarte / this.cur.nb < this.P.clarteAcc)) { const P = this.P; if (d[b] - d[this.courant] < P.margeAcc + (t - this.tChange < P.caseTenue ? P.margeJeuneAcc : 0)) return; }
      this._changer(b, this.cur ? this.cur.debut : t, t);
    }
    _probas() { const d = this.delta; let z = 0; for (let i = 0; i < d.length; i++) z += Math.exp(d[i]); return d.map(v => Math.exp(v) / z); }
    _changer(b, tCase, t, opts = {}) {
      const c = this.cands[b], pr = this._probas(), g = this.grille, last = g[g.length - 1];
      this.courant = b; this.tChange = t;
      if (last && last.chant === this.nChant) { if (tCase <= last.t) tCase = last.t + .001; last.dur = tCase - last.t; }
      const alt = this.cands.map((x, i) => ({ deg: x.deg, racine: x.racine, q: x.q, p: pr[i] })).filter(x => x.deg !== c.deg).sort((a, b) => b.p - a.p).slice(0, 2);
      const ambigu = !!alt.length && alt[0].p >= this.P.ambigu * pr[b];
      const cas = { ambigu, deg: c.deg, racine: c.racine, q: c.q, basse: this.basse && c.tons.includes(this.basse.pc) ? this.basse.pc : c.racine, t: tCase, dur: Math.max(0, t - tCase), conf: pr[b], alternatives: alt, mots: '', lettre: null, chant: this.nChant, ton: { ...this.key } };
      g.push(cas);
      if (opts.silencieux) return cas;
      this._emet('accord', { index: g.length - 1, deg: cas.deg, racine: cas.racine, q: cas.q, basse: cas.basse, t: tCase, confiance: cas.conf, provisoire: this.etat !== 'sure' || !!opts.anticipe, ambigu, alternatives: alt });
      this._predit(t);
      return cas;
    }
    /* Décodage complet des notes du chant : ce que l'on aurait dit en connaissant la suite. Les cases corrigées par le musicien sont imposées. */
    _decode(fin = this.tNow, reanalyse = false) {
      const P = this.P, ns = this.notes, i0 = Math.max(this.iDecode, ns.length - P.fenetreDecode), n = this.cands.length, N1 = ns.length - i0; if (N1 <= 0) return;
      const g = this.grille, fixes = g.filter(c => c.corrige && c.chant === this.nChant), pre = new Array(N1);
      let d = this.cands.map(c => c.deg === 1 ? 0 : -1), ent = d.map(() => -9), rapide = false;
      const sv = this.entree;
      for (let k = 0; k < N1; k++) {
        const e = ns[i0 + k], dur = e.fin - e.debut, nd = new Array(n), bp = new Array(n), ne = ent.slice(); this.entree = ent;
        for (let i = 0; i < n; i++) { let v = d[i], from = i; for (let j = 0; j < n; j++) if (j !== i) { const x = d[j] - this._cout(j, i, e.debut); if (x > v) { v = x; from = j; } } nd[i] = v; bp[i] = from; if (from !== i) ne[i] = e.debut; }
        const w = P.gain * ((rapide ? 0 : P.attaque) + Math.min(dur, P.duree)); let m = -1e12;
        const fx = fixes.find(c => e.debut + 1e-3 >= c.t && e.debut < c.t + c.dur); e.fixe = !!fx;
        for (let i = 0; i < n; i++) { nd[i] += w * this.E[i][e.pc]; if (fx && this.cands[i].deg === fx.deg) nd[i] += 50; if (nd[i] > m) m = nd[i]; }
        for (let i = 0; i < n; i++) nd[i] -= m;
        pre[k] = bp; d = nd; ent = ne; rapide = dur < P.noteRapide;
      }
      this.entree = sv;
      let s = 0; for (let i = 1; i < n; i++) if (d[i] > d[s]) s = i;
      for (let k = N1 - 1; k >= 0; k--) { ns[i0 + k].deg = this.cands[s].deg; s = pre[k][s]; }
      // Le décodage n'entend que la mélodie : avec une vraie basse, on garde les frontières entendues.
      const refondre = !reanalyse && !this.reglages.basseReelle;
      if (refondre) this._refond(fin, i0);
      // La case en cours, ou toutes les cases s'il n'y a pas de refonte, prend le degré majoritaire de ses notes.
      for (let i = g.length - 1, i1 = refondre ? i : 0; i >= i1; i--) {
        const c = g[i]; if (c.chant !== this.nChant || c.t + c.dur < ns[i0].debut || c.t < fin - 30) break;
        if (c.corrige || c.deMemoire || fin - c.t < P.retard) continue;
        const v = {}; let bd = null, bv = 0;
        for (let k = ns.length - 1; k >= i0 && ns[k].fin > c.t; k--) { const e = ns[k], a = Math.max(e.debut, c.t), b = Math.min(e.fin, c.t + c.dur); if (b > a) { v[e.deg] = (v[e.deg] || 0) + b - a; if (v[e.deg] > bv) { bv = v[e.deg]; bd = e.deg; } } }
        if (bd != null && bd !== c.deg) {
          const nv = GP.accordDeDegre(this.key, bd); c.deg = bd; c.racine = nv.racine; c.q = nv.q; c.basse = nv.racine;
          this._emet('accordCorrige', { index: i, accord: { ...c } });
        }
      }
      this._nettoie(fin);
    }
    /* La grille suit le décodage, frontières comprises : un changement tombe sur l'attaque de la note où il s'applique. Une case du musicien, ce qui la précède et la case en cours ne bougent pas. */
    _refond(fin, i0) {
      const g = this.grille, ns = this.notes, P = this.P, fixe = c => c.corrige || c.deMemoire; let a = g.length - 1;
      if (a < 1) return;
      while (a > 0 && g[a - 1].chant === this.nChant && !fixe(g[a - 1]) && g[a - 1].t >= fin - 30 && g[a - 1].t + g[a - 1].dur >= ns[i0].debut) a--;
      let b = a; while (b < g.length - 1 && g[b].t + g[b].dur <= fin - P.retard) b++;
      if (b === a) return;
      const tA = g[a].t, tB = g[b].t, nv = [];
      for (let k = i0; k < ns.length && ns[k].debut < tB; k++) {
        const e = ns[k]; if (e.fin <= tA || e.deg == null) continue;
        const l = nv[nv.length - 1]; if (l && l.deg === e.deg) continue;
        if (l) l.dur = e.debut - l.t;
        const t = l ? e.debut : tA, o = g.slice(a, b).find(c => t < c.t + c.dur) || g[b - 1], z = GP.accordDeDegre(this.key, e.deg);
        nv.push(o.deg === e.deg ? { ...o, t } : { ...o, deg: e.deg, racine: z.racine, q: z.q, basse: z.racine, t, conf: (o.alternatives.find(x => x.deg === e.deg) || { p: .5 }).p, alternatives: [{ deg: o.deg, racine: o.racine, q: o.q, p: o.conf }, ...o.alternatives.filter(x => x.deg !== e.deg)].slice(0, 2), retro: true, ambigu: true });
      }
      if (!nv.length) return;
      nv[nv.length - 1].dur = tB - nv[nv.length - 1].t;
      const av = g.slice(a, b), memes = nv.length === av.length && nv.every((c, i) => c.t === av[i].t);
      if (memes && nv.every((c, i) => c.deg === av[i].deg)) return;
      nv.forEach(c => { c.mots = ''; });
      for (const o of av) if (o.mots) { const c = nv.find(x => o.t < x.t + x.dur) || nv[nv.length - 1]; c.mots = (c.mots ? c.mots + ' ' : '') + o.mots; }
      g.splice(a, b - a, ...nv);
      if (memes) nv.forEach((c, i) => { if (c.deg !== av[i].deg) this._emet('accordCorrige', { index: a + i, accord: { ...c } }); });
      else this._emet('grilleRefaite', { depuis: a, t: fin });
    }
    /* Le squelette se lit d'un coup d'oeil : deux cases voisines du même degré n'en font qu'une, une case de passage trop brève disparaît. */
    _nettoie(fin) {
      const g = this.grille, P = this.P, ba = this.reglages.basseReelle; let dep = g.length;
      for (let i = g.length - 2; i >= 1 && g[i].chant === this.nChant && g[i].t > fin - 30; i--) {
        const c = g[i], av = g[i - 1]; if (av.chant !== this.nChant || fin - c.t - c.dur < P.retard) continue;
        if (av.deg === c.deg || (c.dur < (ba ? P.caseMinBasse : P.caseMin) && !c.corrige && !c.deMemoire) || (!ba && c.dur < P.blip && !c.corrige && !c.deMemoire && g[i + 1] && g[i + 1].deg === av.deg && this._partDe(av, c) >= P.blipFrac)) {
          av.dur = c.t + c.dur - av.t; g.splice(i, 1); dep = i - 1; if (g[i] && g[i].deg === av.deg && !g[i].corrige && !g[i].deMemoire && fin - g[i].t - g[i].dur >= P.retard) { av.dur = g[i].t + g[i].dur - av.t; g.splice(i, 1); }
        }
      }
      if (dep < g.length) this._emet('grilleRefaite', { depuis: dep, t: fin });
    }
    /* Part du temps chanté dans la case c qui appartient à l'accord de la case a. */
    _partDe(a, c) {
      const t = GP.notesAccord(a.racine, a.q), ns = this.notes; let w = 0, z = 0;
      for (let k = ns.length - 1; k >= 0 && ns[k].fin > c.t; k--) { const e = ns[k], d = Math.min(e.fin, c.t + c.dur) - Math.max(e.debut, c.t); if (d > 0) { z += d; if (t.includes(e.pc)) w += d; } }
      return z ? w / z : 1;
    }
    /* Réanalyse : les notes déjà chantées ne sont pas perdues quand la tonalité se verrouille ou change. */
    _refaire(depuis, t) {
      this._initFiltre();
      const g = this.grille, ns = this.notes; let i0 = 0; while (i0 < ns.length && ns[i0].fin <= depuis) i0++;
      this.iDecode = i0; const P = this.P;
      let ic = g.length; while (ic > 0 && g[ic - 1].chant === this.nChant && g[ic - 1].t + g[ic - 1].dur > depuis) ic--;
      const fixes = g.slice(ic).filter(c => c.corrige || c.deMemoire).map(c => ({ ...c, deg: (this.cands.find(y => y.racine === c.racine) || {}).deg }));
      g.length = ic; fixes.forEach(f => { if (f.deg) g.push(f); });
      this._decode(t, true);
      ic = Math.min(ic, g.length); g.length = ic; // le nettoyage du décodage a pu fusionner des cases d'avant : ne pas rallonger la grille avec des trous
      for (let k = Math.max(i0, ns.length - P.fenetreDecode); k < ns.length; k++) {
        const e = ns[k], l = g[g.length - 1];
        if (g.length > ic && l.deg === e.deg) continue;
        const i = this.cands.findIndex(c => c.deg === e.deg); this.courant = -1;
        const c = this._changer(i, e.debut, e.debut, { silencieux: true }); c.retro = true; c.conf = .5;
        const f = fixes.find(x => e.debut >= x.t && e.debut < x.t + x.dur && x.deg === c.deg); if (f) { c.corrige = f.corrige; c.deMemoire = f.deMemoire; }
      }
      const l = g[g.length - 1];
      if (g.length > ic) { l.dur = Math.max(0, t - l.t); this.courant = this.cands.findIndex(c => c.deg === l.deg); this.delta[this.courant] = 0; this.entree[this.courant] = l.t; this._normalise(); } else this.courant = -1;
      this._emet('grilleRefaite', { depuis: ic, t });
      if (this.cur && !this._ecartee(this.cur.midi, this.cur.clarte / this.cur.nb)) { this._attaque(mod(this.cur.midi), this.cur.debut, t); this._decide(t); }
    }

    /* ---------- Correction par le musicien ---------- */
    corriger(index, deg) {
      const c = this.grille[index]; if (!c) return null;
      const a = GP.accordDeDegre(c.ton, deg); if (!a) return null;
      Object.assign(c, { deg, racine: a.racine, q: a.q, basse: a.racine, conf: 1, corrige: true });
      this._emet('accordCorrige', { index, accord: { ...c }, parMusicien: true });
      if (c.chant === this.nChant && this.key && c.ton.tonic === this.key.tonic && c.ton.mode === this.key.mode) { this._assureCand(deg); this._decode(); }
      if (index === this.grille.length - 1 && this.key && c.chant === this.nChant) {
        const i = this._assureCand(deg);
        if (i >= 0) { this.courant = i; this.delta[i] = Math.max(...this.delta) + 1; this._normalise(); this.entree[i] = c.t; }
      }
      return c;
    }
    ajouterMots(texte) { const c = this.grille[this.grille.length - 1]; if (c) { c.mots = (c.mots ? c.mots + ' ' : '') + texte; this._emet('accordCorrige', { index: this.grille.length - 1, accord: { ...c }, mots: true }); } }

    /* ---------- Mémoire de phrase ---------- */
    _appuie(c) {
      c.appui = true;
      const m = this.mel, pc = mod(c.midi), l = m[m.length - 1];
      if (l && l.pc === pc) return; // une note répétée ou coupée compte une fois : l'alignement ne doit pas en dépendre
      m.push({ pc, t: c.debut, tonic: this.key ? this.key.tonic : null, note: c }); c.ref = m[m.length - 1];
      if (this.key && this.P.memoire) this._aligne(this.tNow);
    }
    _rel(n) { return mod(n.pc - (n.tonic == null ? this.key.tonic : n.tonic)); }
    _aligne(t) {
      const P = this.P, m = this.mel, n = m.length - 1;
      if (n < P.K + P.ecartMin) { this.prevu = null; return; } // mémoire encore trop courte
      const rel = m.map(x => this._rel(x)), Q = rel.slice(n - P.K + 1, n + 1), r = aligne(Q, rel, n - P.K - P.ecartMin + 1, this.dernierAlign >= 0 ? this.dernierAlign + 1 : -1);
      if (r.d > P.D) {
        this.dernierAlign = -1; this.prevu = null;
        // Début de reprise : trop peu de notes pour aligner, mais une grille corrigée par le musicien vaut la peine d'être crue sur une courte citation exacte.
        const c = aligne(rel.slice(n - P.K2 + 1, n + 1), rel, n - P.K2 - P.ecartMin + 1, -1), a = c.d === 0 && m[c.j].note;
        if (a && a.fixe) this._renforce(a.deg, true, .8, t);
        return;
      }
      const j = r.j; this.dernierAlign = j;
      const dp = m[j].t - m[Math.max(0, j - P.K + 1)].t, dn = m[n].t - m[n - P.K + 1].t, rap = dp > 0 ? Math.min(1.25, Math.max(.8, dn / dp)) : 1;
      const a0 = m[j].note, deg = a0 && a0.deg;
      if (deg == null) { this.prevu = null; return; }
      const conf = 1 - r.d / (P.K + 1);
      this._renforce(deg, !!a0.fixe, conf, t);
      let x = j + 1; const lim = n - P.K; while (x <= lim && (m[x].note.deg == null || m[x].note.deg === deg)) x++;
      if (x > lim || m[x].t - m[j].t > P.horizon) { this.prevu = null; return; }
      const su = m[x].note, quand = m[n].t + (m[x].t - m[j].t) * rap, a = GP.accordDeDegre(this.key, su.deg);
      this.prevu = { deg: su.deg, quand, faitLe: t, corrige: !!su.fixe };
      this._emet('prochain', { deg: su.deg, racine: a.racine, q: a.q, basse: a.racine, dans: Math.max(0, quand - t), appris: true, confiance: conf });
    }
    _renforce(deg, fixe, conf, t) {
      const i = this._assureCand(deg); if (i < 0) return;
      this.delta[i] += (fixe ? this.P.poidsCorrige : this.P.poidsMem) * conf; this._normalise(); this._decide(t, true); // la mémoire n'est pas une broderie
      if (fixe && i === this.courant) this.grille[this.grille.length - 1].deMemoire = true; // une correction du musicien se propage : elle ne sera pas réécrite
    }
    _appliquePrevision(t) {
      const p = this.prevu, P = this.P; if (!p || t < p.quand - P.anticipe) return;
      this.prevu = null;
      if (t - p.faitLe >= 3 || t - this.tVoix > P.silence) return; // personne ne chante : aucune case d'avance
      const i = this._assureCand(p.deg); if (i < 0 || i === this.courant) return;
      this.delta[i] = Math.max(...this.delta) + .01; this._normalise(); this.entree[i] = t;
      const c = this._changer(i, t, t, { anticipe: true }); if (p.corrige) c.deMemoire = true; this.fige = true; // la note qui finit ne doit pas ramener l'ancien accord
    }
    /* Sans mémoire : la matrice donne le prochain le plus probable, le rythme d'accords donne la date. */
    _predit(t) {
      if (!this.key || this.prevu || this.courant < 0) return;
      const c = this.cands[this.courant], row = TRANSITIONS[this.key.mode][c.deg]; let bd = null, bp = -1;
      for (const d in row) if (row[d] > bp && this.cands.some(x => x.deg === +d)) { bp = row[d]; bd = +d; }
      if (bd == null) return;
      const a = GP.accordDeDegre(this.key, bd), tp = this._periode();
      this._emet('prochain', { deg: bd, racine: a.racine, q: a.q, basse: a.racine, dans: tp ? (this.mesureCourante || 4) * tp : null, appris: false, confiance: bp });
    }

    /* Lettres de section : phrase entière proche d'une phrase déjà entendue, et même note finale, car la cadence décide de la grille (5 ou 1). */
    _finPhrase(t) {
      const m = this.mel, a = this.debutPhrase, seg = m.slice(a); let lettre = null, reprise = false;
      if (seg.length >= 4 && this.key) {
        const s = seg.map(x => this._rel(x)); let best = null;
        for (const ph of this.phrases) { if (ph.s[ph.s.length - 1] !== s[s.length - 1]) continue; const d = distance(s, ph.s) / Math.max(s.length, ph.s.length); if (best == null || d < best.d) best = { d, l: ph.l }; }
        if (best && best.d <= .34) { lettre = best.l; reprise = true; } else lettre = String.fromCharCode(65 + (this.nLettres++ % 26));
        this.phrases.push({ s, l: lettre }); this.debutPhrase = m.length;
        const g = this.grille; for (let i = g.length - 1; i >= 0; i--) { if (g[i].chant !== this.nChant || g[i].lettre) break; g[i].lettre = lettre; }
      }
      this._emet('phrase', { t, lettre, reprise });
    }

    /* ---------- Tempo ---------- */
    taperTempo(t) {
      const T = this.taps; if (T.length && t - T[T.length - 1] > 2.5) T.length = 0;
      T.push(t); if (T.length > 12) T.shift();
      if (T.length < 3) return null;
      const iv = []; for (let i = 1; i < T.length; i++) iv.push(T[i] - T[i - 1]); iv.sort((a, b) => a - b);
      const p = iv[iv.length >> 1];
      this.tape = { p, phi: t }; this.prochainTemps = null;
      this._emet('tempo', { bpm: 60 / p, mesure: this._mesure(p, t), confiance: 1, tape: true });
      return 60 / p;
    }
    _resynchro(t) { const a = this.tape, k = Math.round((t - a.phi) / a.p), e = t - a.phi - k * a.p; if (Math.abs(e) < .1) { a.phi += .1 * e; a.p += .1 * e / Math.max(k || 1, 8); } }
    _periode() { return this.tape ? this.tape.p : this.tempoAuto ? this.tempoAuto.p : null; }
    /* Autocorrélation des attaques (mesurée dans tests/banc/mesure-appoint.js) */
    _tempo(t) {
      if (t - this.dernierTempo >= 1 && !this.tape) {
        this.dernierTempo = t;
        const rec = this.onsets.filter(x => x > t - 12);
        if (rec.length >= 5) {
          let bp = null, bs = -1;
          for (let p = .3; p <= 1.25; p *= 1.015) {
            let s = 0;
            for (let i = 0; i < rec.length; i++) for (let j = i + 1; j < rec.length; j++) { const d = rec[j] - rec[i]; if (d > 4) break; const k = Math.round(d / p), e = d - k * p; if (k) s += Math.exp(-e * e / (2 * .025 * .025)) / Math.sqrt(k); }
            s *= Math.exp(-Math.pow(Math.log2(p / .65), 2) / (2 * .8 * .8));
            if (s > bs) { bs = s; bp = p; }
          }
          let zr = 0, zi = 0; rec.forEach(x => { const w = 2 * Math.PI * x / bp, g = Math.exp((x - t) / 5); zr += g * Math.cos(w); zi += g * Math.sin(w); });
          const phi = Math.atan2(zi, zr) / (2 * Math.PI) * bp, conf = Math.abs(Math.hypot(zr, zi)) / rec.reduce((a, x) => a + Math.exp((x - t) / 5), 0);
          const av = this.tempoAuto; this.tempoAuto = { p: bp, phi, conf };
          if (!av || Math.abs(bp / av.p - 1) > .03) this._emet('tempo', { bpm: 60 / bp, mesure: this._mesure(bp, t), confiance: conf, tape: false });
        }
      }
      const b = this.tape || this.tempoAuto; if (!b) return;
      if (this.prochainTemps == null) this.prochainTemps = b.phi + Math.ceil((t - b.phi) / b.p) * b.p;
      if (t >= this.prochainTemps) {
        const mes = this.mesureCourante || 4; this._emet('temps', { n: (this.numTemps++ % mes) + 1, mesure: mes, t: this.prochainTemps });
        this.prochainTemps = b.phi + (Math.floor((t - b.phi) / b.p) + 1) * b.p; // la phase peut avoir bougé depuis le temps précédent
      }
    }
    /* 3 ou 4 temps : la durée des notes se concentre sur le premier temps. Faible : une hypothèse, pas un fait. */
    _mesure(p, t) {
      const ns = this.notes.filter(n => n.fin > t - 20); let best = 4, bv = -1;
      for (const m of [3, 4]) { const h = new Float64Array(m); ns.forEach(n => { h[Math.round(n.debut / p) % m] += n.fin - n.debut; }); const v = Math.max(...h) / (h.reduce((a, b) => a + b, 0) || 1) * m; if (v > bv) { bv = v; best = m; } }
      this.mesureCourante = best;
      return best;
    }

    /* ---------- Basse réelle (réglage explicite : un autre instrumentiste joue) ---------- */
    _basseEntree(v) {
      this.resteB.push(v);
      if (this.resteB.length < 400) return; // lot de 25 ms
      const y = this.dec2k(Float32Array.from(this.resteB)); this.resteB.length = 0;
      for (let i = 0; i < y.length; i++) { this.tB[this.nB] = y[i]; this.nB = (this.nB + 1) % 512; }
      if (++this.pasB >= 2) { this.pasB = 0; this._basseAnalyse(); }
    }
    _basseAnalyse() {
      const W = 512, x = new Float32Array(W); for (let j = 0; j < W; j++) x[j] = this.tB[(this.nB + j) % W] * (.5 - .5 * Math.cos(2 * Math.PI * j / (W - 1)));
      const mags = new Float64Array(70);
      for (let m = 28; m <= 67; m++) { const w = 2 * Math.cos(2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) / 2000); let s1 = 0, s2 = 0; for (let j = 0; j < W; j++) { const s = x[j] + w * s1 - s2; s2 = s1; s1 = s; } mags[m] = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - w * s1 * s2)); }
      let bm = -1, bv = 0, moy = 0; for (let m = 28; m <= 55; m++) { const v = mags[m] + .6 * mags[m + 12]; moy += v; if (v > bv) { bv = v; bm = m; } }
      const force = bv / (moy / 28 + 1e-12); if (force < this.P.forceBasse) { this.basse = null; return; }
      const pc = mod(bm), av = this.basse; this.basse = { pc, n: av && av.pc === pc ? av.n + 1 : 1 };
      if (!this.key) return;
      if (this.basse.n === 2 && this.cands[this.courant] && this.cands[this.courant].racine !== pc) { const r = this.rapide; this.rapide = true; this._attaque(pc, this.tNow, this.tNow); this.rapide = r; }
      const g = this.P.gainBasse * .05, d = this.delta;
      for (let i = 0; i < d.length; i++) d[i] += g * Math.log(this.cands[i].racine === pc ? .7 : this.cands[i].tons.includes(pc) ? .1 : .02);
      this._normalise(); this._decide(this.tNow);
    }
  }

  GP.Moteur = Moteur;
  // Sous Node (tests, bancs), la Raison apprise se charge avec le moteur ; dans la page, index.html charge ses deux fichiers avant celui-ci.
  if (typeof module !== 'undefined' && module.exports && !GP.Raison) { try { require('./raison-poids.js'); require('./raison.js'); } catch (e) { console.error("Raison apprise non chargée : " + e.message); } }
  GP.creeDecimateur = creeDecimateur;
  GP.TRANSITIONS = TRANSITIONS;
  GP.PARAMS_MOTEUR = P0;
  GP.aligneMelodie = aligne;
})();
