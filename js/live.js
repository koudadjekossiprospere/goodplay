/* goodplay simple : Mes chants, la saisie, et le chant en cases (js/chant.js).
   Les accords viennent de la grille écrite. L'oreille (GP.Moteur) ne donne que la tonalité chantée, qui transpose la grille ;
   tout s'affiche dans la tonalité où le pianiste est à l'aise, avec le Transpose à régler sur son piano. */
(function () {
  'use strict';
  const GP = globalThis.GP, C = GP.Chant, A = GP.Audio, mod = GP.mod;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const presser = (g, v) => { for (const b of g.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };

  /* ---------- Les chants et les réglages restent dans ce navigateur ---------- */
  const CLE = 'goodplay.chants', REG = { jeu: 0, notation: 'fr', son: true, idees: true, defile: false };
  function charger() {
    let b = null; try { b = JSON.parse(localStorage.getItem(CLE)); } catch (e) { b = null; }
    if (!b || !Array.isArray(b.chants)) {
      b = { chants: [], reglages: {} };
      // Une seule fois : les chants appris par l'ancien Live passent ici, accords et mélodie, sans paroles.
      try { const l = JSON.parse(localStorage.getItem('goodplay.labs')); for (const ch of (l && l.chants) || []) if (Array.isArray(ch.cases) && ch.cases.length) b.chants.push({ id: ch.id || 'm' + Date.now(), ...C.depuisAncien(ch) }); } catch (e) { /* rien à reprendre */ }
    }
    b.reglages = { ...REG, ...b.reglages };
    return b;
  }
  const B = charger(), R = B.reglages;
  function sauver() {
    try { localStorage.setItem(CLE, JSON.stringify(B)); return true; } catch (e) { annoncer('Impossible de garder tes chants sur cet appareil : le stockage est plein ou bloqué.'); return false; }
  }
  const nomTon = k => GP.nomTonalite(k, R.notation);

  /* ---------- Annonces ---------- */
  let annonceT = null;
  function annoncer(t) { const a = $('#annonce'); a.textContent = t; a.hidden = false; clearTimeout(annonceT); annonceT = setTimeout(() => { a.hidden = true; }, 4000); }

  /* ---------- Écrans ---------- */
  let ecran = 'liste';
  function montrer(e, titre) {
    ecran = e; document.body.dataset.ecran = e;
    $('#ecranListe').hidden = e !== 'liste'; $('#ecranEdition').hidden = e !== 'edition'; $('#ecranChant').hidden = e !== 'chant';
    $('#retour').hidden = e === 'liste'; $('#titre').textContent = titre || 'Mes chants';
    if (e !== 'chant') { arreterDefile(); arreterEcoute(); }
  }
  $('#retour').onclick = () => { if (ecran === 'edition' && brouillon && brouillon.id) ouvrir(brouillon.id); else { peindreListe(); montrer('liste'); } };

  /* ---------- Mes chants ---------- */
  function resume(c) {
    const r = C.lireTexte(c.texte, { mesure: c.mesure }), k = c.ton || C.tonaliteDe(r.lignes), p = r.lignes.flat().map(x => x.paroles.trim()).filter(Boolean).join(' ');
    return { k, p: p.slice(0, 80) };
  }
  function peindreListe() {
    const q = sansAccents($('#cherche').value.trim()), l = B.chants.filter(c => !q || sansAccents(c.titre + ' ' + c.texte).includes(q)).sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
    $('#listeChants').innerHTML = l.map(c => { const r = resume(c); return `<li><button data-id="${esc(c.id)}"><b>${esc(c.titre)}</b><small>${esc(r.p || 'Accords seulement')}</small><span class="s-k">${r.k ? esc(nomTon(r.k)) : ''}</span></button></li>`; }).join('');
    $('#listeVide').hidden = B.chants.length > 0; $('#listeChants').hidden = !l.length;
  }
  $('#cherche').oninput = peindreListe;
  $('#listeChants').onclick = e => { const b = e.target.closest('[data-id]'); if (b) ouvrir(b.dataset.id); };
  $('#ajouter').onclick = () => editer(null);

  $('#exporter').onclick = () => {
    const data = { app: 'goodplay', version: 1, chants: B.chants.map(({ titre, bpm, mesure, ton, texte }) => ({ titre, bpm, mesure, ton: ton || null, texte })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = 'goodplay-chants.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Un fichier importé vient d'ailleurs : chaque chant est vérifié, un doublon exact n'est pas repris.
  $('#importer').onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (err) { annoncer('Ce fichier ne se lit pas : il faut un export de goodplay (.json).'); return; }
    const liste = Array.isArray(data) ? data : data && data.chants;
    if (!Array.isArray(liste)) { annoncer('Ce fichier ne contient pas de chants goodplay.'); return; }
    let n = 0;
    for (const c of liste) {
      if (!c || typeof c.titre !== 'string' || typeof c.texte !== 'string' || !c.titre.trim()) continue;
      if (B.chants.some(x => x.titre === c.titre && x.texte === c.texte)) continue;
      const ton = c.ton && Number.isInteger(c.ton.tonic) && ['maj', 'min'].includes(c.ton.mode) ? { tonic: mod(c.ton.tonic), mode: c.ton.mode } : null;
      B.chants.push({ id: 'm' + Date.now() + '-' + n, titre: c.titre.slice(0, 80), bpm: borneBpm(c.bpm), mesure: [2, 3, 4, 6].includes(c.mesure) ? c.mesure : 4, ton, texte: c.texte.slice(0, 20000) }); n++;
    }
    if (n && sauver()) peindreListe();
    annoncer(n ? `${n} chant${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}.` : 'Aucun nouveau chant dans ce fichier.');
  };
  const borneBpm = v => (Number.isFinite(+v) && +v >= 30 && +v <= 240 ? Math.round(+v) : 72);

  /* ---------- Saisie ---------- */
  let ch = null, brouillon = null;
  function editer(c) {
    brouillon = c ? { ...c } : { id: null, titre: '', bpm: 72, mesure: 4, ton: null, texte: '' };
    $('#fTitre').value = brouillon.titre; $('#fBpm').value = brouillon.bpm; $('#fTexte').value = brouillon.texte;
    presser($('#fMesure'), brouillon.mesure); $('#fSupprimer').hidden = !c; $('#fTitreErr').hidden = true; $('#fTitre').removeAttribute('aria-invalid');
    montrer('edition', c ? 'Modifier le chant' : 'Nouveau chant'); apercu();
    (c ? $('#fTexte') : $('#fTitre')).focus();
  }
  let apT = null;
  function apercu() {
    const r = C.lireTexte($('#fTexte').value, { mesure: brouillon.mesure }), k = brouillon.ton || C.tonaliteDe(r.lignes);
    $('#fTon').textContent = k ? nomTon(k) + (brouillon.ton ? ', choisie' : ', déduite des accords') : 'Pas encore d\'accord';
    $('#fErreurs').textContent = r.erreurs.length ? 'À vérifier : ' + r.erreurs.map(x => `« ${x.texte} » (ligne ${x.ligne})`).join(', ') + '. Exemples d\'accords : Do, Lam, Sol7, Fa/La, Am, Bb.' : '';
    $('#fApercu').innerHTML = k ? casesHTML(r.lignes, { k, decal: 0, jeu: null }) : '';
  }
  $('#fTexte').oninput = () => { clearTimeout(apT); apT = setTimeout(apercu, 150); };
  $('#fMesure').onclick = e => { const b = e.target.closest('button'); if (!b) return; brouillon.mesure = +b.dataset.v; presser($('#fMesure'), brouillon.mesure); apercu(); };
  $('#fTitre').oninput = () => { $('#fTitreErr').hidden = true; $('#fTitre').removeAttribute('aria-invalid'); };
  $('#fTonChanger').onclick = () => ouvrirTon();
  $('#fAnnuler').onclick = () => $('#retour').onclick();
  $('#fSupprimer').onclick = () => {
    const c = B.chants.find(x => x.id === brouillon.id); if (!c || !confirm(`Supprimer « ${c.titre} » ? Il ne pourra pas être récupéré.`)) return;
    B.chants.splice(B.chants.indexOf(c), 1); sauver(); ch = null; peindreListe(); montrer('liste'); annoncer(`« ${c.titre} » est supprimé.`);
  };
  $('#formChant').onsubmit = e => {
    e.preventDefault();
    const titre = $('#fTitre').value.trim();
    if (!titre) { $('#fTitreErr').hidden = false; $('#fTitre').setAttribute('aria-invalid', 'true'); $('#fTitre').focus(); return; }
    Object.assign(brouillon, { titre, bpm: borneBpm($('#fBpm').value), texte: $('#fTexte').value.replace(/\s+$/, '') });
    let c = B.chants.find(x => x.id === brouillon.id);
    if (c) Object.assign(c, brouillon); else { c = { ...brouillon, id: 'm' + Date.now() }; B.chants.push(c); }
    if (sauver()) { ouvrir(c.id); annoncer(`« ${titre} » est enregistré.`); }
  };

  /* Tonalité écrite : déduite, ou choisie quand la déduction se trompe. */
  let tonCible = null;
  function ouvrirTon() {
    const r = C.lireTexte($('#fTexte').value, { mesure: brouillon.mesure }); tonCible = brouillon.ton || C.tonaliteDe(r.lignes) || { tonic: 0, mode: 'maj' };
    peindreTonDlg(); $('#dlgTon').showModal();
  }
  function peindreTonDlg() {
    $('#tonNotes').innerHTML = Array.from({ length: 12 }, (_, i) => `<button data-v="${i}" aria-pressed="${i === tonCible.tonic}">${esc(GP.nomNote(i, tonCible, R.notation))}</button>`).join('');
    presser($('#tonMode'), tonCible.mode);
  }
  $('#tonNotes').onclick = e => { const b = e.target.closest('button'); if (!b) return; tonCible = { ...tonCible, tonic: +b.dataset.v }; brouillon.ton = { ...tonCible }; peindreTonDlg(); apercu(); };
  $('#tonMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; tonCible = { ...tonCible, mode: b.dataset.v }; brouillon.ton = { ...tonCible }; peindreTonDlg(); apercu(); };
  $('#tonAuto').onclick = () => { brouillon.ton = null; $('#dlgTon').close(); apercu(); };

  /* ---------- Le chant ---------- */
  let lignes = [], plat = [], kEcrit = null, cur = -1, decal = 0, manuel = false, entendu = null;
  function relire() {
    const r = C.lireTexte(ch.texte, { mesure: ch.mesure }); lignes = r.lignes; plat = C.aPlat(lignes);
    kEcrit = ch.ton || C.tonaliteDe(lignes) || { tonic: 0, mode: 'maj' };
  }
  function ouvrir(id) {
    ch = B.chants.find(c => c.id === id); if (!ch) return;
    relire(); cur = plat.length ? 0 : -1; decal = 0; manuel = false; entendu = null; prec = null;
    if (m) m.nouveauChant(maintenant()); // la tonalité du chant d'avant ne vaut plus
    montrer('chant', ch.titre); editionCases(false); peindreChant(); $('#cases').scrollTop = 0;
  }
  const kChant = () => C.transposer(kEcrit, decal);
  const vue = () => GP.vue(kChant(), R.jeu);

  /* Ce que le pianiste lit : la tonalité où il joue. Ce qu'on entend (son des accords) : la tonalité chantée, par A.decalage. */
  function nomCase(a, o = { k: kChant(), decal, jeu: R.jeu }) {
    const r = mod(a.racine + o.decal), b = mod(a.basse + o.decal), v = GP.vue(o.k, o.jeu);
    return GP.nomAccord(r, a.q, o.k, o.jeu, R.notation) + (b !== r ? '/' + GP.nomNote(mod(b - v.sh), v.pk, R.notation) : '');
  }
  function degre(a, k = kEcrit) { const rel = mod(a.racine - k.tonic), e = Object.entries(GP.DEGRES[k.mode]).find(([, [r]]) => r === rel); return e ? +e[0] : null; }
  const nomMel = (midi, o) => { const v = GP.vue(o.k, o.jeu), n = GP.nomNote(mod(midi + o.decal - v.sh), v.pk, R.notation); return R.notation === 'fr' ? n.toLowerCase() : n; };
  // o.k : tonalité chantée, o.decal : de l'écrit au chanté, o.jeu : où le pianiste joue.
  function casesHTML(ls, o) {
    let i = 0; const ke = C.transposer(o.k, -o.decal);
    return ls.map(cases => {
      if (!cases.length) return '<div class="s-sep"></div>';
      return '<div class="s-l">' + cases.map(c => {
        const mel = c.melodie.map(([mi]) => `<i>${esc(nomMel(mi, o))}</i>`).join('');
        if (!(c.accord && c.temps > 0)) return `<span class="s-c sans"><b class="s-a${c.nom ? ' faux' : ''}">${esc(c.nom)}</b><span class="s-p">${esc(c.paroles)}</span><span class="s-m">${mel}</span></span>`;
        const d = degre(c.accord, ke);
        return `<button class="s-c" data-i="${i++}" style="--t:${c.temps}"><b class="s-a">${esc(nomCase(c.accord, o))}${d ? `<sup>${d}</sup>` : ''}</b><span class="s-p">${esc(c.paroles)}</span><span class="s-m">${mel}</span><span class="s-temps" aria-hidden="true">${'<i></i>'.repeat(Math.max(1, Math.min(8, Math.round(c.temps))))}</span></button>`;
      }).join('') + '</div>';
    }).join('');
  }

  function peindreChant() {
    const k = kChant(), v = vue();
    A.decalage = v.sh;
    $('#cTon').textContent = nomTon(k);
    $('#cTonEtat').textContent = manuel ? 'réglée à la main' : entendu ? (entendu.etat === 'sure' ? 'entendue, sûre' : 'entendue, probable') : ecoute ? 'j\'écoute' : decal ? '' : 'écrite';
    $('#cJeu').innerHTML = esc(C.texteJeu(k, R.jeu, R.notation)).replace(/(Transpose [+−]\d+)/, '<b>$1</b>') + (decal ? ` <span class="note">Écrit en ${esc(nomTon(kEcrit))}.</span>` : '');
    $('#ecouterBtn').lastElementChild.textContent = ecoute ? 'Arrêter' : 'Écouter';
    $('#changeTon').hidden = !(ecoute && entendu);
    $('#cTempo').hidden = !R.defile; $('#bpmV').textContent = ch.bpm;
    $('#cases').innerHTML = plat.length ? casesHTML(lignes, { k, decal, jeu: R.jeu }) : '<div class="s-vide"><b>Pas encore d\'accord</b><span>Touche Modifier pour écrire les paroles et les accords.</span></div>';
    marquer(false);
  }

  /* La case en cours : toucher, flèches, pédale tourne-page. */
  let prec = null;
  function marquer(defiler = true) {
    for (const b of $$('#cases .s-c[data-i]')) { const i = +b.dataset.i; b.classList.toggle('cour', i === cur); b.classList.toggle('suiv', i === cur + 1); b.setAttribute('aria-current', String(i === cur)); }
    const x = plat[cur], y = plat[cur + 1], o = { k: kChant(), decal, jeu: R.jeu };
    $('#nowAcc').textContent = x ? nomCase(x.c.accord, o) : '';
    const d = x && degre(x.c.accord); $('#nowDeg').textContent = d ? 'degré ' + d : '';
    $('#nowBtn').disabled = !x;
    $('#nextAcc').textContent = y ? nomCase(y.c.accord, o) : x ? 'Fin' : '';
    if (x) { const v = vue(); prec = GP.voicing(mod(x.c.accord.racine + decal - v.sh), x.c.accord.q, { prec, niveau: 0, basse: mod(x.c.accord.basse + decal - v.sh) }); clavier.afficher(prec, { tonalite: v.pk, notation: R.notation }); }
    else clavier.afficher(null, {});
    peindreIdee();
    if (defiler && x) { const b = $(`#cases .s-c[data-i="${cur}"]`); if (b) b.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  }
  function aller(i, o = {}) {
    if (!plat.length) return;
    cur = Math.max(0, Math.min(plat.length - 1, i)); marquer();
    if (o.son && R.son) sonner();
    if (horloge && o.recaler) horloge = { t0: montre(), b0: plat[cur].t0 };
  }
  function sonner() { A.contexte(); A.decalage = vue().sh; clavier.ecouter(); }
  $('#cases').onclick = e => {
    const b = e.target.closest('.s-c[data-i]'); if (!b) return;
    if (enreg) return; // pendant l'enregistrement, l'horloge mène
    if (enEdition) ouvrirCase(+b.dataset.i); else aller(+b.dataset.i, { son: true, recaler: true });
  };
  $('#nowBtn').onclick = () => { if (R.son) sonner(); };
  document.addEventListener('keydown', e => {
    if (ecran !== 'chant' || enreg || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const av = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key), ar = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
    if (!av && !ar) return;
    e.preventDefault(); aller(cur + (av ? 1 : -1), { son: false, recaler: true });
  });

  /* Hauteur du chant : l'oreille, ou le pianiste d'un demi-ton. */
  function pas(d) { decal = ((decal + d + 5) % 12 + 12) % 12 - 5; manuel = true; peindreChant(); }
  $('#cMoins').onclick = () => pas(-1);
  $('#cPlus').onclick = () => pas(1);

  /* ---------- Idées : un passage ou une couleur vers l'accord suivant, dans les règles du catalogue ---------- */
  let idee = null;
  function peindreIdee() {
    idee = null;
    const x = plat[cur], y = plat[cur + 1], d = x && degre(x.c.accord), s = y && degre(y.c.accord);
    if (R.idees && d && s && !enEdition) {
      const [e] = GP.suggestions({ deg: d, suivant: s, mode: kEcrit.mode, style: 'gospel', niveau: 1, dejaVus: [null, null, null, null] });
      if (e) idee = { e, accords: GP.jouerEntree(e, kEcrit) };
    }
    $('#idee').hidden = !idee; if (!idee) return;
    const o = { k: kChant(), decal, jeu: R.jeu };
    $('#ideeAcc').textContent = idee.accords.map(a => nomCase(a, o)).join(' puis ');
    $('#ideeNom').textContent = idee.e.nom + (idee.e.quand.sur == null ? ', sur les derniers temps' : '');
  }
  $('#ideeEcouter').onclick = () => {
    if (!idee) return; A.contexte(); const v = vue(); A.decalage = v.sh;
    A.jouerSuite(idee.accords.map(a => GP.voicing(mod(a.racine + decal - v.sh), a.q, { niveau: 0, basse: mod(a.basse + decal - v.sh) })), { dur: 60 / ch.bpm * Math.max(1, ch.mesure / 2) });
  };
  // Une couleur remplace l'accord de la case ; un passage prend ses derniers temps, la moitié au plus.
  $('#ideeAjouter').onclick = () => {
    if (!idee) return; const x = plat[cur], c = x.c, ac = idee.accords.map(a => ({ racine: a.racine, q: a.q, basse: a.basse }));
    if (idee.e.quand.sur != null) { c.accord = ac[0]; c.nom = ''; }
    else {
      const part = Math.min(c.temps / 2, ac.length), l = lignes[x.l];
      c.temps -= part;
      l.splice(l.indexOf(c) + 1, 0, ...ac.map(a => ({ accord: a, nom: '', temps: part / ac.length, paroles: '', melodie: [] })));
    }
    ecrire(); annoncer(`Ajouté : ${idee ? idee.e.nom : 'l\'idée'}.`);
  };
  /* Les cases modifiées retournent au texte, seule source du chant. */
  function ecrire() { ch.texte = C.texteDe(lignes, { mesure: ch.mesure, notation: R.notation }); sauver(); const c0 = cur; relire(); cur = Math.min(c0, plat.length - 1); peindreChant(); }

  /* ---------- Modifier une case ---------- */
  let enEdition = false, caseEd = null;
  function editionCases(b) { enEdition = b; $('#ecranChant').toggleAttribute('data-edition', b); $('#editerBtn').setAttribute('aria-pressed', String(b)); $('#texteBtn').hidden = $('#chanterBtn').hidden = !b; peindreIdee(); }
  $('#editerBtn').onclick = () => { if (enEdition) { editionCases(false); return; } editionCases(true); annoncer('Touche une case pour la modifier, ou Tout le texte pour le chant entier.'); };
  $('#texteBtn').onclick = () => { if (ch) editer(ch); };
  function ouvrirCase(i) {
    caseEd = plat[i]; const c = caseEd.c;
    $('#kAcc').value = c.accord ? nomEcritCase(c.accord) : c.nom; $('#kPar').value = c.paroles;
    $('#kMel').value = c.melodie.map(([mi]) => nomMel(mi, { k: kEcrit, decal: 0, jeu: null })).join(' ');
    presser($('#kDur'), c.temps / ch.mesure); for (const x of ['kAccErr', 'kMelErr']) $('#' + x).hidden = true;
    $('#dlgCase').showModal(); $('#kAcc').focus();
  }
  const nomEcritCase = a => GP.nomAccord(a.racine, a.q, kEcrit, null, R.notation) + (a.basse !== a.racine ? '/' + GP.nomNote(a.basse, kEcrit, R.notation) : '');
  $('#kDur').onclick = e => { const b = e.target.closest('button'); if (b) presser($('#kDur'), b.dataset.v); };
  function lireCase() {
    const ac = C.lireAccord($('#kAcc').value); $('#kAccErr').hidden = !!ac; if (!ac) { $('#kAcc').focus(); return null; }
    let precM = null; const notes = [];
    for (const mot of $('#kMel').value.trim().split(/\s+/).filter(Boolean)) {
      const n = C.lireNoteMelodie(mot, precM); if (!n) { $('#kMelErr').textContent = `« ${mot} » n'est pas une note. Exemples : sol, la, si♭, do4.`; $('#kMelErr').hidden = false; $('#kMel').focus(); return null; }
      notes.push(n); precM = n.midi;
    }
    $('#kMelErr').hidden = true;
    const p = $('#kDur [aria-pressed="true"]'), temps = (p ? +p.dataset.v : 1) * ch.mesure;
    let t = 0; const libres = notes.filter(n => !n.duree).length, fixe = notes.reduce((s, n) => s + (n.duree || 0), 0);
    const melodie = notes.map(n => { const d = n.duree || Math.max(.25, (temps - fixe) / Math.max(1, libres)), x = [n.midi, +t.toFixed(3), +d.toFixed(3)]; t += d; return x; });
    const par = $('#kPar').value.trim(); // un espace sépare des mots de la case suivante, sauf un mot coupé en deux (Es-)
    return { accord: ac, nom: '', temps, paroles: par && !par.endsWith('-') ? par + ' ' : par, melodie };
  }
  $('#formCase').onsubmit = e => { e.preventDefault(); const n = lireCase(); if (!n) return; Object.assign(caseEd.c, n); $('#dlgCase').close(); ecrire(); };
  $('#kPartager').onclick = () => {
    const n = lireCase(); if (!n) return; Object.assign(caseEd.c, n);
    const c = caseEd.c, l = lignes[caseEd.l], moitie = c.temps / 2; c.temps = moitie;
    l.splice(l.indexOf(c) + 1, 0, { accord: { ...c.accord }, nom: '', temps: moitie, paroles: '', melodie: [] });
    $('#dlgCase').close(); const i = plat.indexOf(caseEd) + 1; ecrire(); ouvrirCase(i);
  };
  $('#kSupprimer').onclick = () => { const l = lignes[caseEd.l]; l.splice(l.indexOf(caseEd.c), 1); $('#dlgCase').close(); ecrire(); };

  /* ---------- Défiler au tempo (option) ---------- */
  let horloge = null, taps = [];
  // L'heure du moteur (celle de l'audio) ; l'affichage a la sienne : un contexte audio suspendu ne doit pas figer le défilement.
  const maintenant = () => (A.ctx ? A.ctx.currentTime : performance.now() / 1000), montre = () => performance.now() / 1000;
  function defiler() {
    if (horloge) { arreterDefile(); return; }
    if (cur < 0) cur = 0; horloge = { t0: montre(), b0: plat[cur] ? plat[cur].t0 : 0 }; peindreDefile(); tic();
  }
  function tic() {
    if (!horloge) return;
    const b = horloge.b0 + (montre() - horloge.t0) * ch.bpm / 60, der = plat[plat.length - 1];
    if (!der || b >= der.t0 + der.c.temps) { arreterDefile(); return; }
    const bas = enreg ? enreg.depart : 0;
    let i = cur; while (i + 1 < plat.length && plat[i + 1].t0 <= b) i++; while (i > bas && plat[i].t0 > b) i--;
    if (i !== cur) { cur = i; marquer(); }
    if (enreg) { const reste = Math.ceil(plat[enreg.depart].t0 - b); if (reste !== enreg.compte) { enreg.compte = reste; annoncer(reste > 0 ? `Chante dans ${reste}` : 'Chante.'); } }
    const pos = b - plat[i].t0, cell = $(`#cases .s-c[data-i="${i}"]`);
    if (cell) { const dots = cell.querySelectorAll('.s-temps i'), k = Math.min(dots.length - 1, Math.floor(pos * dots.length / plat[i].c.temps)); dots.forEach((d, j) => d.classList.toggle('on', j === k)); const ns = cell.querySelectorAll('.s-m i'); plat[i].c.melodie.forEach(([, d0, d], j) => ns[j] && ns[j].classList.toggle('on', pos >= d0 && pos < d0 + d)); }
    setTimeout(tic, 40); // pas requestAnimationFrame : il s'arrête quand la page est cachée, l'horloge doit continuer
  }
  function arreterDefile() {
    const b = horloge && horloge.b0 + (montre() - horloge.t0) * ch.bpm / 60;
    horloge = null; peindreDefile(); for (const x of $$('#cases .on')) x.classList.remove('on');
    if (enreg) finEnregistrement(b);
  }
  function peindreDefile() { const b = $('#defiler'); b.lastElementChild.textContent = horloge ? 'Pause' : 'Démarrer'; b.firstElementChild.firstElementChild.setAttribute('href', horloge ? '#i-stop' : '#i-play'); }
  $('#defiler').onclick = defiler;

  /* ---------- Mélodie chantée : l'horloge défile après une mesure d'entrée, chaque note entendue va dans sa case ---------- */
  let enreg = null, lecture = null; // enreg : { depart, notes: [[midi, temps, duree]], tA0, tM0, compte }
  async function chanterMelodie() {
    if (enreg) { arreterDefile(); return; }
    if (!plat.length) return;
    if (!ecoute) { await ecouter(); if (!ecoute) return; }
    if (horloge) { horloge = null; peindreDefile(); }
    const depart = Math.max(0, cur);
    // Les notes arrivent à l'heure de l'audio, l'horloge suit la montre : on retient les deux à l'instant du départ.
    enreg = { depart, notes: [], tA0: A.ctx.currentTime, tM0: montre(), compte: null };
    horloge = { t0: montre(), b0: plat[depart].t0 - ch.mesure };
    peindreEnreg(); tic();
  }
  function capter(n) {
    if (!enreg || !horloge || n.fin - n.debut < .1) return;
    const tm = enreg.tM0 + (n.debut - enreg.tA0), b = horloge.b0 + (tm - horloge.t0) * ch.bpm / 60;
    enreg.notes.push([Math.round(n.midi), b, (n.fin - n.debut) * ch.bpm / 60]);
  }
  function finEnregistrement(b) {
    const e = enreg; enreg = null; peindreEnreg();
    if (!e || ecran !== 'chant') return; // l'écran a changé : rien n'est gardé
    if (b == null || b < plat[e.depart].t0) { annoncer('Enregistrement annulé.'); return; }
    let jusque = e.depart; while (jusque + 1 < plat.length && plat[jusque + 1].t0 <= b) jusque++;
    const ns = e.notes.filter(([, x]) => x >= plat[e.depart].t0 - .25);
    if (!ns.length) { annoncer('Aucune note entendue. Chante plus près du téléphone, puis refais.'); return; }
    prise = { ...e, notes: ns, jusque };
    $('#melResume').textContent = `${ns.length} note${ns.length > 1 ? 's' : ''} entendue${ns.length > 1 ? 's' : ''}, de la case ${e.depart + 1} à la case ${jusque + 1}. Écoute-la, puis garde-la ou refais-la.`;
    $('#dlgMel').showModal();
  }
  let prise = null;
  function peindreEnreg() { const b = $('#chanterBtn'); b.lastElementChild.textContent = enreg ? 'Arrêter' : 'Chanter la mélodie'; b.setAttribute('aria-pressed', String(!!enreg)); }
  $('#chanterBtn').onclick = chanterMelodie;
  // Écouter la prise : les accords des cases et la mélodie chantée, au tempo du chant, à la hauteur chantée.
  $('#melEcouter').onclick = () => {
    if (!prise) return; if (lecture) lecture.forEach(x => x.arreter());
    A.contexte(); const v = vue(), sh = v.sh, t0 = A.ctx.currentTime + .1, s = 60 / ch.bpm, b0 = plat[prise.depart].t0;
    A.decalage = sh; lecture = [];
    for (let j = prise.depart; j <= prise.jusque; j++) { const x = plat[j], a = x.c.accord, vo = GP.voicing(mod(a.racine + decal - v.sh), a.q, { niveau: 0, basse: mod(a.basse + decal - v.sh) }); lecture.push(A.jouerAccord([...vo.mg, ...vo.md], { quand: t0 + (x.t0 - b0) * s, dur: x.c.temps * s * .95, volume: .2 })); }
    for (const [midi, x, d] of prise.notes) lecture.push(A.jouerAccord([midi - sh], { quand: t0 + Math.max(0, x - b0) * s, dur: Math.max(.15, d * s), volume: .6 }));
  };
  $('#melGarder').onclick = () => {
    if (!prise) return; C.placerMelodie(prise.notes, plat, { depart: prise.depart, jusque: prise.jusque, decal });
    const n = prise.jusque - prise.depart + 1; prise = null; $('#dlgMel').close(); ecrire(); annoncer(`Mélodie gardée sur ${n} case${n > 1 ? 's' : ''}.`);
  };
  $('#melRefaire').onclick = () => { const d = prise && prise.depart; prise = null; $('#dlgMel').close(); if (d != null) { cur = d; marquer(); chanterMelodie(); } };
  $('#dlgMel').addEventListener('close', () => { prise = null; if (lecture) { lecture.forEach(x => x.arreter()); lecture = null; } });
  // Le temps où l'on est reste le même : seule la vitesse change à partir de maintenant.
  const changerBpm = v => { const b = horloge ? horloge.b0 + (montre() - horloge.t0) * ch.bpm / 60 : 0; ch.bpm = borneBpm(v); $('#bpmV').textContent = ch.bpm; sauver(); if (horloge) horloge = { t0: montre(), b0: b }; };
  $('#bpmMoins').onclick = () => changerBpm(ch.bpm - 2);
  $('#bpmPlus').onclick = () => changerBpm(ch.bpm + 2);
  $('#taper').onclick = () => {
    const t = performance.now(); taps = taps.filter(x => t - x < 3000); taps.push(t);
    if (taps.length >= 3) { const d = (taps[taps.length - 1] - taps[Math.max(0, taps.length - 5)]) / (Math.min(taps.length, 5) - 1); changerBpm(60000 / d); }
  };

  /* ---------- La tonalité chantée : l'oreille ne sert qu'à elle ---------- */
  let m = null, ecoute = false;
  async function ecouter() {
    if (ecoute) { arreterEcoute(); peindreChant(); return; }
    try {
      A.contexte();
      if (!m) {
        m = new GP.Moteur({ reglages: { modulationAuto: false } });
        m.on('tonalite', e => { if (manuel || ecran !== 'chant') return; entendu = { tonic: e.tonic, mode: e.mode, etat: e.etat }; decal = C.decalage(kEcrit, entendu); peindreChant(); });
        m.on('note', capter);
      }
      $('#ecouterBtn').setAttribute('aria-busy', 'true');
      await A.micro(m); ecoute = true; manuel = false;
      annoncer('J\'écoute : la grille se transpose dès que la tonalité chantée est trouvée.');
    } catch (e) {
      const n = e && e.name;
      annoncer(n === 'NotFoundError' ? 'Aucun micro détecté.' : n === 'NotAllowedError' || n === 'SecurityError' ? 'Le micro est bloqué : autorise-le depuis la barre d\'adresse.' : 'Le micro ne démarre pas.');
    }
    $('#ecouterBtn').removeAttribute('aria-busy'); peindreChant();
  }
  function arreterEcoute() { if (ecoute) { A.arreter(); ecoute = false; } }
  $('#ecouterBtn').onclick = ecouter;
  $('#changeTon').onclick = () => { if (!m) return; m.changerTonalite(maintenant()); annoncer('Changement de tonalité : j\'écoute la nouvelle.'); };

  /* ---------- Réglages ---------- */
  function peindreReglages() {
    $('#jeuNotes').innerHTML = '<button class="s-tout" data-v="">Comme le chant, sans Transpose</button>' + Array.from({ length: 12 }, (_, i) => `<button data-v="${i}">${esc(GP.nomTonalite({ tonic: i, mode: 'maj' }, R.notation))}</button>`).join('');
    presser($('#jeuNotes'), R.jeu == null ? '' : R.jeu); presser($('#notation'), R.notation);
    $('#rSon').checked = R.son; $('#rIdees').checked = R.idees; $('#rDefile').checked = R.defile;
    $('#sonBtn').setAttribute('aria-pressed', String(R.son));
  }
  const apres = () => { sauver(); peindreReglages(); if (ecran === 'chant') peindreChant(); else if (ecran === 'liste') peindreListe(); };
  $('#reglagesBtn').onclick = () => { peindreReglages(); $('#dlgReglages').showModal(); };
  $('#jeuNotes').onclick = e => { const b = e.target.closest('button'); if (!b) return; R.jeu = b.dataset.v === '' ? null : +b.dataset.v; apres(); };
  $('#notation').onclick = e => { const b = e.target.closest('button'); if (!b) return; R.notation = b.dataset.v; apres(); };
  $('#rSon').onchange = e => { R.son = e.target.checked; apres(); };
  $('#rIdees').onchange = e => { R.idees = e.target.checked; apres(); };
  $('#rDefile').onchange = e => { R.defile = e.target.checked; if (!R.defile) arreterDefile(); apres(); };
  $('#sonBtn').onclick = () => { R.son = !R.son; apres(); annoncer(R.son ? 'Son des accords : un toucher sur un accord le fait sonner.' : 'Son des accords coupé.'); };
  for (const d of $$('dialog')) { d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-fermer]')) d.close(); }); }

  /* ---------- Départ ---------- */
  const clavier = GP.Clavier($('#clavier'), { basse: 36, haut: 84, mains: true, zoom: !matchMedia('(min-width:1024px)').matches });
  peindreReglages(); peindreListe(); montrer('liste');
  GP.Live = { B, ouvrir, editer, etat: () => ({ ecran, cur, decal, entendu, kEcrit, plat: plat.length }) };
})();
