/* Interface Live de goodplay. Le moteur tourne sans DOM : ici on ne fait qu'afficher ses événements.
   Transposition : tout ce que le pianiste lit passe par GP.vue et GP.nomAccord. Le moteur garde les vraies hauteurs. */
(function () {
  'use strict';
  const GP = globalThis.GP, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const CLE = 'goodplay_reglages', ANCIENNE = 'souffleur_settings';
  const STYLES = [['gospel', 'Gospel'], ['louange', 'Louange'], ['pop', 'Pop'], ['soul', 'Soul'], ['jazz', 'Jazz']];
  const MOTS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'];
  const SEUIL_CONF = .4, SILENCE_AIDE = 6, PX_SEC_MIN = 46, SECONDES_LIGNE = 9;

  /* ---------- Réglages, avec reprise de l'ancienne clé ---------- */
  function charger() {
    const D = { sortie: 'both', annonce: 'both', niveauMg: 0, notation: 'fr', paroles: false, volDemo: .35, jeu: null, suitTon: false, silence: 15, theme: 'auto', tonManuelle: null, profondeur: 'squelette', style: 'gospel', mains: true, basseReelle: false, voixTel: false, arbre: true, kbH: null };
    try {
      const n = JSON.parse(localStorage.getItem(CLE)); if (n) { delete n.modulationAuto; return { ...D, ...n }; } // remplacé par suitTon, coupé par défaut
      const a = JSON.parse(localStorage.getItem(ANCIENNE)); if (!a) return D;
      const k = typeof a.keyMode === 'string' && a.keyMode !== 'auto' ? a.keyMode.split('-') : null;
      const r = { ...D, sortie: a.output ?? D.sortie, annonce: a.announce ?? D.annonce, niveauMg: a.level ?? 0, notation: a.notation ?? 'fr', paroles: !!a.lyrics, volDemo: a.demoVol ?? D.volDemo, jeu: a.playKey === 'easy' ? 0 : null, silence: a.newGap ?? 15, theme: a.theme ?? 'auto', tonManuelle: k ? { tonic: +k[0], mode: k[1] } : null };
      localStorage.setItem(CLE, JSON.stringify(r)); localStorage.removeItem(ANCIENNE);
      return r;
    } catch (e) { return D; }
  }
  const S = charger();
  const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(S)); } catch (e) { /* stockage bloqué : les réglages restent pour la session */ } };

  /* ---------- Moteur ---------- */
  const m = new GP.Moteur({ reglages: { basseReelle: S.basseReelle, modulationAuto: S.suitTon, tempsNouveauChant: S.silence, tonalite: S.tonManuelle } });
  const pc = matchMedia('(min-width:1024px) and (min-height:521px)');
  const rangees = matchMedia('(max-width:700px) and (orientation:portrait)');
  const A = GP.Audio;
  const Rec = new GP.Reconnaissance();
  /* Le chant reconnu en cours ; recoDe garde aussi ceux des chants passés, leur grille reste affichée. */
  let rc = null, recoMs = 0;
  const recoDe = new Map(), recoEls = new Map(), titres = new Map();

  /* État de l'affichage */
  let enCours = false, indiceCourant = -1, tonEtat = null, hypothese = null, prochain = null, jaugeAnim = null, jaugeMax = 0;
  let dejaVus = [], suggDue = false, idees = [], precV = null, apercuT = null, apercuActif = false, dernierNiveau = null, dernierSignal = 0, debutEcoute = 0;
  let noteEnCours = null, suivre = true, rafBoucle = 0, verrouEcran = null, reco = null, demoLancee = false;
  const latences = [];
  const notes = [], coupures = [], provisoires = new WeakSet();

  const clavier = GP.Clavier($('#clavier'), { basse: 36, haut: 84, mains: S.mains, zoom: !pc.matches, scinde: rangees.matches });
  rangees.addEventListener('change', () => clavier.scinde(rangees.matches));
  let clavierCase = null;

  /* ---------- Noms, toujours dans la tonalité jouée ---------- */
  const tonChant = () => (rc ? rc.cases[rc.k].ton : m.key) || null;
  const vueDe = k => GP.vue(k, S.jeu);
  const nomT = k => GP.nomTonalite(k, S.notation);
  const nomA = (r, q, k) => GP.nomAccord(r, q, k, S.jeu, S.notation);
  const nomN = (hauteur, k) => { const v = vueDe(k); return GP.nomNote(hauteur - v.sh, v.pk, S.notation); };
  const memeTon = (a, b) => a && b && a.tonic === b.tonic && a.mode === b.mode;
  const valTp = k => { const s = vueDe(k).sh; return (s > 0 ? '+' : '') + s; };
  const nomCourt = k => GP.nomNote(k.tonic, k, S.notation) + (k.mode === 'min' ? 'm' : '');
  const heure = () => (A.ctx ? A.ctx.currentTime : performance.now() / 1000);
  /* Tant que la tonalité hésite, le chiffre peut changer de sens mais presque tous les noms restent : le nom passe devant. */
  const tonSure = () => !!rc || !!m.reglages.tonalite || tonEtat === 'sure' || m.etat === 'sure';
  let hesite = false;
  function majHesite() {
    const h = !!tonChant() && !tonSure();
    if (h === hesite) return;
    hesite = h; document.body.toggleAttribute('data-hesite', h);
    for (const [n, el] of chantEls) el.toggleAttribute('data-hesite', h && n === m.nChant);
    melodieSale(true); arbreSale();
  }

  /* Version enrichie : la première couleur du catalogue pour ce degré et ce style. Rien n'est inventé ici. */
  function couleur(c) {
    if (S.profondeur !== 'enrichi' || !GP.catalogue) return null;
    const l = GP.catalogue.filter(e => e.live && e.mode === c.ton.mode && e.quand.sur === c.deg && e.style.includes(S.style) && e.accords.length === 1 && GP.mod(c.ton.tonic + e.accords[0].rac) === c.racine);
    return l.sort((a, b) => a.niveau - b.niveau)[0] || null;
  }
  const qAffichee = c => { const e = couleur(c); return e ? e.accords[0].q : c.q; };
  /* Le voicing lu sur le clavier : dans la tonalité jouée, donc transposé. */
  function voicingDe(c, prec) {
    const v = vueDe(c.ton), e = couleur(c);
    if (e) return GP.jouerEntree(e, v.pk)[0];
    return GP.voicing(GP.mod(c.racine - v.sh), c.q, { prec, niveau: S.niveauMg, basse: GP.mod(c.basse - v.sh) });
  }
  const optsClavier = k => ({ tonalite: vueDe(k).pk, notation: S.notation });

  /* ---------- Maintenant ---------- */
  const celluleCourante = () => (rc ? rc.cases[rc.k] : m.grille[indiceCourant]) || null;
  function peindreMaintenant() {
    const c = celluleCourante(), deg = $('#nowDeg'), nom = $('#nowNom'), bas = $('#nowBasse'), sous = $('#nowSous'), btn = $('#nowBtn');
    const voixSeule = S.sortie === 'voice';
    document.body.toggleAttribute('data-voix-seule', voixSeule);
    btn.disabled = !c; for (const b of $$('.act-accord')) b.disabled = !c;
    btn.classList.toggle('attend', !c);
    const choix = choixDe(c), bc = $('#nowChoix'); bc.hidden = !choix; btn.hidden = !!choix;
    if (choix) {
      // Le plus probable d'abord : c'est aussi lui que le clavier montre tant que rien n'est tranché.
      bc.innerHTML = choix.map((a, i) => { const nomC = nomA(a.racine, a.q, c.ton); return (i ? '<span class="ch-ou">ou</span>' : '') + `<button class="ch-acc" data-deg="${a.deg}" aria-label="Jouer le ${a.deg}, ${echappe(nomC)}"><b>${a.deg}</b><span>${echappe(nomC)}</span><kbd class="pc-seul">${i + 1}</kbd></button>`; }).join('');
      bas.textContent = ''; sous.textContent = 'La mélodie laisse le choix : touche le bon accord, je le retiens.';
      $('#pasCa').hidden = true;
      return;
    }
    $('#nowProp').hidden = !c || !enCours || !!c.corrige || !!c.deMemoire || !!c.reconnu;
    if (!c) {
      const k = tonChant();
      deg.textContent = ''; deg.classList.add('attente');
      const t = enCours ? 'J\'écoute' : 'Prêt';
      nom.textContent = t; btn.style.setProperty('--n', t.length);
      bas.innerHTML = k ? echappe(nomT(k)) : hypothese ? 'Peut-être <b>' + echappe(nomT(hypothese)) + '</b>' : enCours ? 'Je cherche la tonalité' : 'La tonalité viendra toute seule';
      sous.textContent = enCours ? 'Chante une phrase, quelques secondes suffisent.' : 'Pose le téléphone près du chantre, loin du piano.';
      $('#pasCa').hidden = true;
      return;
    }
    const k = c.ton, q = qAffichee(c), texte = nomA(c.racine, q, k);
    deg.classList.remove('attente');
    deg.textContent = c.deg;
    nom.textContent = texte; btn.style.setProperty('--n', Math.max(3, texte.length));
    bas.innerHTML = '<small>Basse</small> ' + echappe(nomN(c.basse, k));
    sous.textContent = GP.notesAccord(GP.mod(c.racine - vueDe(k).sh), q).slice(0, 4).map(p => GP.nomNote(p, vueDe(k).pk, S.notation)).join(' ') + (incertain(c) ? ', à confirmer' : '');
    peindrePasCa(c);
  }
  /* Principe 5 : l'ambigu s'affiche comme un choix que le musicien tranche, pas comme une affirmation. Un chant reconnu et une case validée sont certains. */
  function choixDe(c) {
    if (!c || c.reconnu || c.corrige || c.deMemoire || !(c.ambigu || c.conf < SEUIL_CONF)) return null;
    const alts = (c.alternatives || []).filter(a => a.deg !== c.deg); if (!alts.length) return null;
    const a2 = alts[1], trois = c.ambigu && a2 && a2.p != null && a2.p >= alts[0].p / 2;
    return [{ deg: c.deg, racine: c.racine, q: qAffichee(c) }, ...alts.slice(0, trois ? 2 : 1)];
  }
  $('#nowChoix').addEventListener('click', e => { const x = e.target.closest('[data-deg]'); if (x) corriger(indiceCourant, +x.dataset.deg); });

  /* La tonalité aussi, tant que le moteur en garde plusieurs. Le choix tient jusqu'au prochain chant : ce n'est pas le réglage « Je la choisis », qui vaut pour tous. */
  let tonHyp = null, tonTranche = false, tonEcoute = false;
  function hypothesesTon() {
    const l = tonHyp || m.tonaliteHypotheses;
    return Array.isArray(l) && l.length > 1 && !rc && !m.reglages.tonalite && tonEtat !== 'sure' ? l.slice(0, 3) : null;
  }
  function peindreChoixTon() {
    const b = $('#tonChoix'), l = hypothesesTon(); b.hidden = !l; if (!l) return;
    b.innerHTML = '<span>Tonalité</span>' + l.map((k, i) => (i ? '<span>ou</span>' : '') + `<button class="alt-petit" data-t="${k.tonic}" data-m="${k.mode}">${echappe(nomT(k))}</button>`).join('');
  }
  $('#tonChoix').addEventListener('click', e => {
    const x = e.target.closest('[data-t]'); if (!x) return;
    tonHyp = null; tonTranche = true; m.fixerTonalite({ tonic: +x.dataset.t, mode: x.dataset.m }, m.tNow);
    peindreBarre(); peindreMaintenant(); peindreEnsuite(); peindreClavier();
  });
  m.on('tonaliteHypotheses', h => { tonHyp = Array.isArray(h) ? h : h && h.hypotheses; peindreChoixTon(); });

  function peindrePasCa(c) {
    const b = $('#pasCa'); b.textContent = '';
    if (!c.alternatives || !c.alternatives.length || c.corrige) { b.hidden = true; return; }
    const lib = document.createElement('span'); lib.textContent = 'Pas ça ?'; b.append(lib);
    for (const a of c.alternatives.slice(0, 2)) {
      const x = document.createElement('button'); x.className = 'alt-petit'; x.dataset.deg = a.deg;
      x.innerHTML = '<b>' + a.deg + '</b> ' + echappe(nomA(a.racine, a.q, c.ton)) + '<kbd class="pc-seul">' + b.children.length + '</kbd>'; x.setAttribute('aria-label', 'Corriger en ' + a.deg);
      b.append(x);
    }
    b.hidden = false;
  }
  $('#pasCa').addEventListener('click', e => { const x = e.target.closest('[data-deg]'); if (x) corriger(indiceCourant, +x.dataset.deg); });

  /* ---------- Ensuite ---------- */
  function peindreEnsuite() {
    const e = $('#ensuite'), p = prochain, c = celluleCourante();
    // Une prédiction arrivée à terme, ou faite dans une autre tonalité, ne dit plus rien de la suite. Le nom se recalcule : une modulation a pu passer.
    const a = p && c && p.deg !== c.deg ? GP.accordDeDegre(c.ton, p.deg) : null;
    if (!a) {
      // Le bloc reste en place : le Maintenant ne bouge jamais.
      e.classList.add('vide-en'); $('#nextBadge').hidden = true; $('#nextJauge').hidden = true;
      $('#nextAttente').textContent = enCours ? 'J\'écoute la suite' : 'Viendra pendant l\'écoute';
      if (jaugeAnim) { jaugeAnim.cancel(); jaugeAnim = null; }
      return;
    }
    e.classList.remove('vide-en');
    $('#nextDeg').textContent = p.deg;
    const nom = nomA(a.racine, a.q, c.ton), n = $('#nextNom'); n.textContent = nom; $('#nextCorps').style.setProperty('--n', Math.max(3, nom.length));
    const b = $('#nextBadge'); b.hidden = false; b.innerHTML = p.duChant ? 'du chant' : p.appris ? '<svg class="ic"><use href="#i-boucle"/></svg>appris' : 'probable'; b.classList.toggle('appris', p.appris);
    const j = $('#nextJauge');
    if (jaugeAnim) { jaugeAnim.cancel(); jaugeAnim = null; }
    if (p.dans == null || !(p.dans > 0)) { j.hidden = true; return; }
    j.hidden = false; jaugeMax = Math.max(p.dans, jaugeMax);
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches, fr = p.dans / jaugeMax;
    jaugeAnim = reduit ? null : $('#nextJaugeI').animate([{ transform: `scaleX(${fr})` }, { transform: 'scaleX(0)' }], { duration: p.dans * 1000, fill: 'forwards', easing: 'linear' });
  }

  /* ---------- Barre : tonalité et Transpose ---------- */
  function etatTon() {
    const k = tonChant();
    if (rc) return { ic: 'i-sure', etat: ', chantée', nom: nomT(k), cle: 'sure', long: nomT(k) + ', la tonalité chantée de ' + rc.titre + '.' };
    if (tonEcoute && k) return { ic: 'i-ecoute', etat: ", j'écoute la nouvelle", nom: nomT(k), cle: 'probable', long: nomT(k) + " jusqu'ici. J'écoute la nouvelle tonalité." };
    if (k) {
      if (m.reglages.tonalite) return { ic: 'i-cadenas', etat: ', choisie', nom: nomT(k), cle: 'choisie', long: nomT(k) + ', choisie par toi.' };
      const sure = tonEtat === 'sure' || m.etat === 'sure';
      return sure ? { ic: 'i-sure', etat: ', sûre', nom: nomT(k), cle: 'sure', long: nomT(k) + ', tonalité sûre.' + (S.suitTon ? '' : ' Elle ne change plus que si tu touches Changement de tonalité.') } : { ic: 'i-probable', etat: ', probable', nom: nomT(k), cle: 'probable', long: nomT(k) + ', tonalité probable. Je peux encore corriger.' };
    }
    if (hypothese) return { ic: 'i-hypothese', etat: '', nom: 'Peut-être ' + nomT(hypothese), cle: 'hypothese', long: 'Peut-être ' + nomT(hypothese) + '. Ce n\'est encore qu\'une hypothèse.' };
    return { ic: 'i-ecoute', etat: '', nom: enCours ? 'J\'écoute' : 'Pas encore écouté', cle: 'vide', long: enCours ? 'J\'écoute le chant.' : 'Pas encore de tonalité. Lance l\'écoute, ou choisis-la toi-même.' };
  }
  function peindreBarre() {
    const e = etatTon(), k = tonChant() || hypothese;
    A.decalage = k && document.body.dataset.onglet !== 'labs' ? vueDe(k).sh : 0;
    for (const x of [$('#tonIc'), $('#barreIc')]) x.firstElementChild.setAttribute('href', '#' + e.ic);
    $('#tonEtat').textContent = e.etat; $('#tonNom').textContent = e.nom; $('#barreTonNom').textContent = e.nom + (e.cle === 'probable' ? e.etat : ''); // jamais un fait tant qu'elle est probable
    $('#tonBtn').dataset.etat = e.cle; $('#barreTon').dataset.etat = e.cle;
    const v = k ? vueDe(k) : null;
    const nomJeu = S.jeu == null ? 'Comme le chant' : k ? nomT(v.pk) : GP.nomNote(S.jeu, { tonic: S.jeu, mode: 'maj' }, S.notation);
    $('#jeuNom').textContent = nomJeu;
    const tp = $('#tpVal'), montreTp = S.jeu != null && k;
    tp.textContent = montreTp ? valTp(k) : ''; tp.hidden = !montreTp; tp.setAttribute('aria-label', montreTp ? GP.texteTranspose(k, S.jeu) : '');
    $('#barreJeuNom').textContent = nomJeu + (montreTp ? ', ' + valTp(k) : '');
    peindreEspace(); peindreChoixTon();
    const bande = $('#tpBande'); bande.hidden = S.jeu == null;
    bande.innerHTML = S.jeu == null ? '' : k ? 'Chant ' + echappe(nomCourt(k)) + ', tu joues en ' + echappe(nomCourt(v.pk)) + ', <b>' + echappe(valTp(k)) + '</b>' : 'Tu joues en ' + echappe(nomJeu) + ', le réglage arrive';
    bande.setAttribute('aria-label', k && S.jeu != null ? 'Chant ' + nomT(k) + ', tu joues en ' + nomT(v.pk) + ', ' + GP.texteTranspose(k, S.jeu) + '. Modifier.' : 'Tonalité et Transpose');
    majHesite();
    $('#popEtat').textContent = e.long;
    $('#popJeu').textContent = S.jeu == null ? 'Tu joues dans la tonalité du chant.' : k ? 'Chant : ' + nomT(k) + '. Tu joues en ' + nomT(v.pk) + ', ' + GP.texteTranspose(k, S.jeu) + '.' : 'Tu joues en ' + nomJeu + '. J\'indiquerai le réglage de Transpose dès que je connais le chant.';
    peindrePopTon();
  }
  function peindrePopTon() {
    const manuel = !!S.tonManuelle, k = tonChant() || hypothese;
    presser($('#tonMode'), manuel ? 'manuel' : 'auto'); $('#tonManuel').hidden = !manuel;
    if (manuel) {
      presser($('#tonQualite'), S.tonManuelle.mode);
      $('#tonNotes').innerHTML = Array.from({ length: 12 }, (_, t) => `<button data-v="${t}" aria-pressed="${t === S.tonManuelle.tonic}">${GP.nomNote(t, { tonic: t, mode: S.tonManuelle.mode }, S.notation)}</button>`).join('');
    }
    // Les 12 choix affichent ce que tu joueras vraiment : en chant mineur, la relative mineure du choix.
    $('#jeuNotes').innerHTML = Array.from({ length: 12 }, (_, j) => {
      const pk = GP.vue({ tonic: 0, mode: k ? k.mode : 'maj' }, j).pk;
      return `<button data-v="${j}" aria-pressed="${S.jeu === j}">${GP.nomNote(pk.tonic, pk, S.notation)}${pk.mode === 'min' ? 'm' : ''}</button>`;
    }).join('');
    $('#popComme').setAttribute('aria-pressed', S.jeu == null);
  }
  function changerJeu(j) {
    S.jeu = j == null ? null : GP.mod(j); sauver(); precV = null;
    toutRepeindre();
  }
  function pasJeu(d) {
    const k = tonChant() || hypothese;
    const base = S.jeu != null ? S.jeu : k ? (k.mode === 'maj' ? k.tonic : GP.mod(k.tonic + 3)) : 0;
    changerJeu(base + d);
  }
  function toutRepeindre() {
    peindreBarre(); peindreMaintenant(); peindreEnsuite(); peindreClavier(); redessinerGrille(); melodieSale(true); peindreSuggestions();
  }
  function choisirTonManuelle(k) {
    S.tonManuelle = k; sauver();
    if (k) m.fixerTonalite(k, m.tNow); else m.reprendreTonaliteAuto();
    peindreBarre();
  }

  /* ---------- Clavier ---------- */
  function peindreClavier() {
    if (apercuActif) return;
    const c = celluleCourante();
    if (!c) { clavier.afficher(null, {}); precV = null; $('#kbEtat').innerHTML = '<span>Aucun accord pour l\'instant</span>'; return; }
    const v = voicingDe(c, precV); precV = v;
    clavier.afficher(v, optsClavier(c.ton));
    // La ligne d'état du panneau : ce qui est affiché sur les touches, en clair.
    $('#kbEtat').innerHTML = `<b>${echappe(nomA(c.racine, qAffichee(c), c.ton))}</b><span>Basse <span class="kb-basse">${echappe(nomN(c.basse, c.ton))}</span></span><span>Doigté MG ${v.dg.join('-')} / MD ${v.dd.join('-')}</span>`;
  }
  function finApercu() { clearTimeout(apercuT); apercuActif = false; $('#apercu').hidden = true; peindreClavier(); }
  function apercu(nom, liste, k, dur = 1.1) {
    clearTimeout(apercuT); apercuActif = true;
    $('#apercuNom').textContent = nom; $('#apercu').hidden = false;
    clavier.suite(liste, { dur, ...optsClavier(k) });
    if (enCours) apercuT = setTimeout(finApercu, (liste.length * dur + 5) * 1000);
  }
  $('#apercuFin').onclick = finApercu;
  for (const b of $$('.act-accord')) b.onclick = () => clavier.ecouter();
  $('#nowBtn').onclick = () => clavier.ecouter();
  function basculerMains() {
    S.mains = !S.mains; sauver(); clavier.montrerMains(S.mains); peindreMains();
  }
  function peindreMains() { for (const b of $$('.act-mains')) { b.setAttribute('aria-pressed', S.mains); const t = b.querySelector('span'); if (t) t.textContent = S.mains ? 'Mains' : 'Sans mains'; } }
  for (const b of $$('.act-mains')) b.onclick = basculerMains;

  /* ---------- Grille : incrémentale, jamais redessinée à chaque note ---------- */
  const grilleEl = $('#grille');
  let cartes = [], chantEls = new Map(), ligneCour = null, carteActive = null;
  const incertain = c => !c.corrige && (c.conf < SEUIL_CONF || ((provisoires.has(c) || c.retro) && c.chant === m.nChant && m.etat !== 'sure'));
  const coupureEntre = (a, b) => coupures.some(t => t > a.t && t <= b.t + .02);

  /* Paroles d'une case. Le mot qui ouvre la phrase suivante passe à la case d'après : on lit « me. » puis « I once », pas « me. I ». */
  const QUEUE_MOTS = /^(.*[.,;:!?])\s+([^.,;:!?]+)$/;
  function motsDe(i) {
    const c = m.grille[i], av = m.grille[i - 1], ap = m.grille[i + 1]; let t = c.mots || '';
    if (ap && ap.chant === c.chant) t = t.replace(QUEUE_MOTS, '$1');
    const q = av && av.chant === c.chant && av.mots && QUEUE_MOTS.exec(av.mots);
    return (q ? q[2] + ' ' + t : t).trim();
  }
  function contenuCarte(el, c) {
    const q = qAffichee(c), base = nomA(c.racine, c.q, c.ton), rich = q !== c.q ? nomA(c.racine, q, c.ton) : '', mots = c.reconnu ? '' : motsDe(+el.dataset.i);
    el.innerHTML = `<span class="c-l"><span class="c-d">${c.deg}</span><span class="c-n${rich ? ' c-e' : ''}">${echappe(rich || base)}</span></span><span class="c-m"${mots ? ` title="${echappe(mots)}"` : ''}>${echappe(mots)}</span>` +
      (c.corrige ? '<svg class="ic c-f" aria-hidden="true"><use href="#i-check"/></svg>' : c.deMemoire ? '<svg class="ic c-f" aria-hidden="true"><use href="#i-boucle"/></svg>' : incertain(c) ? '<span class="c-f c-q" aria-hidden="true">?</span>' : '');
    el.classList.toggle('incertain', incertain(c)); el.classList.toggle('corrige', !!c.corrige);
    el.setAttribute('aria-label', `Degré ${c.deg}, ${base}${rich ? ', enrichi ' + rich : ''}${incertain(c) ? ', à confirmer' : ''}${c.corrige ? ', corrigé' : ''}${mots ? ', ' + mots : ''}. Ouvrir.`);
  }
  function enteteChant(c) {
    const b = document.createElement('div'); b.className = 'chant'; b.toggleAttribute('data-hesite', hesite && c.chant === m.nChant); b.hidden = recoDe.has(c.chant);
    const h = document.createElement('div'); h.className = 'chant-t';
    const n = c.chant + 1;
    h.innerHTML = `<b>${echappe(titres.get(c.chant) || 'Chant ' + n)}</b><span>${echappe(nomT(c.ton))}</span>` + (titres.has(c.chant) ? '' : '<span class="c-prop">proposition</span>') + (S.jeu != null ? `<span class="c-tp">tu joues en ${echappe(nomT(vueDe(c.ton).pk))}, ${echappe(GP.texteTranspose(c.ton, S.jeu))}</span>` : '');
    b.append(h);
    return b;
  }
  function nouvelleLigne(chantEl) {
    const l = document.createElement('div'); l.className = 'ligne';
    l.innerHTML = '<span class="sec"></span><div class="cartes"></div>';
    chantEl.append(l);
    return l;
  }
  function placerCarte(i) {
    const c = m.grille[i], prec = i > 0 ? m.grille[i - 1] : null;
    if (!chantEls.has(c.chant)) { const b = enteteChant(c); grilleEl.append(b); chantEls.set(c.chant, b); ligneCour = null; }
    const b = chantEls.get(c.chant);
    const mod = prec && prec.chant === c.chant && !memeTon(prec.ton, c.ton);
    if (mod) {
      const x = document.createElement('div'); x.className = 'mod-marque';
      x.innerHTML = '<svg class="ic"><use href="#i-haut"/></svg><span>Nouvelle tonalité : ' + echappe(nomT(c.ton)) + (S.jeu != null ? ', ' + echappe(GP.texteTranspose(c.ton, S.jeu)) : '') + '</span>';
      b.append(x);
    }
    // Une rangée par phrase : c'est le repère du musicien, et les reprises s'alignent les unes sous les autres.
    if (!ligneCour || !prec || prec.chant !== c.chant || mod || coupureEntre(prec, c)) ligneCour = nouvelleLigne(b);
    const el = document.createElement('button'); el.className = 'carte'; el.dataset.i = i;
    contenuCarte(el, c);
    ligneCour.lastElementChild.append(el);
    if (c.lettre) lettreLigne(ligneCour, c.lettre);
    cartes[i] = el;
    if (cartes[i - 1] && prec && prec.mots) contenuCarte(cartes[i - 1], prec);
  }
  function lettreLigne(l, lettre) { const s = l.firstElementChild; s.textContent = lettre; }
  /* Le moteur a refait la grille depuis `depuis` : on ne redessine que ce chant. */
  function refaireDepuis(depuis) {
    const g = m.grille; const c0 = g[Math.min(depuis, g.length - 1)];
    if (!c0) { nettoyerChantsVides(); return; }
    let i0 = g.indexOf(c0); while (i0 > 0 && g[i0 - 1].chant === c0.chant) i0--;
    // Refaire le chant ne doit pas faire sauter le défilement de celui qui relit plus haut.
    const haut = grilleEl.scrollTop, b = chantEls.get(c0.chant); if (b) { b.remove(); chantEls.delete(c0.chant); }
    cartes.length = i0; ligneCour = null;
    for (let i = i0; i < g.length; i++) placerCarte(i);
    grilleEl.scrollTop = haut;
    nettoyerChantsVides(); suivreDirect(); marquerActive();
  }
  function nettoyerChantsVides() { for (const [n, el] of chantEls) if (!m.grille.some(c => c.chant === n)) { el.remove(); chantEls.delete(n); } }
  function redessinerGrille() {
    for (const el of chantEls.values()) el.remove();
    chantEls.clear(); cartes = []; ligneCour = null;
    m.grille.forEach((_, i) => placerCarte(i));
    for (const n of recoDe.keys()) blocReco(n);
    $('#grilleVide').hidden = m.grille.length > 0 || recoDe.size > 0;
    peindreStructure(); marquerActive(); suivreDirect(); fermerPop('popCase');
  }
  function marquerActive() {
    if (carteActive) carteActive.classList.remove('active');
    carteActive = !enCours ? null : rc ? rc.cartes[rc.k] : cartes[indiceCourant];
    if (carteActive) carteActive.classList.add('active');
  }
  function peindreStructure() {
    const g = m.grille, n = g.length ? g[g.length - 1].chant : -1; let s = [], av = null, l = null;
    for (const c of g) { if (c.chant !== n) continue; if (c.lettre && (c.lettre !== l || (av && coupureEntre(av, c)))) { s.push(c.lettre); l = c.lettre; } av = c; }
    $('#structure').textContent = s.join(' ');
    arbreSale();
  }

  /* ---------- Arbre de la session : lu dans la grille dessinée, donc jamais un décor ---------- */
  const plies = new Set(); let arbreDu = false;
  function arbreSale() {
    if (arbreDu || !pc.matches || document.body.dataset.arbre === 'masque') return;
    arbreDu = true; requestAnimationFrame(() => { arbreDu = false; peindreArbre(); });
  }
  function peindreArbre() {
    const el = $('#arbreCorps'), f = document.activeElement, cle = f && el.contains(f) ? f.dataset.k : null;
    let h = '';
    for (const n of [...new Set([...chantEls.keys(), ...recoDe.keys()])].sort((x, y) => x - y)) {
      const b = chantEls.get(n), r = recoDe.get(n);
      if (r) { h += `<div class="ar-reconnu"><b>${echappe(r.titre)}</b><small>${echappe(nomT(r.cases[0].ton))}</small></div>`; continue; }
      const c = m.grille.find(x => x.chant === n); if (!c) continue;
      const ouvert = !plies.has(n);
      h += `<button class="ar-chant" data-k="c${n}" data-chant="${n}" aria-expanded="${ouvert}"><svg class="ic"><use href="#i-chevron"/></svg>Chant ${n + 1}<small>${echappe(nomT(c.ton))}${hesite && n === m.nChant ? ', probable' : ''}</small></button>`;
      if (!ouvert) continue;
      for (const x of b.children) {
        if (x.classList.contains('mod-marque')) { h += `<div class="ar-mod">${echappe(x.textContent)}</div>`; continue; }
        if (!x.classList.contains('ligne')) continue;
        const cs = [...x.querySelectorAll('.carte')]; if (!cs.length) continue;
        const i = cs[0].dataset.i, degres = cs.map(e => e.querySelector('.c-d').textContent).join(' ');
        h += `<button class="ar-phrase" data-k="p${i}" data-i="${i}"${carteActive && x.contains(carteActive) ? ' aria-current="true"' : ''}><b>${echappe(x.firstElementChild.textContent)}</b><span>${degres}</span></button>`;
      }
    }
    el.innerHTML = h || '<div class="vide"><b>Session vide</b><span>Lance l\'écoute, analyse un enregistrement ou regarde la démo. Chaque chant et ses phrases paraîtront ici.</span></div>';
    if (cle) { const x = el.querySelector(`[data-k="${cle}"]`); if (x) x.focus({ preventScroll: true }); }
  }
  /* Cliquer une phrase fait défiler le panneau vers elle, sans quitter la grille mélodique si elle est ouverte. */
  function allerPhrase(i) {
    if (document.body.dataset.panneau === 'enrichir') choisirPanneau('grille');
    const mel = document.body.dataset.panneau === 'melodie', p = panneauVisible();
    const l = mel ? (melLignes.find(x => x.i === i) || {}).el : cartes[i] && cartes[i].closest('.ligne');
    if (!l) return;
    suivre = false; p.scrollTop += l.getBoundingClientRect().top - p.getBoundingClientRect().top; $('#retourDirect').hidden = false;
    l.classList.add('repere'); setTimeout(() => l.classList.remove('repere'), 900);
  }
  $('#arbreCorps').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.chant != null) { const n = +b.dataset.chant; if (plies.has(n)) plies.delete(n); else plies.add(n); peindreArbre(); } else allerPhrase(+b.dataset.i);
  });
  function basculerArbre(v) {
    S.arbre = v; sauver();
    if (v) delete document.body.dataset.arbre; else document.body.dataset.arbre = 'masque';
    const b = $('#arbreBasculer'); b.setAttribute('aria-pressed', v); b.setAttribute('aria-label', v ? 'Masquer le panneau de gauche' : 'Montrer le panneau de gauche');
    if (v) arbreSale();
    melodieSale();
  }
  $('#arbreBasculer').onclick = () => basculerArbre(!S.arbre);
  function peindreEspace() {
    $('#espaceNom').textContent = document.body.dataset.onglet === 'labs' ? 'Enrichir mon jeu' : rc ? rc.titre : m.grille.length ? titres.get(m.nChant) || 'Chant ' + (m.nChant + 1) : 'Session vide';
  }
  function peindreStatut() {
    $('#stEtat').textContent = document.body.dataset.onglet === 'labs' ? 'Labs' : !enCours ? 'Au repos' : demoLancee ? 'Démo en cours' : A.mode === 'micro' ? 'Micro ouvert, j\'écoute' : 'Analyse de l\'enregistrement';
    $('#stNota').textContent = S.notation === 'fr' ? 'Do Ré Mi' : 'C D E';
  }
  /* Suivre le direct sans voler le défilement : on ne descend que si l'utilisateur est resté en bas. */
  function panneauVisible() { return document.body.dataset.panneau === 'melodie' ? $('#melodie') : grilleEl; }
  function suivreDirect() { if (suivre) requestAnimationFrame(() => { const p = panneauVisible(); if (rc && p === grilleEl) { if (carteActive) carteActive.scrollIntoView({ block: 'nearest' }); } else p.scrollTop = p.scrollHeight; }); }
  for (const p of [grilleEl, $('#melodie')]) p.addEventListener('scroll', () => {
    if (p !== panneauVisible() || (rc && p === grilleEl)) return; // la grille d'un chant reconnu suit la position, pas le bas
    suivre = p.scrollHeight - p.scrollTop - p.clientHeight < 48;
    $('#retourDirect').hidden = suivre || !m.grille.length;
  }, { passive: true });
  $('#retourDirect').onclick = () => { suivre = true; $('#retourDirect').hidden = true; suivreDirect(); };

  grilleEl.addEventListener('click', e => { const b = e.target.closest('.carte'); if (b) ouvrirCase(+b.dataset.i, b); });

  /* ---------- Une case : doigté, écoute, correction ---------- */
  // Un indice de case n'est pas stable : le moteur fusionne et remplace des cases. On repère la case par son chant et son attaque.
  let caseRef = null;
  const indiceCase = r => (!r ? -1 : r.code != null ? r.code : m.grille.findIndex(c => c.chant === r.chant && c.t === r.t));
  /* Une case d'un chant reconnu n'est pas dans m.grille : son indice est négatif et dit son chant et son rang. -1 reste « aucune ». */
  const codeCase = (n, k) => -2 - (n * 1000 + k);
  const caseDe = i => { if (i >= 0) return m.grille[i]; if (i === -1) return null; const v = -2 - i, r = recoDe.get(Math.floor(v / 1000)); return r ? r.cases[v % 1000] : null; };
  function ouvrirCase(i, ancre) {
    const c = caseDe(i); if (!c) return;
    caseRef = { chant: c.chant, t: c.t, deg: c.deg, code: i < 0 ? i : null };
    $('#caseTitre').innerHTML = `<span class="cs-d">${c.deg}</span> ${echappe(nomA(c.racine, qAffichee(c), c.ton))}`;
    const alts = (c.alternatives || []).filter(a => a.deg !== c.deg).slice(0, 2), vus = new Set([c.deg, ...alts.map(a => a.deg)]);
    $('#caseAlts').innerHTML = alts.map(a => boutonAlt(a.deg, nomA(a.racine, a.q, c.ton), 'alt-grand')).join('') || '<p class="note">Choisis le bon degré ci-dessous.</p>';
    $('#caseAutres').innerHTML = GP.SIX[c.ton.mode].filter(d => !vus.has(d)).map(d => { const a = GP.accordDeDegre(c.ton, d); return boutonAlt(d, nomA(a.racine, a.q, c.ton), 'alt-petit'); }).join('');
    ouvrirPop('popCase', ancre);
    if (!clavierCase) clavierCase = GP.Clavier($('#caseClavier'), { mains: true, zoom: true });
    clavierCase.afficher(voicingDe(c, null), optsClavier(c.ton));
  }
  const boutonAlt = (d, n, cl) => `<button class="${cl}" data-deg="${d}"><b>${d}</b> ${echappe(n)}</button>`;
  $('#popCase').addEventListener('click', e => { const x = e.target.closest('[data-deg]'); if (x) { const i = indiceCase(caseRef); fermerPop('popCase'); if (i !== -1) corriger(i, +x.dataset.deg); } });
  /* La case ouverte a pu bouger : le volet suit la sienne, ou se referme si elle n'existe plus ou ne dit plus la même chose. */
  function recalerCase() {
    if ($('#popCase').hidden || !caseRef) return;
    const i = indiceCase(caseRef);
    const c = caseDe(i);
    if (!c || c.deg !== caseRef.deg) { fermerPop('popCase', true); return; }
    if (cartes[i]) popAncre = cartes[i];
  }
  $('#caseEcouter').onclick = () => { if (clavierCase) clavierCase.ecouter(); };
  function corriger(i, deg) {
    if (i < 0) { corrigerReco(i, deg); return; }
    const c = m.grille[i]; if (!c) return;
    const av = c.deg, cible = c;
    m.corriger(i, deg);
    annoncer('Case corrigée. Je réutilise ta correction aux reprises.', { ic: 'i-check', annuler: () => { const j = m.grille.indexOf(cible); if (j >= 0) m.corriger(j, av); } });
  }

  /* ---------- Grille mélodique : une partition simplifiée, une ligne par phrase ---------- */
  const melEl = $('#melodie');
  let melLignes = [], melTout = true, curseurEl = null, ligneCursor = null, melLarg = 0;
  function melodieSale(tout) { if (tout) melTout = true; if (document.body.dataset.panneau === 'melodie') dessinerMelodie(); }
  const iActif = () => (rc ? codeCase(rc.n, rc.k) : indiceCourant);
  const pxSec = () => Math.max(PX_SEC_MIN, melLarg / SECONDES_LIGNE);
  /* Découpe en lignes : mêmes phrases que la grille, coupées si elles dépassent la largeur. */
  function lignesMelodie() {
    const g = m.grille, sortie = []; if (!melLarg) return sortie;
    const fenetre = melLarg / pxSec(), fin = enCours ? m.tNow : (notes.length ? notes[notes.length - 1].fin : 0);
    const debuts = [];
    // Avant la première case, le trait et le nom de la note paraissent déjà : la mélodie n'attend pas la tonalité.
    if (enCours && !g.some(c => c.chant === m.nChant)) {
      const pr = notes.find(n => n.chant === m.nChant), t0 = pr ? pr.debut : noteEnCours ? noteEnCours.debut : null;
      if (t0 != null) for (let a = t0, n = 0; a < fin - .05 || n === 0; a += fenetre, n++) sortie.push({ t0: a, t1: Math.min(a + fenetre, fin), ton: hypothese ? { tonic: hypothese.tonic, mode: hypothese.mode } : { tonic: 0, mode: 'maj' }, chant: m.nChant, lettre: null, i: -1, ouverte: a + fenetre >= fin, sansAccord: true });
    }
    g.forEach((c, i) => { const p = g[i - 1]; if (!p || p.chant !== c.chant || !memeTon(p.ton, c.ton) || coupureEntre(p, c)) debuts.push(i); });
    debuts.forEach((i, r) => {
      const c = g[i], suiv = debuts[r + 1] != null ? g[debuts[r + 1]] : null;
      let t1 = suiv && suiv.chant === c.chant ? suiv.t : null;
      let t0 = c.t;
      if (i === 0 || g[i - 1].chant !== c.chant) { const pr = notes.find(n => n.chant === c.chant); if (pr && pr.debut < t0) t0 = pr.debut; }
      if (t1 == null) { const dn = notes.filter(n => n.chant === c.chant).pop(); const dern = suiv ? c.t + c.dur : (c.chant === m.nChant ? fin : (dn ? dn.fin : c.t + c.dur)); t1 = Math.max(dern, t0 + .5); }
      for (let a = t0, n = 0; a < t1 - .05 || n === 0; a += fenetre, n++) sortie.push({ t0: a, t1: Math.min(a + fenetre, t1), ton: c.ton, chant: c.chant, lettre: n === 0 ? c.lettre : null, i, ouverte: !suiv && c.chant === m.nChant && enCours && a + fenetre >= t1 });
    });
    return sortie;
  }
  /* Les cases d'une ligne : chaque accord tient jusqu'au suivant, le premier du chant remonte au début, le dernier tient jusqu'au bout de la ligne. Aucune ligne sans accord. */
  function casesDeLigne(l) {
    const g = m.grille, res = [], r = recoDe.get(l.chant), t0 = r ? r.trace[0].t : Infinity;
    for (let i = 0; i < g.length; i++) {
      const c = g[i]; if (c.chant !== l.chant || c.t >= t0) continue;
      const av = g[i - 1], ap = g[i + 1], debut = av && av.chant === c.chant ? c.t : -Infinity, fin = Math.min(t0, ap && ap.chant === c.chant ? ap.t : Infinity);
      if (debut < l.t1 && fin > l.t0) res.push({ i, c, a: Math.max(debut, l.t0), fin });
    }
    // Après la reconnaissance, les blocs sont les cases par lesquelles la position est passée.
    if (r) r.trace.forEach((x, j) => { const fin = r.trace[j + 1] ? r.trace[j + 1].t : Infinity; if (x.t < l.t1 && fin > l.t0) res.push({ i: codeCase(l.chant, x.k), c: r.cases[x.k], a: Math.max(x.t, l.t0), fin }); });
    return res;
  }
  /* Le nom se colle au début du trait : au dessus, sinon en dessous, et seulement en dernier recours il glisse à droite. */
  function placerNom(pris, x0, yy, w, h) {
    const libre = (tx, y0) => pris.every(d => tx + w <= d.x || tx >= d.x + d.w || y0 + h <= d.y || y0 >= d.y + h);
    const dessus = yy - 4 - h, dessous = yy + 4, xMax = Math.max(0, melLarg - w), x1 = Math.min(x0, xMax);
    let tx = x1, y0 = dessus;
    if (!libre(tx, y0)) { if (libre(x1, dessous)) y0 = dessous; else for (const d of pris) if (!libre(tx, y0)) tx = Math.min(xMax, d.x + d.w + 2); }
    pris.push({ x: tx, y: y0, w }); if (pris.length > 8) pris.shift();
    return { x: tx, y: y0 + h * .8 };
  }
  function dessinerLigne(l) {
    const px = pxSec(), x = t => (t - l.t0) * px, v = vueDe(l.ton), pk = v.pk, fsNom = 15, demi = 7.2, carL = fsNom * .6, hNom = fsNom * 1.08, fsB = 15;
    const ns = notes.filter(n => n.chant === l.chant && n.debut >= l.t0 - .001 && n.debut < l.t1);
    const hs = ns.map(n => n.midi - v.sh);
    if (l.ouverte && noteEnCours && noteEnCours.debut >= l.t0) hs.push(noteEnCours.midi - v.sh);
    let lo = hs.length ? Math.min(...hs) : 60 - v.sh - 5, hi = hs.length ? Math.max(...hs) : 60 - v.sh + 5;
    while (hi - lo < 10) { lo--; if (hi - lo < 10) hi++; }
    const haut = (hi - lo) * demi, y = h => (hi - h) * demi, dessus = hNom + 8, dessous = hNom + 8;
    // Seulement la tonique et la quinte : assez pour se repérer, trop peu pour gêner la lecture.
    let lignes = '';
    for (let h = lo; h <= hi; h++) { const rel = GP.mod(h - pk.tonic); if (rel === 0 || rel === 7) lignes += `<line class="${rel === 0 ? 'tonique' : 'portee'}" x1="0" x2="${melLarg}" y1="${y(h)}" y2="${y(h)}"/>`; }
    let traits = '', txt = ''; const pris = [];
    for (const n of ns) {
      const h = n.midi - v.sh, x0 = x(n.debut), x1 = Math.max(x0 + 6, x(n.fin) - 2), yy = y(h), nom = GP.nomNote(h, pk, S.notation), w = nom.length * carL + 2, pos = placerNom(pris, x0 - 2, yy, w, hNom);
      traits += `<line class="trait" x1="${x0.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${yy}" y2="${yy}"/>`;
      txt += `<text class="nom-note" x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}">${echappe(nom)}</text>`;
    }
    // Les blocs suivent le temps ; un accord très bref garde une largeur lisible et pousse le suivant au lieu de le chevaucher.
    let finBloc = 0, blocs = '', ch = l.sansAccord ? [] : casesDeLigne(l);
    if (l.sansAccord) blocs = `<span class="bloc attente" style="left:0;width:${melLarg}px"><span>J'écoute</span></span>`;
    ch.forEach(({ i, c, a, fin }, r) => {
      const dernierBloc = r === ch.length - 1, xa = Math.max(x(a), finBloc), xb = dernierBloc ? melLarg : x(Math.min(fin, l.t1)), lg = Math.max(pc.matches ? 30 : 44, xb - xa - 1), nm = nomA(c.racine, qAffichee(c), c.ton);
      finBloc = xa + lg + 1;
      const nomW = nm.length * fsB * .6, degW = fsB, pad = 14, avecDeg = lg > nomW + degW + pad, avecNom = lg > nomW + pad;
      const actif = i === iActif() && enCours, marque = incertain(c) ? ' incertain' : '', prop = actif && !c.corrige && !c.deMemoire && !c.reconnu ? ' propose' : '';
      blocs += `<button class="bloc${marque}${actif ? ' active' : ''}${prop}" data-i="${i}" style="left:${xa.toFixed(1)}px;width:${lg.toFixed(1)}px" aria-label="Degré ${c.deg}, ${echappe(nm)}${marque ? ', à confirmer' : ''}. Ouvrir."><b>${c.deg}</b>${avecNom ? '<span>' + echappe(nm) + '</span>' : ''}</button>`;
    });
    l.el.toggleAttribute('data-hesite', hesite && l.chant === m.nChant);
    l.el.innerHTML = `<span class="sec${l.lettre ? '' : ' sans'}">${l.lettre || ''}</span><div class="m-c"><div class="blocs">${blocs}</div><svg class="partition" width="${melLarg}" height="${haut + dessus + dessous}" viewBox="0 ${-dessus} ${melLarg} ${haut + dessus + dessous}" role="img" aria-label="${ns.length} notes : ${echappe(ns.map(n => GP.nomNote(n.midi - v.sh, pk, S.notation)).join(' '))}">${lignes}${traits}${txt}<line class="trait vivant" hidden x1="0" x2="0" y1="0" y2="0"/><text class="nom-note vivant-nom" hidden></text></svg></div>`;
    Object.assign(l, { y, lo, hi, sh: v.sh, pk, pris, carL, hNom, trV: l.el.querySelector('.vivant'), nomV: l.el.querySelector('.vivant-nom'), noteV: null });
    if (l.ouverte) { curseurEl = document.createElement('i'); curseurEl.className = 'curseur'; curseurEl.style.transform = `translateX(${x(enCours ? m.tNow : l.t1).toFixed(1)}px)`; l.el.lastElementChild.append(curseurEl); ligneCursor = l; }
  }
  function dessinerMelodie() {
    const lg = melEl.clientWidth - (pc.matches ? 40 : 34); if (lg <= 0) return;
    if (Math.abs(lg - melLarg) > 1) { melLarg = lg; melTout = true; }
    const spec = lignesMelodie(); $('#melodieVide').hidden = spec.length > 0;
    if (melTout) { melLignes.forEach(l => l.el.remove()); melLignes = []; melTout = false; }
    curseurEl = null; ligneCursor = null;
    spec.forEach((l, k) => {
      const nb = notes.filter(n => n.chant === l.chant && n.debut >= l.t0 && n.debut < l.t1).length;
      // L'indice entre dans la signature : les boutons de bloc portent data-i, et grilleRefaite peut décaler les indices sans changer les degrés.
      const sig = [l.t0.toFixed(2), l.t1.toFixed(1), nb, l.lettre, l.sansAccord ? '-' : casesDeLigne(l).map(({ i, c, fin }) => i + ':' + c.deg + (incertain(c) ? '?' : '') + (Number.isFinite(fin) ? '' : '.') + (i === iActif() && enCours ? '*' : '')).join(',')].join('|');
      const a = melLignes[k];
      if (a && a.sig === sig && !l.ouverte) { a.ouverte = false; return; }
      const el = a ? a.el : document.createElement('div');
      if (!a) { el.className = 'mligne'; melEl.append(el); }
      Object.assign(l, { el, sig }); melLignes[k] = l;
      dessinerLigne(l);
    });
    while (melLignes.length > spec.length) melLignes.pop().el.remove();
    suivreDirect();
  }
  melEl.addEventListener('click', e => { const b = e.target.closest('.bloc'); if (b) ouvrirCase(+b.dataset.i, b); });

  /* ---------- Enrichir : peu, et jamais envahissant ---------- */
  function calculerSuggestions() {
    const c = celluleCourante(); if (!c) return;
    const res = GP.suggestions({ deg: c.deg, suivant: prochain && prochain.deg !== c.deg ? prochain.deg : null, mode: c.ton.mode, style: S.style, niveau: S.profondeur === 'enrichi' ? 2 : 1, dejaVus, noteChantee: noteEnCours ? GP.mod(noteEnCours.midi - c.ton.tonic) : null });
    if (res.length) idees = res.map(e => ({ e, ton: c.ton }));
    peindreSuggestions();
  }
  /* Une idée ne vaut que pour l'accord en cours ou le suivant. Rien plutôt qu'une idée périmée. */
  function ideeValable({ e, ton }) {
    const c = celluleCourante(), q = e.quand;
    if (!c || !memeTon(ton, c.ton)) return false;
    return q.sur != null ? q.sur === c.deg : q.de === c.deg && !!prochain && prochain.deg === q.vers;
  }
  function peindreSuggestions() {
    idees = idees.filter(ideeValable);
    const t = $('#tabEnrichir'); t.toggleAttribute('data-signal', idees.length > 0 && document.body.dataset.panneau !== 'enrichir');
    t.setAttribute('aria-label', idees.length ? 'Enrichir, une suggestion disponible' : 'Enrichir');
    const html = idees.length ? idees.map(({ e }, i) => {
      const q = e.quand, tag = q.sur != null ? 'Sur ce ' + q.sur : 'Avant le ' + q.vers;
      return `<div class="sugg"><div class="sg-t"><small>${tag}</small><b>${echappe(e.nom)}</b><span class="sg-p">${echappe(e.pourquoi)}</span></div><div class="sg-a"><button class="icone sg-son" data-sg="ecoute" data-i="${i}" aria-label="Écouter ${echappe(e.nom)}" title="Écouter"><svg class="ic"><use href="#i-haut-parleur"/></svg></button><button class="icone" data-sg="voir" data-i="${i}" aria-label="Voir ${echappe(e.nom)} sur le clavier" title="Voir sur le clavier"><svg class="ic"><use href="#i-oeil"/></svg></button></div></div>`;
    }).join('') : '<p class="note">Reste sur le squelette, une idée viendra ici.</p>';
    $('#suggs').innerHTML = html; $('#suggsTel').innerHTML = html;
  }
  for (const el of [$('#suggs'), $('#suggsTel')]) el.addEventListener('click', ev => {
    const x = ev.target.closest('[data-sg]'); if (!x) return;
    const { e, ton } = idees[+x.dataset.i], pk = vueDe(ton).pk, l = GP.jouerEntree(e, pk);
    apercu(e.nom, l, ton);
    if (x.dataset.sg === 'ecoute') A.jouerSuite(l.map(a => ({ mg: a.mg, md: a.md })), { dur: 1.1 });
    if (!pc.matches && document.body.dataset.onglet !== 'live') choisirOnglet('live');
  });

  /* ---------- Événements du moteur ---------- */
  m.on('accord', a => {
    indiceCourant = a.index; const c = m.grille[a.index];
    if (a.ambigu) c.ambigu = true;
    if (a.provisoire) provisoires.add(c);
    // Chaque accord remet les idées à zéro : celle de l'accord précédent ne survit jamais à son accord.
    idees = [];
    peindreMaintenant(); peindreClavier(); peindreEnsuite();
    $('#grilleVide').hidden = true;
    placerCarte(a.index); marquerActive(); suivreDirect(); peindreStructure(); peindreReco();
    if (!rc) voixAccord(c);
    // Latence réelle : de l'attaque de la note à cet affichage. Médiane, car une décision rétroactive arrive parfois plus tard.
    const d = (m.tNow - a.t) * 1000;
    if (d >= 0 && d < 10000) { latences.push(d); if (latences.length > 9) latences.shift(); $('#stLat').textContent = 'Latence ' + Math.round([...latences].sort((x, y) => x - y)[latences.length >> 1]) + ' ms'; }
    if (!suggDue) { suggDue = true; requestAnimationFrame(() => { suggDue = false; calculerSuggestions(); peindreEnsuite(); }); }
    melodieSale();
  });
  m.on('accordCorrige', ({ index, parMusicien, mots }) => {
    const c = m.grille[index], el = cartes[index]; if (!c) return;
    if (el) contenuCarte(el, c);
    if (mots) return;
    arbreSale();
    // Seule une correction du musicien se signale : celles du moteur changent la grille sans voler le regard.
    if (el && parMusicien) { el.classList.remove('change'); void el.offsetWidth; el.classList.add('change'); }
    if (index === indiceCourant) { peindreMaintenant(); precV = null; peindreClavier(); peindreEnsuite(); peindreSuggestions(); }
    if (caseRef && indiceCase(caseRef) === index && !$('#popCase').hidden && !parMusicien) ouvrirCase(index, el);
    if (parMusicien) melodieSale(true); else melodieSale();
  });
  /* Le moteur a fusionné ou remplacé des cases : tout indice gardé est à recaler. La case en cours reste la dernière du chant.
     Une décision silencieuse n'émet ni accord ni prochain : c'est pourquoi Ensuite restait vide après cet événement. On redemande la prévision. */
  m.on('grilleRefaite', ({ depuis }) => {
    const n = m.grille.length; let i = n - 1; while (i >= 0 && m.grille[i].chant !== m.nChant) i--;
    indiceCourant = i;
    refaireDepuis(depuis); $('#grilleVide').hidden = n > 0;
    recalerCase();
    if (i >= 0 && enCours) m._predit(m.tNow);
    peindreMaintenant(); peindreClavier(); peindreEnsuite(); peindreSuggestions(); peindreStructure(); peindreBarre(); melodieSale();
  });
  m.on('prochain', p => { if (rc) return; if (!prochain || prochain.deg !== p.deg) jaugeMax = 0; prochain = p; if (!suggDue) { peindreEnsuite(); peindreSuggestions(); } });
  m.on('tonaliteProvisoire', h => { hypothese = h; peindreBarre(); peindreMaintenant(); melodieSale(true); });
  m.on('tonalite', t => {
    const av = tonEtat, attendait = tonEcoute; tonEtat = t.etat; hypothese = null; precV = null;
    if (t.modulation || t.correction || t.finEcoute) tonEcoute = false;
    if (!rc && (t.modulation || t.correction)) prochain = null; // une prédiction faite dans l'ancienne tonalité ne vaut plus
    peindreBarre(); peindreMaintenant(); peindreEnsuite(); peindreSuggestions();
    if (rc) return; // la tonalité dite est celle du chant reconnu, les hésitations du moteur restent derrière
    if (t.finEcoute) { if (attendait) annoncer(`Pas de changement entendu : toujours <b>${echappe(nomT({ tonic: t.tonic, mode: t.mode }))}</b>.`, { ic: 'i-sure', html: true }); return; }
    if (t.modulation) {
      const k = { tonic: t.tonic, mode: t.mode }, tx = (t.de ? nomT(t.de) + ' devient ' : 'Nouvelle tonalité : ') + nomT(k);
      annoncer(`<b>${echappe(tx)}.</b>` + (S.jeu != null ? ` Règle ton clavier sur <b>${echappe(GP.texteTranspose(k, S.jeu))}</b>.` : ''), { ic: 'i-haut', fort: true, html: true });
      dire(S.jeu != null ? 'Changement de tonalité, transpose ' + valTp(k).replace('+', 'plus ').replace('-', 'moins ') : 'Changement de tonalité, ' + parle(nomT(k)));
    } else if (!t.correction && t.etat === 'probable' && av == null && S.jeu != null) {
      annoncer(`${echappe(nomT({ tonic: t.tonic, mode: t.mode }))} : règle ton clavier sur <b>${echappe(GP.texteTranspose(t, S.jeu))}</b>.`, { ic: 'i-sure', html: true });
    }
    // Une correction se dit en une ligne, sans rien bloquer : la grille et le clavier suivent par grilleRefaite, juste après.
    if (t.correction && !t.modulation && !memeTon(t.de, t)) {
      const k = { tonic: t.tonic, mode: t.mode };
      annoncer(`Tonalité corrigée : <b>${echappe(nomT(k))}</b>` + (S.jeu != null ? `, règle ton clavier sur <b>${echappe(GP.texteTranspose(k, S.jeu))}</b>` : ''), { ic: 'i-boucle', html: true });
    }
  });
  m.on('tempo', t => { for (const b of $$('.bpmV')) b.textContent = Math.round(t.bpm); });
  m.on('temps', () => { if (!matchMedia('(prefers-reduced-motion: reduce)').matches && document.visibilityState === 'visible') $('#battue').animate([{ opacity: 1 }, { opacity: .25 }], { duration: 140, easing: 'ease-out' }); });
  m.on('niveau', n => { dernierNiveau = n; if (n.signal) dernierSignal = performance.now(); });
  m.on('noteCourante', n => { noteEnCours = n; });
  m.on('note', n => {
    notes.push({ ...n, chant: m.nChant }); melodieSale();
    const a = performance.now(); Rec.note(n); recoMs = performance.now() - a;
    peindreReco();
  });
  m.on('phrase', p => {
    if (!p.lettre) return;
    coupures.push(p.t);
    // La lettre arrive après coup : on l'écrit sur la rangée qui vient de finir. Si elle diffère de celle déjà en marge, le chant se remet en page.
    const g = m.grille; let i = g.length - 1; while (i >= 0 && !g[i].lettre) i--;
    if (i >= 0 && cartes[i]) {
      const l = cartes[i].closest('.ligne'), en = l.firstElementChild.textContent;
      if (en && en !== g[i].lettre) refaireDepuis(i); else lettreLigne(l, g[i].lettre);
    }
    peindreStructure(); melodieSale();
  });
  m.on('nouveauChant', () => {
    Rec.nouveauChant();
    tonHyp = null; tonEcoute = false; if (tonTranche) { tonTranche = false; m.reprendreTonaliteAuto(); }
    indiceCourant = -1; tonEtat = null; hypothese = null; prochain = null; dejaVus = []; idees = []; precV = null; ligneCour = null;
    peindreBarre(); peindreMaintenant(); peindreEnsuite(); peindreClavier(); peindreSuggestions();
    peindreStructure(); peindreReco();
    annoncer('Nouveau chant : nouvelle grille.', { ic: 'i-plus' });
  });

  /* ---------- Chant reconnu : sa grille, dans la tonalité chantée, remplace les accords devinés ---------- */
  const casesReco = r => GP.grilleChant(r.e, r.tonique).map(c => ({ ...c, chant: r.n, dur: c.t * 60 / (r.e.bpm || 60) }));
  function blocReco(n) {
    const r = recoDe.get(n); if (recoEls.has(n)) recoEls.get(n).remove();
    const b = document.createElement('div'), k = r.cases[0].ton; b.className = 'chant chant-reco';
    const h = document.createElement('div'); h.className = 'chant-t';
    h.innerHTML = `<b>${echappe(r.titre)}</b><span>${echappe(nomT(k))}</span><span class="c-reconnu">${r.e.fiabilite === 'moyenne' ? 'reconnu, grille à vérifier' : 'reconnu'}</span>` + (S.jeu != null ? `<span class="c-tp">tu joues en ${echappe(nomT(vueDe(k).pk))}, ${echappe(GP.texteTranspose(k, S.jeu))}</span>` : '');
    b.append(h);
    // shortcut: 4 cases par rangée, le corpus ne dit pas où sont les phrases ; à revoir quand une base les donnera.
    r.cartes = []; let l = null;
    r.cases.forEach((c, i) => {
      if (i % 4 === 0) l = nouvelleLigne(b);
      const el = document.createElement('button'); el.className = 'carte'; el.dataset.i = codeCase(n, i);
      contenuCarte(el, c); l.lastElementChild.append(el); r.cartes[i] = el;
    });
    const e = chantEls.get(n); if (e) { e.hidden = true; grilleEl.insertBefore(b, e); } else grilleEl.append(b);
    recoEls.set(n, b); $('#grilleVide').hidden = true;
    if (rc === r) marquerActive();
  }
  /* Le prochain accord vient du chant : la première case suivante d'un autre degré, en repartant au début si le chant reboucle. */
  function prochainReco() {
    const L = rc.cases, cur = L[rc.k]; prochain = null;
    for (let d = 1; d < L.length; d++) { const c = L[(rc.k + d) % L.length]; if (c.deg !== cur.deg) { prochain = { deg: c.deg, racine: c.racine, q: c.q, basse: c.basse, dans: null, appris: false, duChant: true, confiance: 1 }; return; } }
  }
  function apresPosition(voix) {
    const c = celluleCourante();
    idees = []; prochainReco(); jaugeMax = 0;
    peindreMaintenant(); peindreClavier(); peindreEnsuite(); marquerActive(); suivreDirect(); melodieSale();
    if (voix) voixAccord(c);
    if (!suggDue) { suggDue = true; requestAnimationFrame(() => { suggDue = false; calculerSuggestions(); peindreEnsuite(); }); }
  }
  Rec.on('chantReconnu', e => {
    const n = m.nChant, r = { n, id: e.id, titre: e.titre, e: { ...e.entree, cases: e.entree.cases.map(c => ({ ...c })) }, tonique: e.tonique, k: e.iCase, cartes: [], trace: [{ t: m.tNow, k: e.iCase }], corrigee: false };
    r.cases = casesReco(r); rc = r; recoDe.set(n, r); precV = null;
    blocReco(n); peindreBarre(); peindreReco(); peindreStructure(); arbreSale(); apresPosition(true);
    annoncer(`<b>Reconnu : ${echappe(r.titre)}.</b>` + (S.jeu != null ? ` Règle ton clavier sur <b>${echappe(GP.texteTranspose(r.cases[r.k].ton, S.jeu))}</b>.` : ''), { ic: 'i-sure', html: true });
  });
  Rec.on('position', p => {
    if (!rc) return;
    const change = p.tonique !== rc.tonique;
    if (!change && p.iCase === rc.k) return;
    const voix = rc.cases[rc.k].deg !== rc.cases[p.iCase].deg;
    rc.k = p.iCase; rc.trace.push({ t: m.tNow, k: p.iCase });
    if (change) { rc.tonique = p.tonique; rc.cases = casesReco(rc); precV = null; blocReco(rc.n); peindreBarre(); melodieSale(true); }
    apresPosition(voix);
  });
  Rec.on('chantPerdu', e => {
    const r = rc; rc = null; prochain = null; precV = null; idees = [];
    // Un nouveau chant laisse la grille reconnue en place, comme un chant passé. Sinon on revient à la proposition du moteur, jamais perdue.
    if (e.raison !== 'nouveau' && r) {
      recoDe.delete(r.n); if (recoEls.has(r.n)) { recoEls.get(r.n).remove(); recoEls.delete(r.n); }
      if (chantEls.has(r.n)) chantEls.get(r.n).hidden = false;
      $('#grilleVide').hidden = m.grille.length > 0;
      if (indiceCourant >= 0 && enCours) m._predit(m.tNow);
      if (e.raison === 'musicien') annoncer('D\'accord, je reviens à ma proposition.', { ic: 'i-boucle' });
    }
    peindreBarre(); peindreMaintenant(); peindreClavier(); peindreEnsuite(); peindreSuggestions(); peindreStructure(); peindreReco(); marquerActive(); suivreDirect(); arbreSale(); melodieSale(true);
  });
  /* Corriger une case d'un chant reconnu : la correction vit sur la copie de ce passage, jusqu'à ce que le musicien l'enregistre. */
  function corrigerReco(i, deg) {
    const v = -2 - i, r = recoDe.get(Math.floor(v / 1000)); if (!r) return;
    const k = v % 1000, x = r.e.cases[k], av = { ...x }, [rel, q] = GP.DEGRES[x.mode][deg], maj = () => { r.corrigee = r.e.cases.some(c => c.corrige); r.cases = casesReco(r); blocReco(r.n); if (rc === r) { precV = null; apresPosition(false); } peindreReco(); melodieSale(true); };
    Object.assign(x, { deg, q, rel, relBasse: rel, corrige: true }); maj();
    annoncer('Case corrigée. Enregistre ta version pour la retrouver la prochaine fois.', { ic: 'i-check', annuler: () => { Object.assign(x, av); if (!av.corrige) delete x.corrige; maj(); } });
  }
  /* L'en-tête dit ce qu'on lit : une grille reconnue, ou une proposition. */
  let cleBande = '';
  function peindreReco() {
    const b = $('#recoBande'), g = m.grille.some(c => c.chant === m.nChant), dern = rc || [...recoDe.values()].pop(), passe = !g && !enCours && dern && !rc;
    const nb = g ? notes.filter(n => n.chant === m.nChant).length : 0, sauvable = rc ? rc.corrigee : g && nb >= 12 && !titres.has(m.nChant);
    const cle = [rc ? rc.titre : '', passe ? 1 : 0, g, enCours, sauvable, rc && rc.e.fiabilite, titres.get(m.nChant)].join();
    if (cle === cleBande) return; cleBande = cle;
    const vide = !rc && !g && !enCours;
    b.hidden = vide; if (vide) return;
    $('#recoTxt').innerHTML = rc ? `<span class="rb-et">Reconnu :</span> <b>${echappe(rc.titre)}</b>` + (rc.e.fiabilite === 'moyenne' ? '<small>, grille à vérifier</small>' : '') : titres.has(m.nChant) ? `<span class="rb-et">Enregistré :</span> <b>${echappe(titres.get(m.nChant))}</b>` : g ? '<span class="rb-prop">Proposition</span><small>, chant pas reconnu</small>' : '<small>Je cherche quel chant c\'est</small>';
    $('#recoNon').hidden = !rc;
    const s = $('#recoSauve'); s.hidden = !sauvable; s.textContent = rc ? 'Enregistrer ma version' : 'Enregistrer ce chant';
    peindreEspace();
  }
  $('#recoNon').onclick = () => Rec.rejeter();
  $('#recoSauve').onclick = () => { $('#annonce').hidden = true; $('#nomErr').hidden = true; const c = $('#nomChant'); c.value = rc ? rc.titre : ''; c.removeAttribute('aria-invalid'); ouvrirPop('popNom', $('#recoSauve')); c.focus({ preventScroll: true }); c.select(); };
  $('#nomChant').oninput = e => { e.target.removeAttribute('aria-invalid'); $('#nomErr').hidden = true; };
  $('#nomForm').addEventListener('submit', e => {
    e.preventDefault();
    const nom = $('#nomChant').value.trim(), err = t => { const x = $('#nomErr'); x.textContent = t; x.hidden = false; };
    if (!nom) { $('#nomChant').setAttribute('aria-invalid', 'true'); $('#nomChant').focus(); err('Donne un nom à ce chant.'); return; }
    const pb = enregistrerChant(nom); if (pb) { err(pb); return; }
    fermerPop('popNom', true); cleBande = ''; peindreReco();
    annoncer(`<b>« ${echappe(nom)} » est dans Mes chants.</b> Je le reconnaîtrai, même dans une autre tonalité.`, { ic: 'i-check', html: true });
  });
  /* Rend un message si rien n'a été enregistré. */
  function enregistrerChant(nom) {
    const r = rc, per = m._periode(), bpm = r ? r.e.bpm || 60 : Math.round(per ? 60 / per : 60);
    let ton, sig;
    if (r) {
      ton = { tonic: r.tonique, mode: r.e.mode };
      let dec = GP.mod(r.tonique - r.e.tonique); if (dec > 6) dec -= 12;
      sig = { notes: r.e.notes.map(([h, t]) => [h + dec, t]), cases: r.e.cases, duree: r.e.duree };
    } else {
      ton = tonChant(); if (!ton) return 'La tonalité n\'est pas encore trouvée : chante encore un peu.';
      sig = GP.signatureLive(notes.filter(n => n.chant === m.nChant), m.grille.filter(c => c.chant === m.nChant), ton, bpm);
      if (!sig || sig.notes.length <= 8) return 'Trop peu de notes pour reconnaître ce chant plus tard : chante encore un peu.';
    }
    // Le format de Labs, plus la signature : la mélodie et les cases y restent jouables.
    const cases = sig.cases.map((c, i) => { const k = { tonic: GP.mod(ton.tonic + c.dec), mode: c.mode }, fin = sig.cases[i + 1] ? sig.cases[i + 1].t0 : sig.duree; return { deg: c.deg, racine: GP.mod(k.tonic + c.rel), q: c.q, basse: GP.mod(k.tonic + c.relBasse), t: Math.max(1, Math.round(fin - c.t0)), ton: k }; });
    const melodie = sig.notes.map(([h, t], i) => [h, +(((sig.notes[i + 1] ? sig.notes[i + 1][1] : sig.duree) - t).toFixed(2))]);
    const ch = { id: 'm' + Date.now(), titre: nom, ton, bpm, mesure: (r && r.e.mesure) || 4, melodie, cases, signature: sig, remplace: r ? (r.e.appris ? r.e.remplace : r.id) : null };
    if (!GP.Labs.ajouterChant(ch, r && r.e.appris ? r.id : null)) return 'Ce chant n\'a pas pu être enregistré : le stockage est plein ou bloqué.';
    if (r) { r.titre = nom; r.id = ch.id; r.e = { ...r.e, ...GP.depuisMesChants(ch), cases: r.e.cases }; r.tonique = ton.tonic; r.corrigee = false; blocReco(r.n); }
    else titres.set(m.nChant, nom);
    syncBase(); redessinerGrille(); peindreEspace(); arbreSale();
    return null;
  }
  const syncBase = () => Rec.definirAppris(GP.Labs.mesChants());

  /* Voix : jamais sur téléphone sauf si tu l'as activée. */
  const parle = s => s.replace(/♯/g, S.notation === 'fr' ? ' dièse' : ' sharp').replace(/♭/g, S.notation === 'fr' ? ' bémol' : ' flat');
  function dire(t) { if (S.sortie === 'screen' || !A.voixPermise({ surTelephone: S.voixTel })) return; try { speechSynthesis.cancel(); } catch (e) { /* pas de file à vider */ } A.dire(t, { surTelephone: S.voixTel }); }
  function voixAccord(c) { const nom = parle(nomN(c.racine, c.ton)); dire(S.annonce === 'deg' ? MOTS[c.deg] : S.annonce === 'note' ? nom : MOTS[c.deg] + ', ' + nom); }

  const VU_BARRES = $$('.vuBarre'), VUS = $$('.vu');
  /* ---------- Boucle d'affichage : uniquement des transform, rien qui force la mise en page ---------- */
  function boucle() {
    rafBoucle = enCours ? requestAnimationFrame(boucle) : 0;
    const n = dernierNiveau;
    if (n) {
      const db = 20 * Math.log10(Math.max(n.rms, 1e-5)), v = Math.max(0, Math.min(1, (db + 60) / 48));
      const sx = `scaleX(${v.toFixed(3)})`, sg = !!n.signal;
      for (const x of VU_BARRES) x.style.transform = sx;
      for (const x of VUS) x.classList.toggle('signal', sg);
    }
    majAide();
    if (curseurEl && ligneCursor && document.body.dataset.panneau === 'melodie') {
      const l = ligneCursor, x = (m.tNow - l.t0) * pxSec();
      if (x > melLarg) { dessinerMelodie(); return; }
      curseurEl.style.transform = `translateX(${x.toFixed(1)}px)`;
      const c = noteEnCours, tr = l.trV, tn = l.nomV;
      if (tr) {
        if (c && c.debut >= l.t0) {
          const h = c.midi - l.sh;
          if (h < l.lo || h > l.hi) { dessinerMelodie(); return; } // hors du cadre de la ligne : on redessine plutôt que de déborder
          const yy = l.y(h), x0 = (c.debut - l.t0) * pxSec();
          tr.removeAttribute('hidden'); tr.setAttribute('x1', x0.toFixed(1)); tr.setAttribute('x2', Math.max(x0 + 6, x).toFixed(1)); tr.setAttribute('y1', yy); tr.setAttribute('y2', yy);
          // Le nom paraît dès l'attaque, sans attendre la fin de la note.
          if (l.noteV !== c) {
            l.noteV = c;
            const nom = GP.nomNote(h, l.pk, S.notation), pos = placerNom(l.pris.slice(), x0 - 2, yy, nom.length * l.carL + 2, l.hNom);
            tn.textContent = nom; tn.setAttribute('x', pos.x.toFixed(1)); tn.setAttribute('y', pos.y.toFixed(1)); tn.removeAttribute('hidden');
          }
        } else { tr.setAttribute('hidden', ''); tn.setAttribute('hidden', ''); l.noteV = null; }
      }
    }
  }
  /* Aide micro : claire, seulement si l'écoute dure sans rien capter. */
  function majAide() {
    const a = $('#aide'), now = performance.now();
    const silence = A.mode === 'micro' && now - Math.max(dernierSignal, debutEcoute) > SILENCE_AIDE * 1000;
    if (!silence) { if (!a.hidden) a.hidden = true; return; }
    const fort = dernierNiveau && dernierNiveau.rms > Math.max(.004, dernierNiveau.bruit * 3);
    const t = fort ? 'J\'entends du son, mais pas de voix nette.' : 'Je n\'entends rien.', d = 'Approche le téléphone du chantre, éloigne-le du piano.';
    if (a.hidden || $('#aideT').textContent !== t) { $('#aideT').textContent = t; $('#aideD').textContent = d; a.hidden = false; }
  }

  /* ---------- Démarrer, arrêter ---------- */
  /* Le bouton orange du téléphone : Écouter ou Arrêter, pour le Live comme pour Labs. */
  function etatFab(joue = enCours) { $('#fabTxt').textContent = joue ? 'Arrêter' : 'Écouter'; $('#fabIc').setAttribute('href', joue ? '#i-stop' : '#i-mic'); }
  function etatRun(b) {
    enCours = b; document.body.toggleAttribute('data-en-cours', b);
    if (!b) demoLancee = false;
    etatFab(); peindreStatut();
    if (b && !rafBoucle) rafBoucle = requestAnimationFrame(boucle);
    if (!b) { for (const x of VU_BARRES) x.style.transform = 'scaleX(0)'; for (const x of VUS) x.classList.remove('signal'); $('#aide').hidden = true; }
    peindreBarre(); peindreMaintenant(); peindreEnsuite(); marquerActive(); melodieSale(true);
    gardeEcran();
  }
  async function gardeEcran() {
    try {
      if (enCours && navigator.wakeLock && document.visibilityState === 'visible') verrouEcran = await navigator.wakeLock.request('screen');
      else if (!enCours && verrouEcran) { verrouEcran.release(); verrouEcran = null; }
    } catch (e) { /* écran non verrouillable ici : sans gravité */ }
  }
  document.addEventListener('visibilitychange', gardeEcran);
  function preparerChant() {
    const c = m.grille[m.grille.length - 1];
    if (c && c.chant === m.nChant) m.nouveauChant(heure());
    debutEcoute = performance.now(); dernierSignal = 0;
    if (S.sortie !== 'screen' && A.voixPermise({ surTelephone: S.voixTel })) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* synthèse absente */ } }
  }
  function occupe(b) { for (const x of [...$$('.act-micro'), $('#fab')]) { x.disabled = b; x.setAttribute('aria-busy', b); } }
  async function ecouter() {
    occupe(true);
    try {
      A.contexte(); preparerChant();
      await A.micro(m);
      etatRun(true); lancerParoles();
    } catch (e) {
      const nom = e && e.name;
      annoncer(nom === 'NotFoundError' ? '<b>Aucun micro détecté.</b> Branche un micro, ou analyse un enregistrement.' : nom === 'NotAllowedError' || nom === 'SecurityError' ? '<b>Le micro est bloqué.</b> Autorise-le depuis la barre d\'adresse (sur iPhone : « aA », Réglages du site web, Micro), puis réessaie.' : '<b>Micro indisponible ici.</b> Ouvre la page par son adresse https, ou analyse un enregistrement.', { ic: 'i-alert', erreur: true, html: true });
    }
    occupe(false);
  }
  async function analyser(f) {
    preparerChant();
    try {
      const r = await A.fichier(f, m, { surFin: () => finLecture('Analyse terminée. La grille reste affichée.') });
      etatRun(true); annoncer(`Analyse de « ${echappe(f.name)} » (${Math.round(r.duree)} s).`, { ic: 'i-ecoute', html: true });
    } catch (e) { A.arreter(); etatRun(false); annoncer('<b>Ce fichier ne se lit pas.</b> Essaie un .m4a de Mémos vocaux, un .mp3 ou un .wav.', { ic: 'i-alert', erreur: true, html: true }); }
  }
  async function demo() {
    preparerChant();
    try {
      const surFin = () => finLecture('Démo terminée. Touche une case pour la corriger ou l\'écouter.');
      try {
        await A.demoVoix(m, { volume: Math.min(1, S.volDemo * 2), surFin });
        demoLancee = true; etatRun(true); annoncer('Démo : Amazing Grace, voix sans instrument, Alabama, 1937.', { ic: 'i-play' });
      } catch (e) { // navigateur qui ne lit pas ce format : la mélodie de synthèse prend le relais
        await A.demo(m, { volume: S.volDemo, surFin });
        demoLancee = true; etatRun(true); annoncer('Démo : mélodie de synthèse, ce navigateur ne lit pas l\'enregistrement.', { ic: 'i-play' });
      }
    } catch (e) { annoncer('<b>L\'audio ne démarre pas dans ce navigateur.</b> Essaie Chrome, Edge ou Safari.', { ic: 'i-alert', erreur: true, html: true }); }
  }
  function finLecture(t) { etatRun(false); annoncer(t, { ic: 'i-check' }); }
  function arreter() {
    A.arreter(); arreterParoles(); etatRun(false);
    if (m.grille.length) annoncer('Arrêté. La grille reste affichée, touche une case pour revoir son doigté.', { ic: 'i-stop' });
  }
  const basculerEcoute = () => { if (enCours) arreter(); else ecouter(); };
  function nouveauChant() { if (enCours) { m.nouveauChant(heure()); } }
  /* La tonalité ne change que quand le musicien le dit : le moteur réécoute, la grille reste. Une tonalité choisie à la main se change dans son panneau. */
  function changementTon() {
    if (!enCours) return;
    if (S.tonManuelle) { basculerPopTon($('#tonBtn')); return; }
    if (popOuvert === 'popTon') fermerPop('popTon');
    tonTranche = false; tonHyp = null; tonEcoute = !!tonChant(); m.changerTonalite(heure());
    peindreBarre(); annoncer("Changement de tonalité : j'écoute la nouvelle.", { ic: 'i-boucle' });
  }
  function taper() {
    const b = m.taperTempo(heure());
    if (b == null) for (const x of $$('.bpmV')) x.textContent = '...';
  }
  for (const b of $$('.act-micro')) b.onclick = ecouter;
  for (const b of $$('.act-arret')) b.onclick = arreter;
  for (const b of $$('.act-demo')) b.onclick = demo;
  for (const b of $$('.act-nouveau')) b.onclick = nouveauChant;
  for (const b of $$('.act-changeton')) b.onclick = changementTon;
  for (const b of $$('.taper')) b.onclick = taper;
  for (const i of $$('.act-fichier')) i.onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) analyser(f); };
  /* Dans Labs, le bouton orange joue ce qui est ouvert. Si rien ne se joue là, il revient au Live et écoute. */
  $('#fab').onclick = () => {
    if (document.body.dataset.onglet === 'labs' && !enCours) { const b = document.querySelector('.lb .envoi'); if (b) { b.click(); return; } choisirOnglet('live'); }
    basculerEcoute();
  };

  /* Paroles : expérimental, si le navigateur sait faire */
  function lancerParoles() {
    if (!S.paroles || reco) return;
    const R = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!R) { annoncer('Reconnaissance des paroles non disponible dans ce navigateur.', { ic: 'i-alert' }); return; }
    try {
      reco = new R(); reco.lang = 'fr-FR'; reco.continuous = true;
      reco.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) m.ajouterMots(ev.results[i][0].transcript); };
      reco.onend = () => { if (enCours && reco) { try { reco.start(); } catch (e) { /* déjà relancé */ } } };
      reco.start();
    } catch (e) { reco = null; }
  }
  function arreterParoles() { if (reco) { try { reco.onend = null; reco.stop(); } catch (e) { /* déjà arrêté */ } reco = null; } }

  /* Micro coupé par le système */
  A.surEtat = e => {
    if (e.type === 'micro-coupe') annoncer('Le système a coupé le micro. Je le rouvre.', { ic: 'i-alert' });
    else if (e.type === 'micro-rouvert') annoncer('Micro rouvert.', { ic: 'i-check' });
    else if (e.type === 'micro-perdu') { etatRun(false); annoncer('<b>Micro perdu.</b> Touche Écouter pour le rouvrir.', { ic: 'i-alert', erreur: true, html: true }); }
  };

  /* ---------- Message ---------- */
  let annonceT = null, annulerFn = null;
  function annoncer(t, o = {}) {
    const a = $('#annonce'); clearTimeout(annonceT);
    if (o.html) $('#annonceT').innerHTML = t; else $('#annonceT').textContent = t;
    $('#annonceUse').setAttribute('href', '#' + (o.ic || 'i-check'));
    a.classList.toggle('fort', !!o.fort); a.classList.toggle('erreur', !!o.erreur);
    annulerFn = o.annuler || null; $('#annonceAnnuler').hidden = !o.annuler;
    a.hidden = false;
    if (!o.erreur) annonceT = setTimeout(() => { a.hidden = true; }, o.annuler ? 8000 : o.fort ? 7000 : 4000);
  }
  $('#annonceFermer').onclick = () => { $('#annonce').hidden = true; };
  $('#annonceAnnuler').onclick = () => { if (annulerFn) annulerFn(); $('#annonce').hidden = true; };

  /* ---------- Popovers : ancrés sur PC, feuille du bas sur téléphone ---------- */
  let popOuvert = null, popAncre = null;
  function ouvrirPop(id, ancre) {
    if (popOuvert && popOuvert !== id) fermerPop(popOuvert, true);
    const p = document.getElementById(id); p.hidden = false; popOuvert = id; popAncre = ancre || null;
    if (ancre && ancre.setAttribute && ancre.hasAttribute('aria-expanded')) ancre.setAttribute('aria-expanded', 'true');
    if (pc.matches || id === 'popMenu') placer(p, ancre); else { p.style.left = p.style.top = ''; p.style.transformOrigin = ''; }
    const f = p.querySelector('[aria-selected="true"], button:not([data-fermer])') || p; f.focus({ preventScroll: true });
  }
  function placer(p, ancre) {
    if (!ancre) return;
    const r = ancre.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight, vw = innerWidth, vh = innerHeight, id2 = p.id;
    const x = Math.max(8, Math.min(vw - w - 8, id2 === 'popMenu' ? r.left : r.left + r.width / 2 - w / 2));
    const dessous = r.bottom + 4 + h <= vh - 8, y = dessous ? r.bottom + 4 : Math.max(8, r.top - h - 4);
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.transformOrigin = `${Math.round(r.left + r.width / 2 - x)}px ${dessous ? 0 : h}px`;
  }
  function fermerPop(id, sansFocus) {
    const p = document.getElementById(id); if (!p || p.hidden) return;
    p.hidden = true; if (popOuvert === id) popOuvert = null;
    if (id === 'popCase') caseRef = null;
    if (popAncre) { if (popAncre.hasAttribute && popAncre.hasAttribute('aria-expanded')) popAncre.setAttribute('aria-expanded', 'false'); if (!sansFocus && popAncre.isConnected) popAncre.focus({ preventScroll: true }); }
    popAncre = null;
  }
  document.addEventListener('pointerdown', e => {
    if (!popOuvert) return;
    if (e.target.closest('.pop') || (popAncre && popAncre.contains && popAncre.contains(e.target))) return;
    fermerPop(popOuvert, true);
  });
  for (const b of $$('[data-fermer]')) b.onclick = () => fermerPop(b.closest('.pop').id);
  const basculerPopTon = ancre => { if (popOuvert === 'popTon') fermerPop('popTon'); else ouvrirPop('popTon', ancre); };
  for (const id of ['#tonBtn', '#barreTon', '#barreJeu']) $(id).onclick = () => basculerPopTon($(id));
  $('#jeuBtn').onclick = () => basculerPopTon($('#jeuBtn'));
  $('#tpBande').onclick = () => basculerPopTon($('#tpBande'));
  $('#jeuMoins').onclick = $('#popMoins').onclick = () => pasJeu(-1);
  $('#jeuPlus').onclick = $('#popPlus').onclick = () => pasJeu(1);
  $('#popComme').onclick = () => changerJeu(null);
  $('#jeuNotes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { changerJeu(+b.dataset.v); document.querySelector(`#jeuNotes [data-v="${b.dataset.v}"]`).focus({ preventScroll: true }); } });
  $('#tonMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v === 'auto') choisirTonManuelle(null);
    else if (!S.tonManuelle) { const k = tonChant() || hypothese || { tonic: 0, mode: 'maj' }; choisirTonManuelle({ tonic: k.tonic, mode: k.mode }); }
  });
  $('#tonNotes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { const v = b.dataset.v; choisirTonManuelle({ tonic: +v, mode: S.tonManuelle.mode }); document.querySelector(`#tonNotes [data-v="${v}"]`).focus({ preventScroll: true }); } });
  $('#tonQualite').addEventListener('click', e => { const b = e.target.closest('button'); if (b) choisirTonManuelle({ tonic: S.tonManuelle.tonic, mode: b.dataset.v }); });
  $('#redetecter').onclick = () => {
    S.tonManuelle = null; sauver(); m.reprendreTonaliteAuto();
    m.nouveauChant(heure()); fermerPop('popTon'); peindreBarre();
    annoncer('Je réécoute pour trouver la tonalité.', { ic: 'i-boucle' });
  };

  /* Menu : liste maison, jamais de select natif. items : [valeur, nom, marqué]. Sert aussi à Labs. */
  let menuChoix = null;
  function ouvrirMenu(ancre, items, val, surChoix, o = {}) {
    if (popOuvert === 'popMenu' && popAncre === ancre) { fermerPop('popMenu'); return; }
    const p = $('#popMenu'); p.classList.toggle('colonnes', !!o.colonnes); p.setAttribute('aria-label', o.titre || 'Choix');
    p.innerHTML = items.map(([v, n, vu]) => { const on = String(v) === String(val); return `<button role="option" data-v="${echappe(v)}" aria-selected="${on}"${vu ? ' class="vu-ton"' : ''}>${echappe(n)}${on ? '<svg class="ic"><use href="#i-check"/></svg>' : ''}</button>`; }).join('');
    menuChoix = surChoix; ouvrirPop('popMenu', ancre);
  }
  $('#popMenu').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; fermerPop('popMenu'); if (menuChoix) menuChoix(b.dataset.v); });
  $('#popMenu').addEventListener('keydown', e => {
    const l = [...$('#popMenu').querySelectorAll('button')], i = l.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); } else if (e.key === 'Home') { e.preventDefault(); l[0].focus(); } else if (e.key === 'End') { e.preventDefault(); l[l.length - 1].focus(); } else if (e.key.length === 1 && e.key !== ' ') { const c = l.find(b => b.textContent.toLowerCase().startsWith(e.key.toLowerCase())); if (c) c.focus(); }
  });
  function peindreStyle() { $('#styleNom').textContent = STYLES.find(s => s[0] === S.style)[1]; }
  function choisirStyle(v) { S.style = v; sauver(); dejaVus = []; idees = []; peindreStyle(); calculerSuggestions(); peindreSuggestions(); if (S.profondeur === 'enrichi') { redessinerGrille(); peindreMaintenant(); peindreClavier(); melodieSale(true); } }
  $('#styleBtn').onclick = () => ouvrirMenu($('#styleBtn'), STYLES, S.style, choisirStyle, { titre: 'Style' });

  /* Séparateur du clavier : à la souris ou aux flèches. La hauteur reste en mémoire, Labs la partage. */
  function tailleClavier(h) {
    const v = Math.round(Math.max(140, Math.min(innerHeight * .6, h)));
    S.kbH = v; document.documentElement.style.setProperty('--kb-h', v + 'px');
    for (const s of $$('.sep')) s.setAttribute('aria-valuenow', v);
  }
  document.addEventListener('pointerdown', e => {
    const s = e.target.closest && e.target.closest('.sep'); if (!s) return;
    e.preventDefault(); s.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = s.nextElementSibling.offsetHeight, bouge = ev => tailleClavier(h0 - (ev.clientY - y0));
    const fin = () => { s.removeEventListener('pointermove', bouge); s.removeEventListener('pointerup', fin); s.removeEventListener('pointercancel', fin); sauver(); };
    s.addEventListener('pointermove', bouge); s.addEventListener('pointerup', fin); s.addEventListener('pointercancel', fin);
  });
  document.addEventListener('keydown', e => {
    if (!e.target.classList || !e.target.classList.contains('sep') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault(); tailleClavier(e.target.nextElementSibling.offsetHeight + (e.key === 'ArrowUp' ? 16 : -16)); sauver();
  });

  /* ---------- Onglets ---------- */
  function choisirPanneau(p) {
    document.body.dataset.panneau = p;
    for (const b of $$('.f-onglets button')) b.setAttribute('aria-selected', b.dataset.panneau === p);
    $('#grille').hidden = p !== 'grille'; $('#melodie').hidden = p !== 'melodie'; $('#enrichirP').hidden = p !== 'enrichir';
    suivre = true; $('#retourDirect').hidden = true;
    if (p === 'melodie') melodieSale(true); else if (p === 'grille') suivreDirect();
    peindreSuggestions();
  }
  function choisirOnglet(o) {
    document.body.dataset.onglet = o;
    for (const b of $$('.tab,.vue')) b.setAttribute('aria-pressed', b.dataset.onglet === o || (b.classList.contains('vue') && b.dataset.onglet === 'live' && o !== 'labs'));
    if (o === 'grille' || o === 'melodie') choisirPanneau(o);
    const labs = o === 'labs'; $('#labs').hidden = !labs; $('#scene').hidden = labs; peindreBarre(); peindreStatut(); etatFab();
    if (labs) $('#annonce').hidden = true; // un message du Live ne suit pas dans Labs
    if (labs && GP.Labs && GP.Labs.monter && !$('#labsMontage').dataset.monte) { $('#labsMontage').dataset.monte = '1'; GP.Labs.monter($('#labsMontage')); }
    if (!labs) syncBase(); // un chant a pu être supprimé dans Labs
    if (!labs && (o !== 'live' || pc.matches)) melodieSale(true);
    fermerPop(popOuvert || 'popTon', true);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-onglet]:not(body)'); if (b) choisirOnglet(b.dataset.onglet); });
  for (const b of $$('.f-onglets button')) b.onclick = () => choisirPanneau(b.dataset.panneau);
  $('.f-onglets').addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const o = ['grille', 'melodie', 'enrichir'], p = o[(o.indexOf(document.body.dataset.panneau) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; choisirPanneau(p); document.querySelector(`.f-onglets [data-panneau="${p}"]`).focus(); } });
  for (const b of $$('.profondeur button')) b.onclick = () => { S.profondeur = b.dataset.v; sauver(); presser($('.profondeur'), S.profondeur); precV = null; peindreMaintenant(); peindreClavier(); redessinerGrille(); melodieSale(true); };

  /* ---------- Copier, effacer ---------- */
  /* Ce que le musicien lit : la grille du chant reconnu à la place des accords devinés. */
  function grilleAffichee() {
    if (!recoDe.size) return m.grille;
    const g = m.grille.filter(c => !recoDe.has(c.chant));
    for (const r of recoDe.values()) g.push(...r.cases);
    return g.sort((a, b) => a.chant - b.chant);
  }
  function texteGrille() {
    const g = grilleAffichee(); let t = '', ligne = [], av = null;
    const vide = () => { if (ligne.length) { t += (ligne.lettre ? ligne.lettre + ' : ' : '') + ligne.join(' | ') + '\n'; ligne = []; } };
    g.forEach(c => {
      if (!av || av.chant !== c.chant || !memeTon(av.ton, c.ton)) { vide(); t += (t ? '\n' : '') + nomT(c.ton) + (S.jeu != null ? ' (tu joues en ' + nomT(vueDe(c.ton).pk) + ', ' + GP.texteTranspose(c.ton, S.jeu) + ')' : '') + '\n'; } else if (coupureEntre(av, c)) vide();
      ligne.lettre = c.lettre;
      ligne.push(c.deg + ' ' + nomA(c.racine, qAffichee(c), c.ton) + (c.mots ? ' (' + c.mots + ')' : ''));
      av = c;
    });
    vide();
    return t.trim();
  }
  $('#copier').onclick = async () => {
    if (!grilleAffichee().length) { annoncer('Rien à copier pour l\'instant.', { ic: 'i-alert' }); return; }
    const txt = texteGrille(), z = $('#copieTexte');
    try { await navigator.clipboard.writeText(txt); z.hidden = true; annoncer('Grille copiée.', { ic: 'i-check' }); }
    catch (e) { z.value = txt; z.hidden = false; z.select(); annoncer('Copie le texte affiché sous la grille.', { ic: 'i-copy' }); }
  };
  $('#effacer').onclick = () => {
    if (!grilleAffichee().length) return;
    Rec.nouveauChant(); recoDe.clear(); for (const el of recoEls.values()) el.remove(); recoEls.clear(); titres.clear();
    const sauve = m.grille, n = notes.slice(), cp = coupures.slice();
    m.reinit(); notes.length = 0; coupures.length = 0;
    indiceCourant = -1; idees = []; prochain = null; tonEtat = null; hypothese = null;
    peindreBarre(); peindreMaintenant(); peindreEnsuite(); peindreClavier(); peindreSuggestions(); redessinerGrille(); melodieSale(true);
    annoncer('Grille effacée.', { ic: 'i-trash', annuler: () => {
      // shortcut: l'annulation rend les cases, pas l'état interne du moteur ; le chant reprend comme un nouveau chant.
      if (!sauve.length) return; m.grille = sauve; m.nChant = sauve[sauve.length - 1].chant + 1; notes.push(...n); coupures.push(...cp); redessinerGrille(); melodieSale(true);
    } });
  };

  /* ---------- Réglages ---------- */
  const dlg = $('#reglages');
  function presser(box, val) { for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.v === String(val)); }
  function appliquerTheme() {
    if (S.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme;
    const clair = '#ffffff', sombre = '#212121', [a, b] = $$('meta[name=theme-color]');
    a.content = S.theme === 'dark' ? sombre : clair; b.content = S.theme === 'light' ? clair : sombre;
  }
  function synchroReglages() {
    for (const s of $$('.seg[data-reg]')) presser(s, S[s.dataset.reg]);
    presser($('.profondeur'), S.profondeur);
    appliquerTheme();
    $('#basseReelle').checked = S.basseReelle; $('#modulationAuto').checked = S.suitTon; $('#voixTel').checked = S.voixTel; $('#paroles').checked = S.paroles;
    $('#silence').value = S.silence; $('#silenceV').textContent = S.silence + ' s'; $('#volDemo').value = S.volDemo;
    $('#champVoixTel').hidden = !A.telephone();
    peindreMains(); peindreStyle(); peindreStatut();
  }
  for (const b of $$('.act-reglages')) b.onclick = () => { dlg.showModal(); diagnostic(); };
  $('#stNota').onclick = () => { S.notation = S.notation === 'fr' ? 'en' : 'fr'; sauver(); synchroReglages(); changerNotation(); };
  function changerNotation() { toutRepeindre(); if (document.body.dataset.onglet === 'labs' && GP.Labs.repeindre) GP.Labs.repeindre(); }
  $('#fermerReglages').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  for (const s of $$('.seg[data-reg]')) s.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = s.dataset.reg; S[k] = k === 'niveauMg' ? +b.dataset.v : b.dataset.v; sauver(); precV = null; synchroReglages();
    if (k === 'notation') changerNotation(); else if (k === 'niveauMg') peindreClavier(); else if (k === 'sortie') peindreMaintenant();
  });
  $('#basseReelle').onchange = e => {
    S.basseReelle = e.target.checked; m.reglages.basseReelle = S.basseReelle; sauver();
    if (!m.grille.length && !enCours) m.reinit(); else annoncer('Ce réglage s\'appliquera quand la grille sera vide.', { ic: 'i-alert' });
  };
  $('#modulationAuto').onchange = e => { S.suitTon = e.target.checked; m.reglages.modulationAuto = S.suitTon; sauver(); };
  $('#voixTel').onchange = e => { S.voixTel = e.target.checked; sauver(); };
  $('#paroles').onchange = e => { S.paroles = e.target.checked; sauver(); if (S.paroles && A.mode === 'micro') lancerParoles(); else if (!S.paroles) arreterParoles(); };
  $('#silence').oninput = e => { S.silence = +e.target.value; m.reglages.tempsNouveauChant = S.silence; $('#silenceV').textContent = S.silence + ' s'; sauver(); };
  $('#volDemo').oninput = e => { S.volDemo = +e.target.value; sauver(); };

  function diagnostic() {
    const d = A.diagnostic();
    $('#diagTexte').textContent = JSON.stringify({ navigateur: navigator.userAgent, ecran: innerWidth + 'x' + innerHeight, ...d, moteur: { sr: m.sr, tonalite: m.key, etat: m.etat, cases: m.grille.length, plancher: m.plancher }, reconnaissance: { chants: Rec.actifs.length, msDerniereNote: +recoMs.toFixed(2), chant: rc ? rc.titre : null }, reglages: { basseReelle: S.basseReelle, sortie: S.sortie, voixTel: S.voixTel } }, null, 1);
  }
  setInterval(() => { if (dlg.open && $('#diag').open) diagnostic(); }, 1000);
  $('#diag').addEventListener('toggle', diagnostic);
  $('#diagCopier').onclick = async () => {
    diagnostic();
    try { await navigator.clipboard.writeText($('#diagTexte').textContent); annoncer('Diagnostic copié.', { ic: 'i-check' }); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('#diagTexte')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); annoncer('Texte sélectionné : copie-le.', { ic: 'i-copy' }); }
  };

  /* ---------- Raccourcis : les mains restent près du clavier ---------- */
  document.addEventListener('click', e => { if (e.detail) { const b = e.target.closest('button'); if (b && !b.closest('.pop') && !b.closest('dialog')) b.blur(); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && popOuvert) { fermerPop(popOuvert); return; }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || dlg.open || document.body.dataset.onglet === 'labs') return; // ces raccourcis pilotent le Live, invisible depuis Labs
    const cible = e.target.closest && e.target.closest('button,input,textarea,label,summary,a,[role=listbox]');
    if (e.code === 'Space') { if (cible) return; e.preventDefault(); basculerEcoute(); }
    else if (cible && cible.tagName !== 'BUTTON') return;
    else if (e.key === 'n' || e.key === 'N') nouveauChant();
    else if (e.key === 'c' || e.key === 'C') changementTon();
    else if (e.key === 't' || e.key === 'T') taper();
    else if (e.key === 'a' || e.key === 'A') clavier.ecouter();
    else if (e.key === 'm' || e.key === 'M') basculerMains();
    else if (e.key === '1' || e.key === '2' || e.key === '3') {
      // Le choix d'accord passe d'abord, puis celui de la tonalité, puis « Pas ça ? ».
      const zone = ['#nowChoix', '#tonChoix', '#pasCa'].map(z => $(z)).find(z => !z.hidden), x = zone && zone.querySelectorAll('button')[+e.key - 1]; if (x) x.click();
    }
  });
  pc.addEventListener('change', () => { clavier.zoom(!pc.matches); arbreSale(); if (!pc.matches && document.body.dataset.panneau === 'enrichir') choisirPanneau('grille'); fermerPop(popOuvert || 'popTon', true); if (pc.matches && ['grille', 'melodie'].includes(document.body.dataset.onglet)) choisirOnglet('live'); melodieSale(true); });
  if (globalThis.ResizeObserver) new ResizeObserver(() => { if (document.body.dataset.panneau === 'melodie') melodieSale(); }).observe(melEl);

  const echappe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Départ ---------- */
  if (S.kbH) tailleClavier(S.kbH);
  basculerArbre(S.arbre);
  peindreArbre();
  synchroReglages(); peindreBarre(); peindreMaintenant(); peindreEnsuite(); peindreClavier(); peindreSuggestions();
  choisirPanneau('grille');
  syncBase(); peindreReco();
  /* La base de cantiques est facultative et n'attend personne : chargée après la page, ajoutée par lots entre deux notes. */
  addEventListener('load', () => {
    const x = document.createElement('script'); x.src = 'js/base-hymnes.js';
    x.onload = () => { const l = [...(GP.baseHymnes || [])], lot = () => { Rec.ajouterBase(l.splice(0, 40)); if (l.length) setTimeout(lot); }; lot(); };
    document.head.append(x);
  });

  // Accès pour Labs et pour les tests de bout en bout.
  GP.App = { moteur: m, clavier, S, reglages: S, changerJeu, choisirOnglet, choisirPanneau, ouvrirCase, menu: ouvrirMenu, etatFab, reconnaissance: Rec, session: () => ({ grille: grilleAffichee(), tonalite: tonChant(), jeu: S.jeu, notation: S.notation, style: S.style, ...(rc ? { bpm: rc.e.bpm || 60 } : {}) }) };
})();
