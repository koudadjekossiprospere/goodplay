/* Reconnaissance du chant à partir de l'événement `note` du moteur. Sans DOM, sans dépendance au moteur.
   Signature : intervalles entre notes de hauteurs différentes, donc ni tonalité ni tempo. Alignement local en ligne, circulaire (un chant se reprend).
   Les scores sont des bits (log2 d'un rapport de vraisemblance) : un grand saut juste vaut plus qu'un pas de seconde. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  if (typeof require === 'function' && !GP.DEGRES) { require('./theorie.js'); require('./chants.js'); }
  const mod = n => ((n % 12) + 12) % 12;

  /* Réglés sur un tirage de mélodies et d'ornements, contrôlés sur des tirages neufs : voir tests/test-reconnaissance.js. */
  const P = {
    noteMin: .13, // sous 130 ms, c'est un ornement ou un raté du détecteur
    plancher: -2, // une note fausse coûte peu : un chantre orne, le détecteur se trompe
    fuite: .97, // le score oublie : sans cela, un saut au refrain attendrait que tout le passé s'efface
    marge: 8, // bits au-delà du hasard : le seuil vaut log2(positions de la base) + marge, il suit la taille de la base
    avance: 26, // bits d'avance sur le meilleur autre chant : c'est elle qui écarte les faux positifs, le seuil seul n'y suffit pas. À 18, un chant absent de la base a été pris pour un autre (Where He Leads Me pour Kumbaya) ; le propriétaire préfère la lenteur
    tenue: 2, // notes de suite où la décision tient
    perte: .4, // part du seuil sous laquelle le chant suivi est perdu
    chute: .55, // part du meilleur score atteint : même décision, plus tôt quand le chant allait bien
    tenuePerte: 3,
    penalites: [0, 3, 5, 7], // regrouper 2, 3 ou 4 intervalles chantés : un ornement entre deux notes du chant
    sauteNote: 4, // le chantre passe une note du chant
    fausseNote: 5, // une note fausse entre deux justes
    votes: 9, // notes retenues pour la tonalité
    hysterese: 2, // bits d'écart admis pour rester sur la suite de la position courante
    rythmeTol: .4, rythmeJuste: .5, rythmeFaux: -.5 // écart en log2 au tempo du chemin : un chantre étire, le rythme compte peu mais il départage
  };

  /* Table des scores : log2(P(chanté | référence) / P(chanté au hasard)), bornée. */
  const MAXI = 24, TAILLE = 2 * MAXI + 1, borne = v => (v > MAXI ? MAXI : v < -MAXI ? -MAXI : v) + MAXI;
  function tableScores(histo, plancher = -4) {
    const tot = histo.reduce((a, b) => a + b, 0), T = new Float32Array(TAILLE * TAILLE);
    for (let q = 0; q < TAILLE; q++) for (let s = 0; s < TAILLE; s++) {
      const d = Math.abs(q - s), v = d === 0 ? .72 : d === 1 ? .09 : d === 2 ? .012 : d === 12 ? .015 : 0;
      const fond = (histo[q] + 1) / (tot + TAILLE);
      T[q * TAILLE + s] = Math.max(plancher, Math.min(6, Math.log2((v + .02 / TAILLE) / fond)));
    }
    return T;
  }

  /* ---------- Entrées de la base ---------- */
  /* notes : [[midi, début]], cases : [{deg, q, rel, relBasse, dec, mode, t0}], rel et dec relatifs à la tonique. Le temps est celui du chant : temps musicaux ou secondes. */
  function compiler(e) {
    const groupes = [];
    e.notes.forEach(([m], i) => { const g = groupes[groupes.length - 1]; if (g && g.midi === m) g.fin = i; else groupes.push({ midi: m, debut: i, fin: i }); });
    // Un chant qui finit sur sa première note reboucle sans intervalle : on les fusionne, sinon la table circulaire aurait un intervalle nul.
    if (groupes.length > 1 && groupes[0].midi === groupes[groupes.length - 1].midi) groupes.pop();
    const n = groupes.length, s1 = new Uint8Array(n), s2 = new Uint8Array(n), iv = new Int16Array(n);
    for (let j = 0; j < n; j++) iv[j] = groupes[(j + 1) % n].midi - groupes[j].midi;
    for (let j = 0; j < n; j++) { s1[j] = borne(iv[j]); s2[j] = borne(iv[j] + iv[(j + n - 1) % n]); }
    // Durées entre attaques, en log2 : le rapport au chanté donne le tempo de la case, que chaque chemin d'alignement emporte avec lui.
    const dt = new Float32Array(n), r1 = new Float32Array(n), r2 = new Float32Array(n);
    for (let j = 0; j < n; j++) { const x = e.notes[groupes[(j + 1) % n].debut][1] - e.notes[groupes[j].debut][1]; dt[j] = x > 0 ? x : x + e.duree; r1[j] = Math.log2(dt[j]); }
    for (let j = 0; j < n; j++) r2[j] = Math.log2(dt[j] + dt[(j + n - 1) % n]);
    const col = () => Array.from({ length: 5 }, () => new Float32Array(n));
    return { e, groupes, n, s1, s2, iv, r1, r2, D: col(), tau: col(), best: 0, iBest: 0 };
  }
  /* Corpus et base de cantiques ont le même schéma, à notes/melodie près. Une entrée mal formée est écartée, pas fatale : ce fichier vient d'ailleurs. */
  const depuisCorpus = (c, i) => {
    const mel = c.notes || c.melodie, D = GP.DEGRES[c.mode];
    if (!D || !Array.isArray(mel) || !Array.isArray(c.basse) || !c.basse.length || c.basse.some(([d]) => !D[d])) return null;
    const notes = []; let t = 0;
    for (const [m, d] of mel) { if (m != null) notes.push([m, t]); t += d; }
    if (notes.length < 8) return null;
    const cases = []; let b = 0;
    for (const [deg, d] of c.basse) { const [rel, q] = D[deg]; cases.push({ deg, q, rel, relBasse: rel, dec: 0, mode: c.mode, t0: b }); b += d; }
    return { id: c.id || 'c' + i, titre: c.titre, tonique: c.tonique, mode: c.mode, bpm: c.bpm, mesure: c.mesure, notes, cases, duree: t, fiabilite: c.fiabilite };
  };
  /* Une entrée de Mes chants : seule la signature sert ici, le reste appartient à Labs. */
  const depuisMesChants = ch => (ch.signature && ch.signature.notes.length > 8 ? { id: ch.id, titre: ch.titre, tonique: ch.ton.tonic, mode: ch.ton.mode, bpm: ch.bpm, mesure: ch.mesure, remplace: ch.remplace || null, appris: true, ...ch.signature } : null);

  /* La grille d'une entrée dans une tonalité : les cases portent les vraies hauteurs, comme celles du moteur. Transpose reste à l'affichage. */
  function grilleChant(e, tonique) {
    return e.cases.map((c, k) => {
      const ton = { tonic: mod(tonique + c.dec), mode: c.mode }, racine = mod(ton.tonic + c.rel);
      return { k, deg: c.deg, racine, q: c.q, basse: mod(ton.tonic + c.relBasse), t0: c.t0, t: (e.cases[k + 1] ? e.cases[k + 1].t0 : e.duree) - c.t0, ton, conf: 1, alternatives: [], reconnu: true, corrige: !!c.corrige };
    });
  }
  const caseA = (e, t) => { let k = 0; while (k + 1 < e.cases.length && e.cases[k + 1].t0 <= t) k++; return k; };

  /* Ce qui part dans Mes chants : la mélodie chantée et ses cases, en temps musicaux. `notes` et `cases` sont ceux du Live, en secondes. */
  function signatureLive(notes, cases, ton, bpm) {
    const ns = notes.filter(n => n.fin - n.debut >= P.noteMin).slice(0, 240); if (!ns.length || !cases.length) return null;
    const t0 = ns[0].debut, tps = s => +((s - t0) * bpm / 60).toFixed(2), duree = tps(ns[ns.length - 1].fin);
    const cs = cases.filter(c => tps(c.t) < duree).map(c => ({ deg: c.deg, q: c.q, rel: mod(c.racine - c.ton.tonic), relBasse: mod((c.basse ?? c.racine) - c.ton.tonic), dec: mod(c.ton.tonic - ton.tonic), mode: c.ton.mode, t0: Math.max(0, tps(c.t)), ...(c.corrige ? { corrige: true } : {}) }));
    if (!cs.length) return null;
    cs[0].t0 = 0;
    return { notes: ns.map(n => [n.midi, tps(n.debut)]), cases: cs, duree };
  }

  const titreNormal = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const cinqGrammes = c => { const g = new Set(); for (let j = 0; j + 4 < c.n; j++) g.add(c.iv.slice(j, j + 5).join()); return g; };

  /* ---------- Reconnaissance ---------- */
  class Reconnaissance {
    constructor({ chants = GP.chants, params = {} } = {}) {
      this.P = { ...P, ...params }; this.ecouteurs = {}; this.base = []; this.index = new Map(); this.doublons = [];
      this.ajouterBase(chants);
      this.reinit();
    }
    /* Ajoute des chants sans doublon : un même air sous deux titres n'aurait jamais d'avance sur lui-même, il ne serait donc jamais reconnu. Le premier arrivé reste. */
    ajouterBase(liste) {
      liste.forEach((c, i) => {
        const e = c.cases ? c : depuisCorpus(c, i); if (!e) return;
        const x = compiler(e), g = cinqGrammes(x), nt = titreNormal(e.titre), vus = new Map();
        for (const k of g) for (const b of this.index.get(k) || []) vus.set(b, (vus.get(b) || 0) + 1);
        // Un même titre peut cacher deux airs : il ne suffit pas, il abaisse seulement l'exigence sur la mélodie.
        for (const [b, nb] of vus) if (nb / Math.min(g.size, b.g.size) > (titreNormal(b.e.titre) === nt ? .25 : .6)) { this.doublons.push({ titre: e.titre, de: b.e.titre }); return; }
        x.g = g; this.base.push(x);
        for (const k of g) { if (!this.index.has(k)) this.index.set(k, []); this.index.get(k).push(x); }
      });
      const h = new Array(TAILLE).fill(0);
      for (const c of this.base) for (const v of c.iv) h[borne(v)]++;
      this.T = tableScores(h, this.P.plancher);
      this._recompte();
    }
    on(nom, fn) { (this.ecouteurs[nom] = this.ecouteurs[nom] || []).push(fn); return this; }
    _emet(nom, d) { for (const f of this.ecouteurs[nom] || []) f(d); }
    _recompte() {
      const caches = new Set(this.base.map(c => c.e.remplace).filter(Boolean));
      this.actifs = this.base.filter(c => !caches.has(c.e.id));
      this.seuil = Math.log2(Math.max(2, this.actifs.reduce((a, c) => a + c.n, 0))) + this.P.marge;
    }
    /* Remplace les chants appris, sans repasser par les doublons : le musicien a choisi de les garder. */
    definirAppris(liste) {
      const nv = liste.map(depuisMesChants).filter(Boolean), cle = nv.map(e => e.id).join();
      if (cle === this.cleAppris) return;
      this.cleAppris = cle;
      const garder = this.base.filter(c => c.e.appris);
      this.base = this.base.filter(c => !c.e.appris).concat(nv.map(e => { const av = garder.find(c => c.e.id === e.id); return av || compiler(e); }));
      this._recompte();
      if (!this.cur || this.actifs.includes(this.cur)) return;
      // Le musicien vient d'enregistrer sa version du chant suivi : même air, le suivi continue sans repartir de zéro.
      const c = this.cur, nouv = this.actifs.find(x => x.e.remplace === c.e.id || (c.e.remplace && x.e.remplace === c.e.remplace));
      if (!nouv || nouv.n !== c.n) { this._perdre('base'); return; }
      const dec = nouv.groupes[0].midi - c.groupes[0].midi;
      Object.assign(nouv, { D: c.D, tau: c.tau, best: c.best, iBest: c.iBest });
      this.cur = nouv; this.votes = this.votes.map(v => mod(v - dec));
    }
    reinit() {
      for (const c of this.base) { for (const d of c.D) d.fill(0); for (const d of c.tau) d.fill(0); c.best = 0; c.iBest = 0; }
      this.h = []; this.at = []; this.cur = null; this.pos = -1; this.tenueOk = 0; this.candidat = null; this.bas = 0; this.votes = []; this.exclus = new Set(); this.tonique = null;
    }
    /* Le chant se termine pour de bon : la position n'a plus de sens. */
    nouveauChant() { const c = this.cur; if (c) this._perdre('nouveau'); this.reinit(); }
    /* « Ce n'est pas ce chant » : il ne reviendra pas avant le prochain chant. */
    rejeter() { if (!this.cur) return; this.exclus.add(this.cur.e.id); this._perdre('musicien'); }

    note(n) {
      if (n.fin - n.debut < this.P.noteMin) return;
      const h = this.h;
      if (h.length && h[h.length - 1] === n.midi) { this._repetee(n); return; } // les répétitions dépendent trop du détecteur pour servir de signature
      h.push(n.midi); this.at.push(n.debut); if (h.length > 5) { h.shift(); this.at.shift(); }
      if (h.length < 2) return;
      const L = h.length, at = this.at, qs = [0, 0, 0, 0], lq = [0, 0, 0, 0];
      for (let k = 1; k <= 4 && k < L; k++) { qs[k - 1] = borne(h[L - 1] - h[L - 1 - k]) * TAILLE; lq[k - 1] = Math.log2(Math.max(.01, at[L - 1] - at[L - 1 - k])); }
      const nb = Math.min(4, L - 1);
      for (const c of this.actifs) this._maj(c, qs, lq, nb);
      this._decider(n);
    }
    _maj(c, qs, lq, nb) {
      const { n, s1, s2, r1, r2 } = c, T = this.T, Pa = this.P, f = Pa.fuite, pen = Pa.penalites, sn = Pa.sauteNote, fn = Pa.fausseNote, rb = Pa.rythmeJuste, rm = Pa.rythmeFaux, tol = Pa.rythmeTol;
      const D = c.D, D0 = D.pop(); D.unshift(D0);
      const U = c.tau, U0 = U.pop(); U.unshift(U0);
      const D1 = D[1], D2 = D[2], D3 = D[3], D4 = D[4], U1 = U[1], U2 = U[2], U3 = U[3], U4 = U[4], q1 = qs[0], q2 = qs[1], q3 = qs[2], q4 = qs[3], l1 = lq[0], l2 = lq[1], l3 = lq[2], l4 = lq[3];
      let best = 0, iBest = 0;
      for (let j = 0; j < n; j++) {
        const a = j ? j - 1 : n - 1, b = a ? a - 1 : n - 1, s = s1[j], ss = s2[j];
        // Le chemin retenu donne le tempo à comparer. Une case à zéro n'a pas de passé : on l'évite, c'est ce qui rend 500 chants abordables.
        let p = D1[a], t = U1[a], rho = l1 - r1[j], v = f * p + T[q1 + s], x, w;
        x = D1[b]; if (x > 0) { w = f * x + T[q1 + ss] - sn; if (w > v) { v = w; p = x; t = U1[b]; rho = l1 - r2[j]; } }
        if (nb > 1) {
          x = D2[a]; if (x > 0) { w = f * x + T[q2 + s] - pen[1]; if (w > v) { v = w; p = x; t = U2[a]; rho = l2 - r1[j]; } }
          x = D2[b]; if (x > 0) { w = f * x + T[q2 + ss] - fn; if (w > v) { v = w; p = x; t = U2[b]; rho = l2 - r2[j]; } }
          if (nb > 2) {
            x = D3[a]; if (x > 0) { w = f * x + T[q3 + s] - pen[2]; if (w > v) { v = w; p = x; t = U3[a]; rho = l3 - r1[j]; } }
            if (nb > 3) { x = D4[a]; if (x > 0) { w = f * x + T[q4 + s] - pen[3]; if (w > v) { v = w; p = x; t = U4[a]; rho = l4 - r1[j]; } } }
          }
        }
        if (p > 0) {
          const d = rho - t;
          v += d < tol && d > -tol ? rb : rm;
          U0[j] = t + .3 * d;
        } else U0[j] = rho;
        if (v < 0) v = 0;
        D0[j] = v;
        if (v > best) { best = v; iBest = j; }
      }
      c.best = best; c.iBest = iBest;
    }
    _decider(n) {
      let c1 = null, c2 = null;
      for (const c of this.actifs) {
        if (this.exclus.has(c.e.id)) continue;
        if (!c1 || c.best > c1.best) { c2 = c1; c1 = c; } else if (!c2 || c.best > c2.best) c2 = c;
      }
      if (!c1) return;
      const S1 = c1.best, S2 = c2 ? c2.best : 0, ok = S1 >= this.seuil && S1 - S2 >= this.P.avance;
      if (ok && this.candidat === c1) this.tenueOk++; else { this.candidat = ok ? c1 : null; this.tenueOk = ok ? 1 : 0; }
      if (this.cur) {
        const c = this.cur;
        if (c.best > this.pic) this.pic = c.best;
        // La pente trahit un autre chant bien avant que le score tombe sous le seuil.
        if (c.best < Math.max(this.seuil * this.P.perte, this.pic * this.P.chute)) this.bas++; else this.bas = 0;
        if (c1 !== c && this.candidat === c1 && this.tenueOk >= this.P.tenue) this._perdre('autre');
        else if (this.bas >= this.P.tenuePerte) this._perdre('ecart');
        else { this._suivre(c, n); return; }
      }
      // La dernière note doit être juste : c'est elle qui donne la tonalité.
      if (this.candidat === c1 && this.tenueOk >= this.P.tenue && this._juste(c1)) this._reconnaitre(c1, n, S1, S2);
    }
    _juste(c, j = c.iBest) { const L = this.h.length; return this.h[L - 1] - this.h[L - 2] === c.iv[j]; }
    _decalage(c, j, n) { return mod(n.midi - c.groupes[(j + 1) % c.n].midi); }
    /* Tonalité : le décalage le plus voté. Départ sur les dernières notes entendues, car un ornement peut tomber juste par hasard sur la dernière seule. */
    _majTonique(c, stricte) {
      const compte = new Map(); let top = this.votes[0], nb = 0;
      for (const v of this.votes) { const x = (compte.get(v) || 0) + 1; compte.set(v, x); if (x > nb) { nb = x; top = v; } }
      if (!stricte || nb * 2 > this.votes.length) this.tonique = mod(c.e.tonique + top);
    }
    _reconnaitre(c, n, S1, S2) {
      const h = this.h, L = h.length, j = c.iBest;
      this.cur = c; this.bas = 0; this.pic = c.best; this.j = j; this.votes = [];
      for (let k = 0; k < L; k++) this.votes.push(mod(h[L - 1 - k] - c.groupes[(((j + 1 - k) % c.n) + c.n) % c.n].midi));
      this._majTonique(c, false);
      this._placer(c, j);
      const m = this._etat(), N = this.seuil - this.P.marge;
      this._emet('chantReconnu', { id: c.e.id, titre: c.e.titre, entree: c.e, tonique: this.tonique, mode: c.e.mode, position: m.position, iCase: m.iCase, iNote: this.pos, confiance: 1 - Math.pow(2, -Math.min(S1 - N, S1 - S2)), t: n.fin });
    }
    _perdre(raison) { const c = this.cur; this.cur = null; this.pos = -1; this.votes = []; this.tonique = null; this.bas = 0; if (raison !== 'autre') { this.candidat = null; this.tenueOk = 0; } this._emet('chantPerdu', { id: c.e.id, titre: c.e.titre, raison }); }
    _suivre(c, n) {
      // Une phrase qui revient donne deux positions presque égales : on reste sur la suite tant que rien ne la contredit.
      let j = c.iBest; const av = this.j, D0 = c.D[0];
      for (const pas of [1, 2]) { const x = (av + pas) % c.n; if (D0[x] >= c.best - this.P.hysterese) { j = x; break; } }
      this.j = j;
      if (this._juste(c, j)) {
        this.votes.push(this._decalage(c, j, n)); if (this.votes.length > this.P.votes) this.votes.shift();
        this._majTonique(c, true);
      }
      this._placer(c, j); this._emetPosition();
    }
    /* Position : la note d'après celle qu'on vient d'entendre. L'événement `note` arrive quand la suivante attaque, c'est donc la note en cours. */
    _placer(c, j) { const g = c.groupes[(j + 1) % c.n]; this.limite = c.groupes[(j + 2) % c.n].debut; this.pos = Math.min(g.debut + 1, g.fin + 1); if (this.pos >= c.e.notes.length) this.pos = 0; }
    _repetee() {
      if (!this.cur || this.pos === this.limite) return;
      this.pos = this.pos + 1 >= this.cur.e.notes.length ? 0 : this.pos + 1;
      this._emetPosition();
    }
    _etat() { const e = this.cur.e, position = e.notes[this.pos][1]; return { position, iCase: caseA(e, position) }; }
    _emetPosition() { const m = this._etat(); this._emet('position', { id: this.cur.e.id, position: m.position, iCase: m.iCase, iNote: this.pos, tonique: this.tonique, mode: this.cur.e.mode }); }
    /* Pour les bancs : les deux meilleurs candidats du moment. */
    get meilleurs() { return [...this.actifs].sort((a, b) => b.best - a.best).slice(0, 2).map(c => ({ id: c.e.id, titre: c.e.titre, score: c.best })); }
  }

  Object.assign(GP, { Reconnaissance, grilleChant, signatureLive, depuisCorpus, depuisMesChants });
})();
