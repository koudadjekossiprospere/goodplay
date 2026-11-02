/* Clavier SVG et doigts animés : une pastille numérotée par doigt qui joue. Composant réutilisable :
   const c = GP.Clavier(el, { basse: 36, haut: 84, mains: true, zoom: false });
   c.afficher(voicing, { tonalite, notation });  // voicing de GP.voicing : mg, md, dg, dd
   c.suite(listeDeVoicings, { dur, son, tonalite, notation, surAccord });
   c.ecouter(); c.montrerMains(bool); c.zoom(bool); c.detruire();
   Avec { scinde: bool } : une rangée par main sur téléphone, c.scinde(bool) bascule à chaud.
   Les doigts viennent toujours du voicing : rien n'est recalculé ici.
   Aucune lecture de mise en page pendant l'animation : le travail audio passe avant. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  const NS = 'http://www.w3.org/2000/svg';
  const W = 24; // largeur d'une touche blanche, en unités du dessin
  const K = 1400, C = 64, FIN_MS = 130; // ressort un peu amorti : il se pose en moins de 180 ms, même avec une image en retard
  const MIN_BLANCHES = 12, MIN_RANGEE = 11, MARGE_BLANCHES = 1; // une rangée de téléphone montre une octave et demie
  const DEC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // rang de la blanche dans l'octave ; une noire prend celui de la blanche juste en dessous
  const NOIRE = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  const DECAL_NOIRE = [0, -.12, 0, .12, 0, 0, -.14, 0, 0, 0, .14, 0]; // les noires ne sont pas centrées sur la fente
  const REPOS = [0, -2.3, -1.05, 0, 1.05, 2.08]; // doigts au repos autour du majeur, en largeurs de touche (main droite)
  const CENTRE_RANGEE = { g: 48, d: 67 };
  let compteur = 0;

  const mod = n => ((n % 12) + 12) % 12;
  const blanche = m => Math.floor(m / 12) * 7 + DEC[mod(m)];
  const xTouche = m => (blanche(m) + .5 + (NOIRE[mod(m)] ? .5 + DECAL_NOIRE[mod(m)] : 0)) * W;
  const noeud = (nom, att, parent) => { const n = document.createElementNS(NS, nom); for (const k in att) n.setAttribute(k, att[k]); if (parent) parent.appendChild(n); return n; };
  const f1 = v => Math.round(v * 10) / 10;
  const borne = (a, v, b) => Math.max(a, Math.min(b, v));

  function creer(el, o = {}) {
    const id = 'kb' + (++compteur), basse0 = o.basse ?? 36, haut0 = o.haut ?? 84, BAS = 33, HAUT = 96, seule = o.main || null;
    const reduit = () => globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let avecMains = o.mains !== false, zoomAuto = !!o.zoom || !!seule, cw = 0, ch = 0, kh = 92, rangBande = 26, policePx = 13, baseS = 1, hs = 1;
    let courant = null, opts = {}, raf = 0, derniere = 0, tCible = 0, suiteEnCours = null;
    /* Une rangée ne dessine que sa main ; le voicing garde les deux pour que l'écoute reste entière. */
    const notesG = () => (seule === 'd' || !courant ? [] : courant.mg || []);
    const notesD = () => (seule === 'g' || !courant ? [] : courant.md || []);

    /* Vecteur animé. Par main : (x, y, relevé) pour les doigts 1 à 5, puis centre x, jointures y, présence. Puis tx et s. */
    const TAILLE = 38, IX = TAILLE - 2, IS = TAILLE - 1, OFF = { g: 0, d: 18 };
    const p = new Float64Array(TAILLE), v = new Float64Array(TAILLE), c = new Float64Array(TAILLE);
    p[IS] = c[IS] = 1;

    const svg = noeud('svg', { class: 'kb', role: 'img', 'aria-label': 'Clavier' });
    const racine = noeud('g', {}, svg), gTouches = noeud('g', {}, racine), gMains = noeud('g', { class: 'mains' }, racine);
    const gEtiquettes = noeud('g', { class: 'etiquettes' }, svg), gBouts = noeud('g', { class: 'bouts' }, svg);
    const mains = {};
    for (const cote of ['g', 'd']) {
      const accolade = noeud('path', { class: 'accolade main-' + cote }, gMains), bouts = [null];
      const legende = noeud('text', { class: 'nom-main main-' + cote, 'text-anchor': 'middle' }, gBouts);
      legende.textContent = seule ? '' : cote === 'g' ? 'Main gauche' : 'Main droite';
      for (let f = 1; f <= 5; f++) { const b = noeud('g', { class: 'bout main-' + cote }, gBouts); noeud('circle', { r: 10 }, b); const t = noeud('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, b); t.textContent = f; bouts.push(b); }
      mains[cote] = { accolade, bouts, legende };
    }
    el.appendChild(svg);
    const touches = new Map();

    /* ---------- Géométrie : refaite seulement quand la taille change ---------- */
    function construire() {
      gTouches.textContent = ''; touches.clear();
      const yB = kh * .62, lB = W * .58, rr = f1((zoomAuto ? 1.5 : 2) / baseS); // rayon de 2 px à l'écran
      for (let m = BAS; m <= HAUT; m++) {
        if (NOIRE[mod(m)]) continue;
        const x = blanche(m) * W, r = noeud('path', { class: 'tb', 'data-m': m, d: `M${x + .4} 0H${x + W - .4}V${kh - rr}Q${x + W - .4} ${kh} ${x + W - .4 - rr} ${kh}H${x + .4 + rr}Q${x + .4} ${kh} ${x + .4} ${kh - rr}Z` }, gTouches);
        touches.set(m, r);
        if (mod(m) === 0) { const t = noeud('text', { class: 'oct', x: x + W / 2, y: kh - 6, 'text-anchor': 'middle', 'font-size': f1(Math.max(12, Math.min(18, W * baseS * .3)) / baseS) }, gTouches); t.textContent = nomDo(m); t.dataset.oct = m; }
      }
      for (let m = BAS; m <= HAUT; m++) {
        if (!NOIRE[mod(m)]) continue;
        const x = xTouche(m) - lB / 2, r = noeud('path', { class: 'tn', 'data-m': m, d: `M${f1(x)} 0H${f1(x + lB)}V${f1(yB - rr)}Q${f1(x + lB)} ${f1(yB)} ${f1(x + lB - rr)} ${f1(yB)}H${f1(x + rr)}Q${f1(x)} ${f1(yB)} ${f1(x)} ${f1(yB - rr)}Z` }, gTouches);
        touches.set(m, r);
      }
      noeud('rect', { class: 'feutre', x: blanche(BAS) * W, y: -1.2, width: (blanche(HAUT) + 1 - blanche(BAS)) * W, height: 2.2 }, gTouches);
    }
    const nomDo = m => ((opts.notation === 'en') ? 'C' : 'Do') + (Math.floor(m / 12) - 1);

    function dimensions(w, h) {
      if (!w || !h) return false;
      cw = w; ch = h;
      // En zoom, on dimensionne pour une fenêtre typique : deux mains écartées remplissent la zone sans la déborder.
      const blanches = seule ? MIN_RANGEE : zoomAuto ? MIN_BLANCHES + 5 : blanche(haut0) - blanche(basse0) + 1, wPx = cw / blanches;
      baseS = wPx / W;
      policePx = Math.max(13, Math.min(24, wPx * .4));
      rangBande = Math.round(policePx * 1.8);
      const utile = (ch - rangBande) / baseS;
      kh = Math.max(W * (seule ? 1.9 : 2.4), Math.min(W * 6.4, utile - 34 / baseS));
      svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
      for (const b of gBouts.querySelectorAll('.bout')) { const r = borne(11, wPx * .33, 20); b.firstChild.setAttribute('r', r); b.lastChild.setAttribute('font-size', f1(r * 1.25)); }
      for (const cote of ['g', 'd']) mains[cote].legende.setAttribute('font-size', f1(borne(12, wPx * .27, 14)));
      construire(); marquer(); cibles(true); dessiner();
      return true;
    }
    /* La fenêtre visible : tout le registre sur PC, ou resserrée autour des mains sur téléphone. */
    function fenetre() {
      const notes = [...notesG(), ...notesD()];
      let lo = basse0, hi = haut0;
      if (notes.length) {
        const a = Math.min(...notes), b = Math.max(...notes);
        if (zoomAuto) { lo = a; hi = b; } else { lo = Math.min(lo, a); hi = Math.max(hi, b); }
      } else if (seule) { lo = hi = CENTRE_RANGEE[seule]; }
      else if (zoomAuto) { lo = 48; hi = 72; }
      let bl = blanche(lo), bh = blanche(hi);
      if (zoomAuto) {
        bl -= MARGE_BLANCHES; bh += MARGE_BLANCHES;
        const manque = (seule ? MIN_RANGEE : MIN_BLANCHES) - (bh - bl + 1);
        if (manque > 0) { bl -= Math.floor(manque / 2); bh += Math.ceil(manque / 2); }
        const dessous = blanche(BAS) - bl, dessus = bh - blanche(HAUT);
        if (dessous > 0) { bl += dessous; bh += dessous; } else if (dessus > 0) { bl -= dessus; bh -= dessus; }
      }
      return { bl, bh };
    }

    /* ---------- Cibles : où chaque doigt doit aller ---------- */
    const yBout = m => kh * (NOIRE[mod(m)] ? .46 : .82);
    function cibleMain(cote, notes, ds) {
      const o = OFF[cote], sg = cote === 'd' ? 1 : -1, pos = {};
      if (!notes || !notes.length) { c[o + 17] = 0; return false; }
      notes.forEach((m, i) => { pos[ds[i]] = { x: xTouche(m), y: yBout(m) }; });
      const utilises = Object.keys(pos).map(Number).sort((a, b) => a - b);
      for (let f = 1; f <= 5; f++) {
        const io = o + (f - 1) * 3;
        if (pos[f]) { c[io] = pos[f].x; c[io + 1] = pos[f].y; c[io + 2] = 1; continue; }
        let x;
        const av = utilises.filter(u => u < f).pop(), ap = utilises.find(u => u > f);
        if (av && ap) x = pos[av].x + (pos[ap].x - pos[av].x) * (REPOS[f] - REPOS[av]) / (REPOS[ap] - REPOS[av]);
        else if (av) x = pos[av].x + sg * (REPOS[f] - REPOS[av]) * W * .92;
        else x = pos[ap].x + sg * (REPOS[f] - REPOS[ap]) * W * .92;
        c[io] = x; c[io + 1] = kh * .82; c[io + 2] = 0;
      }
      c[o + 17] = 1;
      return true;
    }
    function cibles(immediat) {
      if (seule !== 'd') cibleMain('g', notesG(), courant && courant.dg); else c[17] = 0;
      if (seule !== 'g') cibleMain('d', notesD(), courant && courant.dd); else c[35] = 0;
      const { bl, bh } = fenetre(), s = cw / ((bh - bl + 1) * W);
      c[IS] = s; c[IX] = -bl * W * s;
      if (immediat) { for (let i = 0; i < TAILLE; i++) { p[i] = c[i]; v[i] = 0; } return; }
      // Une main qui apparaît part de sa place, sans traverser le clavier.
      for (const o of [0, 18]) if (p[o + 17] < .01 && c[o + 17] > 0) { for (let i = 0; i < 17; i++) { p[o + i] = c[o + i]; v[o + i] = 0; }  }
    }

    /* ---------- Dessin d'une image : uniquement des attributs ---------- */
    function dessiner() {
      const s = p[IS], tx = p[IX], ty = rangBande;
      racine.setAttribute('transform', `translate(${f1(tx)} ${ty}) scale(${s.toFixed(4)})`);
      if (!avecMains) return;
      for (const cote of ['g', 'd']) {
        const o = OFF[cote], M = mains[cote], a = p[o + 17];
        // Seuls les doigts qui jouent existent : un doigt levé ferait croire à une note de plus.
        let x0 = Infinity, x1 = -Infinity;
        for (let f = 1; f <= 5; f++) {
          const io = o + (f - 1) * 3, joue = a >= .01 && c[io + 2] === 1, B = M.bouts[f];
          B.setAttribute('opacity', joue ? a.toFixed(2) : 0);
          if (!joue) continue;
          B.setAttribute('transform', `translate(${f1(tx + p[io] * s)} ${f1(ty + p[io + 1] * s)})`);
          x0 = Math.min(x0, p[io]); x1 = Math.max(x1, p[io]);
        }
        if (x0 === Infinity) { M.accolade.setAttribute('d', ''); M.legende.setAttribute('opacity', 0); continue; }
        const y = kh + 3 / s, b = 4 / s; // accolade sous le clavier : elle dit quelles notes vont ensemble
        M.accolade.setAttribute('d', `M${f1(x0)} ${f1(y)}v${f1(b)}H${f1(x1)}v${f1(-b)}`);
        M.legende.setAttribute('opacity', a.toFixed(2));
        M.legende.setAttribute('transform', `translate(${f1(borne(44, tx + (x0 + x1) / 2 * s, cw - 44))} ${f1(Math.min(ty + (y + b) * s + 15, ch - 3))})`);
      }
    }
    function tic(t) {
      const dt = Math.min((t - derniere) / 1000, 1 / 30); derniere = t; let bouge = false;
      if (t - tCible >= FIN_MS) { for (let i = 0; i < TAILLE; i++) { p[i] = c[i]; v[i] = 0; } dessiner(); raf = 0; return; }
      for (let i = 0; i < TAILLE; i++) {
        const seuil = i === IS ? .001 : .08;
        v[i] += (-K * (p[i] - c[i]) - C * v[i]) * dt; p[i] += v[i] * dt;
        if (Math.abs(p[i] - c[i]) > seuil || Math.abs(v[i]) > seuil * 8) bouge = true; else { p[i] = c[i]; v[i] = 0; }
      }
      dessiner();
      raf = bouge ? requestAnimationFrame(tic) : 0;
    }
    function animer() {
      if (reduit() || !cw) { for (let i = 0; i < TAILLE; i++) { p[i] = c[i]; v[i] = 0; } dessiner(); return; }
      tCible = performance.now();
      if (!raf) { derniere = tCible; raf = requestAnimationFrame(tic); }
    }

    /* ---------- Touches jouées et étiquettes ---------- */
    let enfoncees = [];
    function marquer() {
      for (const r of enfoncees) r.classList.remove('jg', 'jd');
      enfoncees = [];
      gEtiquettes.textContent = '';
      // La taille des noms de Do suit le zoom de la fenêtre : jamais sous 12 px à l'écran.
      const zo = cw ? fenetre() : null, so = zo ? cw / ((zo.bh - zo.bl + 1) * W) : baseS;
      for (const t of gTouches.querySelectorAll('.oct')) { t.textContent = nomDo(+t.dataset.oct); t.setAttribute('font-size', f1(Math.max(12, Math.min(18, W * so * .3)) / so)); }
      if (!courant) return;
      const ton = opts.tonalite || null, nota = opts.notation || 'fr', liste = [];
      for (const [cote, notes] of [['g', notesG()], ['d', notesD()]]) for (const m of notes) {
        const r = touches.get(m); if (r) { r.classList.add(cote === 'g' ? 'jg' : 'jd'); enfoncees.push(r); }
        liste.push({ m, cote, nom: GP.nomNote(m, ton, nota) });
      }
      if (!cw) return;
      // Les noms vivent dans une bande au dessus du clavier : les doigts ne les cachent jamais. Ils se poussent pour ne pas se chevaucher.
      const { bl, bh } = fenetre(), s = cw / ((bh - bl + 1) * W), tx = -bl * W * s;
      liste.sort((a, b) => a.m - b.m);
      const hp = policePx * 1.5, rx = 2;
      for (const e of liste) { e.w = Math.max(hp, e.nom.length * policePx * .62 + policePx * .9); e.x = tx + xTouche(e.m) * s - e.w / 2; }
      for (let i = 1; i < liste.length; i++) { const a = liste[i - 1], b = liste[i]; if (b.x < a.x + a.w + 2) b.x = a.x + a.w + 2; }
      if (liste.length && liste[liste.length - 1].x + liste[liste.length - 1].w > cw - 2) {
        liste[liste.length - 1].x = cw - 2 - liste[liste.length - 1].w;
        for (let i = liste.length - 2; i >= 0; i--) if (liste[i].x + liste[i].w + 2 > liste[i + 1].x) liste[i].x = liste[i + 1].x - 2 - liste[i].w;
      }
      if (liste.length && liste[0].x < 2) { liste[0].x = 2; for (let i = 1; i < liste.length; i++) if (liste[i].x < liste[i - 1].x + liste[i - 1].w + 2) liste[i].x = liste[i - 1].x + liste[i - 1].w + 2; }
      const y0 = Math.max(1, (rangBande - hp) / 2 - 1);
      for (const e of liste) {
        const g = noeud('g', { class: 'etiq main-' + e.cote, transform: `translate(${f1(e.x)} ${f1(y0)})` }, gEtiquettes);
        noeud('rect', { width: f1(e.w), height: f1(hp), rx: f1(rx) }, g);
        const t = noeud('text', { x: f1(e.w / 2), y: f1(hp / 2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': f1(policePx) }, g); t.textContent = e.nom;
      }
    }
    function etiquetteAria() {
      if (!courant) return 'Clavier, aucune touche à jouer';
      const ton = opts.tonalite || null, nota = opts.notation || 'fr';
      const dire = (ns, ds) => (ns || []).map((m, i) => GP.nomNote(m, ton, nota) + ' doigt ' + ds[i]).join(', ');
      const g = 'Main gauche : ' + dire(courant.mg, courant.dg) + '.', d = 'Main droite : ' + dire(courant.md, courant.dd) + '.';
      return seule === 'g' ? g : seule === 'd' ? d : g + ' ' + d;
    }

    /* ---------- Toucher : une touche fait entendre sa note ---------- */
    function joue(m) {
      const r = touches.get(m); if (r) { r.classList.add('tapee'); setTimeout(() => r.classList.remove('tapee'), 180); }
      if (GP.Audio) GP.Audio.jouerAccord([m], { dur: .9, volume: .5 });
    }
    let attente = null;
    svg.addEventListener('pointerdown', e => {
      const t = e.target.closest && e.target.closest('[data-m]'); if (!t) return;
      const m = +t.dataset.m;
      // iOS n'ouvre le son qu'à la fin du toucher : on attend le click si le contexte dort encore.
      if (GP.Audio && GP.Audio.ctx && GP.Audio.ctx.state === 'running') { joue(m); attente = null; } else attente = m;
    });
    svg.addEventListener('click', () => { if (attente != null) { joue(attente); attente = null; } });

    const ro = globalThis.ResizeObserver ? new ResizeObserver(es => { const r = es[es.length - 1].contentRect; if (Math.abs(r.width - cw) > .5 || Math.abs(r.height - ch) > .5) dimensions(r.width, r.height); }) : null;
    if (ro) ro.observe(el);
    if (!ro) dimensions(el.clientWidth, el.clientHeight);

    const api = {
      afficher(voicing, options = {}) {
        if (suiteEnCours && !options._suite) suiteEnCours.arreter();
        courant = voicing || null; opts = options;
        marquer(); svg.setAttribute('aria-label', etiquetteAria());
        if (!cw) return api;
        cibles(false); animer();
        return api;
      },
      /* Anime une suite de voicings. son:true la fait aussi entendre, en cadence avec les mains. */
      suite(liste, options = {}) {
        if (suiteEnCours) suiteEnCours.arreter();
        const dur = options.dur ?? 1.2, tics = []; let lecture = null, fini = false;
        const montre = i => { api.afficher(liste[i], { ...options, _suite: true }); if (options.surAccord) options.surAccord(i); };
        if (options.son && GP.Audio) lecture = GP.Audio.jouerSuite(liste.map(a => ({ mg: a.mg, md: a.md })), { dur, surAccord: montre });
        else liste.forEach((_, i) => tics.push(setTimeout(() => montre(i), i * dur * 1000)));
        const poignee = { arreter() { if (fini) return; fini = true; tics.forEach(clearTimeout); if (lecture) lecture.arreter(); if (suiteEnCours === poignee) suiteEnCours = null; }, duree: liste.length * dur };
        suiteEnCours = poignee;
        return poignee;
      },
      /* Fait entendre l'accord affiché. */
      ecouter(o2 = {}) { if (!courant || !GP.Audio) return null; return GP.Audio.jouerAccord([...(courant.mg || []), ...(courant.md || [])], { dur: o2.dur ?? 1.4 }); },
      montrerMains(b) { avecMains = !!b; gMains.style.display = avecMains ? '' : 'none'; gBouts.style.display = avecMains ? '' : 'none'; if (avecMains) dessiner(); return api; },
      zoom(b) { zoomAuto = !!b || !!seule; if (cw) dimensions(cw, ch); return api; },
      voicing: () => courant,
      detruire() { if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf); if (suiteEnCours) suiteEnCours.arreter(); svg.remove(); }
    };
    if (!avecMains) api.montrerMains(false);
    return api;
  }

  /* Façade : un clavier entier, ou une rangée par main. Même API, le code appelant ne voit pas la différence. */
  function aDeuxRangees(el, o) {
    let voies = [], voicing = null, options = {}, mains = o.mains !== false, zoomAuto = !!o.zoom, scinde = false, suiteCours = null;
    function monter(sc) {
      if (suiteCours) { suiteCours.arreter(); suiteCours = null; }
      voies.forEach(x => x.detruire()); el.textContent = ''; scinde = sc; el.classList.toggle('scinde', sc);
      if (!sc) voies = [creer(el, { ...o, mains, zoom: zoomAuto })];
      else voies = ['d', 'g'].map(c => { const r = document.createElement('div'); r.className = 'rang rang-' + c; el.append(r); return creer(r, { ...o, mains, main: c }); });
      if (voicing) voies.forEach(x => x.afficher(voicing, options));
    }
    const api = {
      afficher(v, op = {}) { voicing = v || null; options = op; voies.forEach(x => x.afficher(v, op)); return api; },
      suite(liste, op = {}) {
        // La première rangée porte le son et la cadence, la seconde la suit.
        suiteCours = voies[0].suite(liste, { ...op, surAccord: i => { voicing = liste[i]; options = op; if (voies[1]) voies[1].afficher(liste[i], { ...op, _suite: true }); if (op.surAccord) op.surAccord(i); } });
        return suiteCours;
      },
      ecouter: o2 => voies[0].ecouter(o2),
      montrerMains(b) { mains = !!b; voies.forEach(x => x.montrerMains(b)); return api; },
      zoom(b) { zoomAuto = !!b; if (!scinde) voies[0].zoom(b); return api; },
      scinde(b) { if (!!b !== scinde) monter(!!b); return api; },
      voicing: () => voicing,
      detruire() { voies.forEach(x => x.detruire()); el.textContent = ''; }
    };
    monter(!!o.scinde);
    return api;
  }

  GP.Clavier = function (el, o = {}) { return 'scinde' in o ? aDeuxRangees(el, o) : creer(el, o); };
  GP.Clavier.xTouche = xTouche;
})();
