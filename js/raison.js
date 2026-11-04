/* Raison apprise : la tonalité sur 24 tonalités, note par note. Sans DOM, sans dépendance.
   Avec poids.reseau ou poids.reseaux (tests/donnees/ton_reseau.py puis ton-seuils.js) : petits GRU appliqués depuis chacune des 12 toniques, en ensemble.
   Sinon, modèle de Markov caché : probabilité du degré chanté sachant le degré précédent (tables de tests/donnees/ton-entrainer.js),
   plus les degrés de début et de fin de phrase ; la tonalité peut changer à chaque note avec une petite probabilité.
   Décision : rien avant deux classes de hauteur différentes (une note tenue, un bourdon, ne disent pas la tonalité),
   « probable » au plus tard après limite s chantées (promesse au musicien), « sûre » seulement quand la probabilité dépasse un seuil
   réglé pour que « sûre » soit presque toujours juste, modulation quand une autre tonalité (pas le relatif) tient nettement plusieurs notes.
   r.note({midi, debut, fin}) à la fermeture de chaque note ; renvoie l'affichage {t, tonic, mode, etat, p} quand il change, sinon null. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  const mod = n => ((n % 12) + 12) % 12;
  const lse = (a, b) => (a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b)));

  // Réglages par défaut ; ceux du fichier de poids (js/raison-poids.js) les remplacent, ceux passés au constructeur aussi.
  const DEFAUT = {
    beta: 1, gamma: 1, durMax: 1, lambda: .7, eps: .01, af: .5, ai: .3, priorMaj: .5, temperature: 1,
    pauseMin: .2, pauseRel: .25, porte: 0,
    limite: 4.6, attenteMin: 2.5, pMontre: .6, dChange: .25, pSure: .97, voixSure: 6, tenueSure: 0, tenueChange: 0, pGarde: .6, nGarde: 3, pMod: .9, nMod: 4,
    figer: false // une fois sûre, la tonalité ne change plus seule (ni correction ni modulation) ; « sûre » reste révocable
  };

  /* Tables en probabilités (somme 1) vers logarithmes, avec interpolation bigramme / unigramme. */
  function preparer(W, P) {
    const L = { U: [], B: [], F: [], I: [] };
    for (let m = 0; m < 2; m++) {
      L.U[m] = W.U[m].map(Math.log); L.F[m] = W.F[m].map(Math.log); L.I[m] = W.I[m].map(Math.log);
      L.B[m] = W.B[m].map(r => r.map((p, d) => Math.log(P.lambda * p + (1 - P.lambda) * W.U[m][d])));
    }
    return L;
  }

  /* Réseau : un GRU appliqué depuis chacune des 12 toniques (tests/donnees/ton_reseau.py). Mêmes traits que traits() en Python, au calcul près. */
  const sig = x => 1 / (1 + Math.exp(-x));
  function pasGRU(N, h, x) {
    const H = N.H, I = N.I, o = new Float64Array(H), g = new Float64Array(3 * H);
    for (let k = 0; k < 3 * H; k++) { let s = N.bih[k]; const wi = N.Wih[k]; for (let j = 0; j < I; j++) s += wi[j] * x[j]; g[k] = s; }
    const gh = new Float64Array(3 * H);
    for (let k = 0; k < 3 * H; k++) { let s = N.bhh[k]; const wh = N.Whh[k]; for (let j = 0; j < H; j++) s += wh[j] * h[j]; gh[k] = s; }
    for (let j = 0; j < H; j++) { const r = sig(g[j] + gh[j]), z = sig(g[H + j] + gh[H + j]), n = Math.tanh(g[2 * H + j] + r * gh[2 * H + j]); o[j] = (1 - z) * n + z * h[j]; }
    return o;
  }

  class Raison {
    constructor(params = {}, poids = GP.raisonPoids) {
      if (!poids) throw new Error('GP.raisonPoids manquant : charger js/raison-poids.js');
      this.P = { ...DEFAUT, ...(poids.params || {}), ...params };
      // Un réseau, ou plusieurs dont on moyenne les log-probabilités (ensemble choisi sur la validation).
      this.Ns = poids.reseaux || (poids.reseau ? [poids.reseau] : null); this.N = this.Ns ? this.Ns[0] : null;
      if (!this.N) this.L = preparer(poids.tables, this.P);
      this.G = poids.porte || null;
      this.reinit();
    }
    reinit() {
      const P = this.P;
      this.la = new Float64Array(24); for (let i = 0; i < 24; i++) this.la[i] = i & 1 ? 0 : P.priorMaj;
      if (this.N) this.h = this.Ns.map(N => Array.from({ length: 12 }, () => new Float64Array(N.H)));
      this._normalise();
      this.prec = null; this.precFin = null; this.iois = []; this.recents = []; this.voise = 0; this.pcs = new Set();
      this.aff = null; this.etat = null; this.cand = null; this.tete = null; this.bas = 0; this.aEteSure = false;
    }
    _normalise() { let t = -Infinity; for (let i = 0; i < 24; i++) t = lse(t, this.la[i]); for (let i = 0; i < 24; i++) this.la[i] -= t; }
    probas() { return Array.from(this.la, Math.exp); }
    meilleure() { let b = 0; for (let i = 1; i < 24; i++) if (this.la[i] > this.la[b]) b = i; return b; }

    /* Part « chant » d'une note : régression logistique apprise sur de la vraie parole et du chant (voir tests/donnees/ton-entrainer.js). */
    _chant(dur) {
      const G = this.G; if (!G) return 1;
      const r = this.recents, n = r.length, courts = r.filter(x => x < .15).length / Math.max(1, n);
      const md = n ? r.slice().sort((a, b) => a - b)[n >> 1] : dur;
      const z = G[0] + G[1] * Math.log(Math.max(dur, .03)) + G[2] * courts + G[3] * Math.log(Math.max(md, .03));
      return 1 / (1 + Math.exp(-z));
    }

    /* Réseau : [log durée, log silence avant, début de phrase, intervalle/12] partagés, plus le degré relatif à chaque tonique ; sorties en log-probabilités. */
    _noteReseau(midi, debut, fin) {
      const N = this.N, P = this.P, m = Math.round(midi), pc = mod(m), dur = fin - debut, prev = this.prec;
      const gap = prev ? debut - this.precFin : 2;
      let phrase = 0;
      if (prev) {
        const ioi = debut - prev.debut; if (ioi > 0) { this.iois.push(ioi); if (this.iois.length > 16) this.iois.shift(); }
        const s = this.iois.length < 4 ? N.traits.pauseMin : Math.max(N.traits.pauseMin, N.traits.pauseRel * this.iois.slice().sort((a, b) => a - b)[this.iois.length >> 1]);
        phrase = gap >= s ? 1 : 0;
      }
      const iv = prev ? Math.max(-12, Math.min(12, m - prev.midi)) / 12 : 0;
      const sh = [Math.log(Math.min(Math.max(dur, .03), 4)), Math.log(Math.min(Math.max(gap, .01), 4)), phrase, iv];
      if (this.Ns.some(M => (M.traits.version || 1) >= 2)) sh.push(Math.max(-3, Math.min(2, (m - 60) / 12)), m < 52 ? 1 : 0); // registre et note grave : la basse d'un accompagnement
      const moy = new Float64Array(24);
      this.Ns.forEach((N, r) => {
        const o = new Float64Array(24), x = new Float64Array(N.I), base = sh.slice(0, N.I - 12);
        for (let t = 0; t < 12; t++) {
          x.fill(0); x[mod(pc - t)] = 1; for (let k = 0; k < base.length; k++) x[12 + k] = base[k];
          const h = this.h[r][t] = pasGRU(N, this.h[r][t], x);
          for (let k = 0; k < 2; k++) { let s = N.bo[k]; for (let j = 0; j < N.H; j++) s += N.Wo[k][j] * h[j]; o[t * 2 + k] = s / P.temperature; }
        }
        let tot = -Infinity; for (let i = 0; i < 24; i++) tot = lse(tot, o[i]);
        for (let i = 0; i < 24; i++) moy[i] += (o[i] - tot) / this.Ns.length;
      });
      let tot = -Infinity; for (let i = 0; i < 24; i++) tot = lse(tot, moy[i]);
      for (let i = 0; i < 24; i++) this.la[i] = moy[i] - tot;
      this.prec = { pc, midi: m, debut, w: 1 }; this.precFin = fin;
      if (dur >= .09) this._entendu(pc, dur);
      return this._decider(fin);
    }
    // Une note chantée compte pour la promesse (tests/donnees/ton-seuils.js la rejoue par ici aussi).
    _entendu(pc, dur) { this.voise += dur; this.pcs.add(pc); }

    note({ midi, debut, fin }) {
      if (this.N) return this._noteReseau(midi, debut, fin);
      const P = this.P, L = this.L, pc = mod(Math.round(midi)), dur = Math.max(0, fin - debut);
      this.recents.push(dur); if (this.recents.length > 8) this.recents.shift();
      // Fin de phrase : une vraie pause, à l'échelle du chant (même règle que le moteur).
      let phrase = false;
      if (this.prec) {
        const ioi = debut - this.prec.debut; if (ioi > 0) { this.iois.push(ioi); if (this.iois.length > 16) this.iois.shift(); }
        const s = this.iois.length < 4 ? P.pauseMin : Math.max(P.pauseMin, P.pauseRel * this.iois.slice().sort((a, b) => a - b)[this.iois.length >> 1]);
        phrase = debut - this.precFin >= s;
      }
      const g = this._chant(dur), w = P.beta * Math.pow(Math.min(dur, P.durMax), P.gamma) * (g < P.porte ? 0 : g);
      // Transition : rester, ou passer à n'importe quelle autre tonalité avec la probabilité eps.
      let tot = -Infinity; for (let i = 0; i < 24; i++) tot = lse(tot, this.la[i]);
      const rester = Math.log(1 - P.eps), partir = Math.log(P.eps / 23);
      const nv = new Float64Array(24);
      for (let i = 0; i < 24; i++) {
        const ailleurs = tot + Math.log(Math.max(1e-300, 1 - Math.exp(this.la[i] - tot)));
        nv[i] = lse(rester + this.la[i], partir + ailleurs);
        const m = i & 1, t = i >> 1, d = mod(pc - t);
        let e = this.prec && !phrase ? L.B[m][mod(this.prec.pc - t)][d] : L.U[m][d];
        if (phrase) e += P.ai * L.I[m][d] + P.af * L.F[m][mod(this.prec.pc - t)] * (this.prec.w > 0 ? 1 : 0);
        nv[i] += w * e;
      }
      this.la = nv; this._normalise();
      this.prec = { pc, debut, w }; this.precFin = fin;
      if (w > 0) this._entendu(pc, dur);
      return this._decider(fin);
    }

    _decider(t) {
      const P = this.P, b = this.meilleure(), pb = Math.exp(this.la[b]), de = i => ({ tonic: i >> 1, mode: i & 1 ? 'min' : 'maj' });
      if (!this.tete || this.tete.i !== b) this.tete = { i: b, t: this.prec ? this.prec.debut : t }; // depuis quand cette tonalité mène : début d'une modulation
      const montre = (i, etat, modulation = false) => { const k = de(i); this.aff = i; this.etat = etat; return { t, ...k, etat, p: Math.exp(this.la[i]), modulation, depuis: this.tete.i === i ? this.tete.t : t }; };
      // Sûre : probabilité haute, assez de chant entendu, et la même tonalité en tête depuis tenueSure s (au début d'un chant, le réseau s'emballe vite).
      const sure = i => i === b && pb >= P.pSure && this.voise >= P.voixSure && t - this.tete.t >= P.tenueSure;
      if (this.aff === null) {
        if (this.pcs.size >= 2 && (this.voise >= P.limite || (this.voise >= P.attenteMin && pb >= P.pMontre))) { if (sure(b)) this.aEteSure = true; return montre(b, sure(b) ? 'sure' : 'probable'); }
        return null;
      }
      const a = this.aff, pa = Math.exp(this.la[a]), fige = P.figer && this.aEteSure;
      const rel = (i, j) => (i & 1) !== (j & 1) && mod((i >> 1) - (j >> 1)) === ((j & 1) ? 3 : 9);
      if (this.etat === 'probable') {
        // Changer d'avis : une autre tonalité mène nettement, depuis tenueChange s (une tonalité qui saute gêne autant qu'une tonalité fausse).
        // Un changement après avoir été sûr est une modulation, sauf vers le relatif (même gamme : c'était une hésitation).
        if (!fige && b !== a && pb - pa >= P.dChange && t - this.tete.t >= P.tenueChange) { const mo = this.aEteSure && !rel(b, a); if (sure(b)) this.aEteSure = true; return montre(b, sure(b) ? 'sure' : 'probable', mo); }
        if (sure(a)) { this.aEteSure = true; return montre(a, 'sure'); }
        return null;
      }
      // Sûre décrit la confiance du moment, pas un verrou : si la tonalité affichée faiblit nettement plusieurs notes de suite, on repasse en probable.
      if (pa < P.pGarde) { this.bas = (this.bas || 0) + 1; if (this.bas >= P.nGarde) { this.bas = 0; this.cand = null; return montre(a, 'probable'); } } else this.bas = 0;
      // Modulation nette : une autre tonalité (pas le relatif) tient nMod notes au-dessus de pMod.
      if (!fige && b !== a && pb >= P.pMod && !rel(b, a)) { this.cand = this.cand && this.cand.i === b ? { i: b, n: this.cand.n + 1 } : { i: b, n: 1 }; if (this.cand.n >= P.nMod) { this.cand = null; return montre(b, 'sure', true); } }
      else this.cand = null;
      return null;
    }
  }

  GP.Raison = Raison;
})();
