/* goodplay, le studio du pianiste : la Bibliothèque (chants de base, en lecture seule), Mes chants (mes versions et mes chants),
   et le chant en trois modes : Lire, Jouer (micro, tempo, idées), Modifier (accords posés au doigt sur les mots).
   Les accords viennent de la grille écrite (js/chant.js). L'oreille ne donne que la tonalité chantée, qui transpose la grille ;
   tout s'affiche dans la tonalité où le pianiste est à l'aise, avec le Transpose à régler sur son piano. */
(function () {
  'use strict';
  const GP = globalThis.GP, C = GP.Chant, A = GP.Audio, mod = GP.mod;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const presser = (g, v) => { for (const b of g.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
  const choisir = (g, v) => { for (const b of g.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.v === v)); };

  /* ---------- Mes chants et réglages : dans ce navigateur ---------- */
  const CLE = 'goodplay.chants', REG = { jeu: 0, notation: 'fr', son: true, idees: true };
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

  /* Un chant modifié : gardé ici, et envoyé dans le compte si l'on est connecté (un envoi par chant, après une courte pause). */
  const K = GP.Compte || {}, envois = new Map();
  function garder(c) { const ok = sauver(); if (ok) envoyer(c); return ok; }
  function envoyer(c) {
    if (!K.utilisateur || !c || !B.chants.includes(c)) return;
    clearTimeout(envois.get(c.id));
    envois.set(c.id, setTimeout(async () => {
      try { const id = await K.enregistrer(c); if (id !== c.dbId) { c.dbId = id; sauver(); } }
      catch (e) { annoncer('Pas pu enregistrer en ligne (' + (e.message || 'réseau') + ') : il reste gardé sur cet appareil.'); }
    }, 800));
  }

  /* ---------- La Bibliothèque : chants libres de droits, que personne ne modifie ---------- */
  // Plus d'un millier de chants : bibliotheque.json (tests/donnees/publier-bibliotheque.js) se charge à part, la liste se repeint à son arrivée.
  let BASE = [], etatBase = 'charge';
  const chargerBase = fetch('bibliotheque.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(l => { BASE = l.map(e => ({ ...e, base: true })); etatBase = 'ok'; }, () => { etatBase = 'erreur'; });
  let temp = null; // un chant partagé ouvert par un lien, pas encore gardé
  const trouver = id => B.chants.find(c => c.id === id) || BASE.find(c => c.id === id) || (temp && temp.id === id ? temp : null);

  let annonceT = null;
  function annoncer(t) { const a = $('#annonce'); a.textContent = t; a.hidden = false; clearTimeout(annonceT); annonceT = setTimeout(() => { a.hidden = true; }, 4000); }

  /* ---------- Écrans ---------- */
  let ecran = 'liste', onglet = 'biblio', genre = '';
  function montrer(e, titre = '') {
    ecran = e; document.body.dataset.ecran = e;
    for (const [id, v] of [['#ecranListe', 'liste'], ['#ecranEdition', 'edition'], ['#ecranChant', 'chant'], ['#ecranTexte', 'texte']]) $(id).hidden = e !== v;
    $('#retour').hidden = e === 'liste'; $('#titre').hidden = e === 'liste'; $('#titre').textContent = titre; $('#partagerBtn').hidden = e !== 'chant';
    if (e !== 'chant') { arreterDefile(); arreterEcoute(); }
  }
  $('#retour').onclick = () => { if (ecran === 'texte' && ch) ouvrir(ch.id, 'modifier'); else { peindreListe(); montrer('liste'); } };
  $('#onglets').onclick = e => { const b = e.target.closest('[role="tab"]'); if (!b) return; onglet = b.dataset.v; $('#cherche').value = ''; peindreListe(); };
  $('#filtres').onclick = e => { const b = e.target.closest('button'); if (!b) return; genre = b.dataset.v; presser($('#filtres'), genre); peindreListe(); };

  /* ---------- Les listes ---------- */
  const infosCache = new Map();
  function infos(c) {
    const cle = c.id + ':' + c.texte.length; if (infosCache.has(cle)) return infosCache.get(cle);
    const r = C.lireTexte(c.texte, { mesure: c.mesure }), cs = r.lignes.flat();
    const x = { k: c.ton || c.tonalite || C.tonaliteDe(r.lignes), p: cs.map(y => y.paroles.trim()).filter(Boolean).join(' '), mel: cs.some(y => y.melodie.length) };
    infosCache.set(cle, x); return x;
  }
  function peindreListe() {
    choisir($('#onglets'), onglet);
    const biblio = onglet === 'biblio', q = sansAccents($('#cherche').value.trim());
    $('#ajouter').hidden = biblio; $('#filtres').hidden = !biblio; $('#piedMes').hidden = biblio;
    $('#intro').textContent = biblio ? (etatBase === 'charge' ? 'La bibliothèque arrive…' : etatBase === 'erreur' ? 'La bibliothèque ne se charge pas : vérifie la connexion, puis recharge la page.' : `${BASE.length} chants libres de droits, avec leur grille d'accords. Ouvre-en un pour le lire, le jouer, ou en faire ta version.`) : B.chants.length ? 'Tes versions et tes chants. Ils restent dans ce navigateur.' : '';
    const src = biblio ? BASE.filter(c => !genre || c.genre === genre) : B.chants;
    const l = src.filter(c => !q || sansAccents([c.titre, c.auteurs && Object.values(c.auteurs).join(' '), c.texte].join(' ')).includes(q)).sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
    $('#listeChants').innerHTML = l.map(c => {
      const x = infos(c), sous = biblio ? [c.auteurs && (c.auteurs.paroles || c.auteurs.musique), x.p].filter(Boolean)[0] || '' : x.p || 'Accords seulement';
      const badges = [x.p && 'Paroles', x.mel && 'Mélodie', !biblio && c.base && 'Ma version'].filter(Boolean).map(t => `<span class="s-badge">${t}</span>`).join('');
      return `<li><button data-id="${esc(c.id)}"><b>${esc(c.titre)}</b><small>${esc(sous)}</small><span class="s-k">${x.k ? esc(nomTon(x.k)) : ''}<span class="s-badges">${badges}</span></span></button></li>`;
    }).join('');
    $('#listeChants').hidden = !l.length;
    const vide = $('#listeVide'); vide.hidden = !!l.length;
    vide.hidden = vide.hidden || (biblio && etatBase !== 'ok');
    vide.innerHTML = q || genre ? '<b>Aucun chant ne correspond</b><span>Essaie un autre mot.</span>' : biblio ? '<b>La bibliothèque est vide</b>' : '<b>Aucun chant pour l\'instant</b><span>Ouvre un chant de la Bibliothèque et fais ta version, ou crée un nouveau chant.</span>';
  }
  $('#cherche').oninput = peindreListe;
  $('#listeChants').onclick = e => { const b = e.target.closest('[data-id]'); if (b) ouvrir(b.dataset.id, 'lire'); };

  $('#exporter').onclick = () => {
    const data = { app: 'goodplay', version: 1, chants: B.chants.map(({ titre, bpm, mesure, ton, texte, base }) => ({ titre, bpm, mesure, ton: ton || null, texte, base: base || null })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = 'goodplay-chants.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const borneBpm = v => (Number.isFinite(+v) && +v >= 30 && +v <= 240 ? Math.round(+v) : 72);
  const tonValide = t => (t && Number.isInteger(t.tonic) && ['maj', 'min'].includes(t.mode) ? { tonic: mod(t.tonic), mode: t.mode } : null);
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
      B.chants.push({ id: 'm' + Date.now() + '-' + n, titre: c.titre.slice(0, 80), bpm: borneBpm(c.bpm), mesure: [2, 3, 4, 6].includes(c.mesure) ? c.mesure : 4, ton: tonValide(c.ton), texte: c.texte.slice(0, 20000), base: typeof c.base === 'string' ? c.base : null }); n++;
    }
    if (n && sauver()) { peindreListe(); for (const c of B.chants.filter(x => !x.dbId)) envoyer(c); }
    annoncer(n ? `${n} chant${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}.` : 'Aucun nouveau chant dans ce fichier.');
  };

  /* ---------- Nouveau chant : titre, tonalité, paroles ; les accords se posent ensuite au doigt ---------- */
  let brouillon = null;
  $('#ajouter').onclick = () => {
    brouillon = { ton: { tonic: R.jeu ?? 0, mode: 'maj' }, mesure: 4 };
    $('#fTitre').value = ''; $('#fTexte').value = ''; $('#fBpm').value = 72; $('#fTitreErr').hidden = true; $('#fTitre').removeAttribute('aria-invalid');
    peindreTonForm(); presser($('#fMesure'), 4); montrer('edition', 'Nouveau chant'); $('#fTitre').focus();
  };
  function peindreTonForm() {
    $('#fTonNotes').innerHTML = Array.from({ length: 12 }, (_, i) => `<button type="button" data-v="${i}">${esc(GP.nomNote(i, brouillon.ton, R.notation))}</button>`).join('');
    presser($('#fTonNotes'), brouillon.ton.tonic); presser($('#fTonMode'), brouillon.ton.mode);
  }
  $('#fTonNotes').onclick = e => { const b = e.target.closest('button'); if (!b) return; brouillon.ton.tonic = +b.dataset.v; peindreTonForm(); };
  $('#fTonMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; brouillon.ton.mode = b.dataset.v; peindreTonForm(); };
  $('#fMesure').onclick = e => { const b = e.target.closest('button'); if (!b) return; brouillon.mesure = +b.dataset.v; presser($('#fMesure'), brouillon.mesure); };
  $('#fTitre').oninput = () => { $('#fTitreErr').hidden = true; $('#fTitre').removeAttribute('aria-invalid'); };
  $('#fAnnuler').onclick = () => { onglet = 'mes'; peindreListe(); montrer('liste'); };
  $('#formChant').onsubmit = e => {
    e.preventDefault();
    const titre = $('#fTitre').value.trim();
    if (!titre) { $('#fTitreErr').hidden = false; $('#fTitre').setAttribute('aria-invalid', 'true'); $('#fTitre').focus(); return; }
    const c = { id: 'm' + Date.now(), titre, bpm: borneBpm($('#fBpm').value), mesure: brouillon.mesure, ton: { ...brouillon.ton }, texte: $('#fTexte').value.replace(/\s+$/, ''), base: null };
    B.chants.push(c);
    if (garder(c)) { onglet = 'mes'; ouvrir(c.id, 'modifier'); annoncer('Touche un mot pour y poser son accord.'); }
  };

  /* ---------- Le chant ---------- */
  let ch = null, estBase = false, lignes = [], plat = [], kEcrit = null, cur = -1, decal = 0, manuel = false, entendu = null, mode = 'lire', prec = null;
  function relire() {
    const r = C.lireTexte(ch.texte, { mesure: ch.mesure }); lignes = r.lignes; plat = C.aPlat(lignes);
    kEcrit = ch.ton || ch.tonalite || C.tonaliteDe(lignes) || { tonic: 0, mode: 'maj' };
  }
  function ouvrir(id, m = 'lire') {
    ch = trouver(id); if (!ch) return;
    estBase = (!!ch.base && BASE.includes(ch)) || !!ch.partage; // la Bibliothèque et un partage pas encore gardé se lisent sans se modifier
    relire(); cur = plat.length ? 0 : -1; decal = 0; manuel = false; entendu = null; prec = null;
    if (oreille) oreille.nouveauChant(maintenant()); // la tonalité du chant d'avant ne vaut plus
    montrer('chant', ch.titre); choisirMode(m); $('#cases').scrollTop = 0;
  }
  function choisirMode(v) {
    mode = v; $('#ecranChant').dataset.mode = v; choisir($('#modes'), v);
    $('#outilsJouer').hidden = v !== 'jouer'; $('#outilsModif').hidden = v !== 'modifier'; $('#now').hidden = v !== 'jouer';
    if (v !== 'jouer') arreterDefile();
    peindreChant();
  }
  $('#modes').onclick = e => { const b = e.target.closest('[role="tab"]'); if (b) choisirMode(b.dataset.v); };
  const kChant = () => C.transposer(kEcrit, decal);
  const vue = () => GP.vue(kChant(), R.jeu);

  /* Ce que le pianiste lit : la tonalité où il joue. Ce qu'on entend (son des accords) : la tonalité chantée, par A.decalage. */
  function nomCase(a, o = { k: kChant(), decal, jeu: R.jeu }) {
    const r = mod(a.racine + o.decal), b = mod(a.basse + o.decal), v = GP.vue(o.k, o.jeu);
    return GP.nomAccord(r, a.q, o.k, o.jeu, R.notation) + (b !== r ? '/' + GP.nomNote(mod(b - v.sh), v.pk, R.notation) : '');
  }
  function degre(a, k = kEcrit) { const rel = mod(a.racine - k.tonic), e = Object.entries(GP.DEGRES[k.mode]).find(([, [r]]) => r === rel); return e ? +e[0] : null; }
  const nomMel = (midi, o) => { const v = GP.vue(o.k, o.jeu), n = GP.nomNote(mod(midi + o.decal - v.sh), v.pk, R.notation); return R.notation === 'fr' ? n.toLowerCase() : n; };
  const motsHTML = p => { let off = 0; return p.split(/(\s+)/).map(t => { const s = /^\s*$/.test(t) ? esc(t) : `<button class="s-mot" data-off="${off}">${esc(t)}</button>`; off += t.length; return s; }).join(''); };
  // En Lire et Jouer, une case d'accord se touche toute entière ; en Modifier, ce sont ses mots et son accord.
  function casesHTML(ls, o, modif) {
    let i = 0; const ke = C.transposer(o.k, -o.decal);
    return ls.map((cases, l) => {
      if (!cases.length) return '<div class="s-sep"></div>';
      return '<div class="s-l">' + cases.map((c, j) => {
        const mel = c.melodie.map(([mi]) => `<i>${esc(nomMel(mi, o))}</i>`).join(''), joue = c.accord && c.temps > 0, d = joue && degre(c.accord, ke);
        const nom = joue ? esc(nomCase(c.accord, o)) + (d ? `<sup>${d}</sup>` : '') : esc(c.nom), temps = joue ? `<span class="s-temps" aria-hidden="true">${'<i></i>'.repeat(Math.max(1, Math.min(8, Math.round(c.temps))))}</span>` : '';
        if (modif) return `<div class="s-c${joue ? '' : ' sans'}" data-l="${l}" data-c="${j}"${joue ? ` data-i="${i++}" style="--t:${c.temps}"` : ''}><button class="s-a s-a-btn${joue ? '' : ' vide'}${c.nom && !c.accord ? ' faux' : ''}" data-off="0">${nom || '+ accord'}</button><span class="s-p">${motsHTML(c.paroles)}</span><span class="s-m">${mel}</span>${temps}</div>`;
        if (!joue) return `<span class="s-c sans"><b class="s-a${c.nom ? ' faux' : ''}">${nom}</b><span class="s-p">${esc(c.paroles)}</span><span class="s-m">${mel}</span></span>`;
        return `<button class="s-c" data-i="${i++}" style="--t:${c.temps}"><b class="s-a">${nom}</b><span class="s-p">${esc(c.paroles)}</span><span class="s-m">${mel}</span>${temps}</button>`;
      }).join('') + '</div>';
    }).join('');
  }

  function peindreChant() {
    const k = kChant(), v = vue(), modif = mode === 'modifier';
    A.decalage = v.sh;
    $('#tonNom').textContent = nomTon(k);
    $('#tonEtat').textContent = manuel ? 'réglée à la main' : entendu ? (entendu.etat === 'sure' ? 'entendue, sûre' : 'entendue, probable') : ecoute ? 'j\'écoute…' : decal ? '' : 'écrite';
    $('#jeuNom').textContent = R.jeu == null ? 'Comme le chant' : nomTon({ tonic: R.jeu, mode: 'maj' });
    const tr = v.sh === 0 ? 'Sans Transpose' : `Transpose ${v.sh > 0 ? '+' : '−'}${Math.abs(v.sh)}`;
    $('#transpose').textContent = R.jeu != null && k.mode === 'min' ? `${tr}, en ${nomTon(v.pk)}` : tr;
    $('#ecouterBtn').lastElementChild.textContent = ecoute ? 'Arrêter le micro' : 'Tonalité au micro';
    $('#changeTon').hidden = !(ecoute && entendu); $('#bpmV').textContent = ch.bpm;
    $('#aideModif').innerHTML = ch.partage ? '<b>Chant partagé avec toi.</b> Garde-le dans Mes chants pour le modifier à ta guise.' : estBase ? '<b>Chant de la Bibliothèque :</b> il ne se modifie pas. Fais ta version, elle ira dans Mes chants.' : 'Touche un <b>mot</b> pour y poser un accord, ou un <b>accord</b> pour le changer. Les accords s\'écrivent dans ta tonalité.';
    $('#versionBtn').hidden = !estBase; $('#versionBtn').lastChild.textContent = ch.partage ? 'Garder dans Mes chants' : 'Faire ma version'; for (const id of ['#chanterBtn', '#texteBtn', '#supprimerBtn']) $(id).hidden = estBase;
    $('#cases').innerHTML = plat.length || modif ? casesHTML(lignes, { k, decal, jeu: R.jeu }, modif && !estBase) : '<div class="s-vide"><b>Pas encore d\'accord</b><span>Passe en mode Modifier pour poser les accords.</span></div>';
    if (modif && !lignes.length) $('#cases').innerHTML = '<div class="s-vide"><b>Pas encore de paroles</b><span>Écris-les dans le Texte complet.</span></div>';
    marquer(false);
  }

  /* La case en cours : toucher, flèches, pédale tourne-page. */
  function marquer(defiler = true) {
    for (const b of $$('#cases .s-c[data-i]')) { const i = +b.dataset.i; b.classList.toggle('cour', i === cur); b.classList.toggle('suiv', i === cur + 1); }
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
    if (enreg) return; // pendant l'enregistrement, l'horloge mène
    if (mode === 'modifier') {
      if (estBase) { annoncer('Fais ta version pour modifier ce chant.'); return; }
      const t = e.target.closest('.s-mot,.s-a-btn'), cell = e.target.closest('.s-c[data-l]'); if (!t || !cell) return;
      ouvrirAccord(+cell.dataset.l, +cell.dataset.c, +t.dataset.off, t.classList.contains('s-mot') ? t.textContent : null);
      return;
    }
    const b = e.target.closest('.s-c[data-i]'); if (b) aller(+b.dataset.i, { son: true, recaler: true });
  };
  $('#nowBtn').onclick = () => { if (R.son) sonner(); };
  document.addEventListener('keydown', e => {
    if (ecran !== 'chant' || mode === 'modifier' || enreg || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const av = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key), ar = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
    if (!av && !ar) return;
    e.preventDefault(); aller(cur + (av ? 1 : -1), { son: false, recaler: true });
  });

  /* ---------- Poser, changer, retirer un accord ---------- */
  let cible = null, choixAccord = null;
  function ouvrirAccord(l, c, off, mot) {
    const cell = lignes[l][c], existe = off === 0 && cell.accord && cell.temps > 0;
    cible = { l, c, off, existe }; choixAccord = existe ? cell.accord : null;
    $('#accT').textContent = existe ? 'Changer l\'accord' : mot ? `Accord sur « ${mot.replace(/[,.;:!?]+$/, '')} »` : 'Poser un accord';
    peindrePalette();
    $('#aAutre').value = ''; $('#aAutreErr').hidden = true; $('#aMelErr').hidden = true;
    presser($('#aDur'), existe ? cell.temps / ch.mesure : 1);
    $('#aPlus').hidden = !existe; $('#aPlus').open = false; $('#aRetirer').hidden = !existe;
    if (existe) { $('#aPar').value = cell.paroles.trim(); $('#aMel').value = cell.melodie.map(([mi]) => nomMel(mi, { k: kChant(), decal, jeu: R.jeu })).join(' '); }
    $('#dlgAccord').showModal();
  }
  /* La palette : les accords de la tonalité où le pianiste joue, avec leur degré. Ils retournent à l'écrit au moment de les poser. */
  function peindrePalette() {
    const v = vue(), pk = v.pk, degs = GP.SIX[pk.mode].map(d => ({ d, a: GP.accordDeDegre(pk, d) }));
    degs.splice(degs.findIndex(x => x.d === 5) + 1, 0, { d: 5, a: { racine: mod(pk.tonic + 7), q: '7', basse: mod(pk.tonic + 7) } });
    const ecrit = a => ({ racine: mod(a.racine + v.sh - decal), q: a.q, basse: mod(a.basse + v.sh - decal) }), meme = (a, b) => a && b && a.racine === b.racine && a.q === b.q && a.basse === b.basse;
    $('#palette').innerHTML = degs.map(({ d, a }) => { const w = ecrit(a); return `<button type="button" data-r="${w.racine}" data-q="${a.q}" data-b="${w.basse}" aria-pressed="${!!meme(w, choixAccord)}">${esc(nomCase(w))}<small>degré ${d}</small></button>`; }).join('');
  }
  $('#palette').onclick = e => { const b = e.target.closest('button'); if (!b) return; poser({ racine: +b.dataset.r, q: b.dataset.q, basse: +b.dataset.b }); };
  $('#aDur').onclick = e => { const b = e.target.closest('button'); if (b) presser($('#aDur'), b.dataset.v); };
  $('#aAutre').oninput = () => { $('#aAutreErr').hidden = true; };
  $('#formAccord').onsubmit = e => {
    e.preventDefault();
    const t = $('#aAutre').value.trim();
    if (t) { const a = C.lireAccord(t); if (!a) { $('#aAutreErr').hidden = false; $('#aAutre').focus(); return; } const v = vue(); poser({ racine: mod(a.racine + v.sh - decal), q: a.q, basse: mod(a.basse + v.sh - decal) }); return; }
    if (choixAccord) poser(choixAccord); else $('#dlgAccord').close();
  };
  function poser(accord) {
    const cases = lignes[cible.l], p = $('#aDur [aria-pressed="true"]'), temps = (p ? +p.dataset.v : 1) * ch.mesure;
    const i = cible.existe ? cible.c : C.poserAccord(cases, cible.c, cible.off, accord, ch.mesure), c = cases[i];
    c.accord = accord; c.nom = ''; c.temps = temps;
    if (cible.existe && $('#aPlus').open) {
      const mel = lireMelodie($('#aMel').value, temps); if (!mel) return;
      const par = $('#aPar').value.trim(); c.paroles = par && !par.endsWith('-') ? par + ' ' : par; c.melodie = mel;
    }
    $('#dlgAccord').close(); ecrire();
    if (R.son) { const x = plat.findIndex(y => y.c === lignes[cible.l][i]); if (x >= 0) { cur = x; marquer(false); sonner(); } }
  }
  // La mélodie tapée est dans la tonalité où le pianiste joue : elle revient à l'écrit.
  function lireMelodie(texte, temps) {
    let precM = null; const notes = [], v = vue();
    for (const mot of texte.trim().split(/\s+/).filter(Boolean)) {
      const n = C.lireNoteMelodie(mot, precM); if (!n) { $('#aMelErr').textContent = `« ${mot} » n'est pas une note. Exemples : sol, la, si♭, do4.`; $('#aMelErr').hidden = false; $('#aMel').focus(); return null; }
      notes.push(n); precM = n.midi;
    }
    const libres = notes.filter(n => !n.duree).length, fixe = notes.reduce((s, n) => s + (n.duree || 0), 0); let t = 0;
    return notes.map(n => { const d = n.duree || Math.max(.25, (temps - fixe) / Math.max(1, libres)), x = [n.midi + v.sh - decal, +t.toFixed(3), +d.toFixed(3)]; t += d; return x; });
  }
  $('#aRetirer').onclick = () => { C.retirerAccord(lignes[cible.l], cible.c); $('#dlgAccord').close(); ecrire(); };
  /* Les cases modifiées retournent au texte, seule source du chant. */
  function ecrire() { ch.texte = C.texteDe(lignes, { mesure: ch.mesure, notation: R.notation }); garder(ch); const c0 = cur; relire(); cur = Math.max(0, Math.min(c0, plat.length - 1)); peindreChant(); }

  /* ---------- Faire ma version, texte complet, supprimer ---------- */
  $('#versionBtn').onclick = () => {
    if (ch.partage) { const g = { id: 'm' + Date.now(), titre: ch.titre, bpm: ch.bpm, mesure: ch.mesure, ton: ch.ton || { ...kEcrit }, texte: ch.texte, base: ch.base_id || null }; temp = null; B.chants.push(g); if (garder(g)) { onglet = 'mes'; ouvrir(g.id, 'modifier'); annoncer('Le chant est dans Mes chants : il est à toi, modifie-le à ta guise.'); } return; }
    const deja = B.chants.find(c => c.base === ch.id);
    if (deja) { ouvrir(deja.id, 'modifier'); annoncer('Tu as déjà ta version de ce chant : la voici.'); return; }
    const v = { id: 'm' + Date.now(), titre: ch.titre, bpm: ch.bpm, mesure: ch.mesure, ton: { ...kEcrit }, texte: ch.texte, base: ch.id };
    B.chants.push(v); if (garder(v)) { onglet = 'mes'; ouvrir(v.id, 'modifier'); annoncer('Ta version est dans Mes chants. Modifie-la à ta guise.'); }
  };
  $('#texteBtn').onclick = () => { $('#tTitre').value = ch.titre; $('#tTexte').value = ch.texte; verifierTexte(); montrer('texte', ch.titre); };
  function verifierTexte() { const r = C.lireTexte($('#tTexte').value, { mesure: ch.mesure }); $('#tErreurs').textContent = r.erreurs.length ? 'À vérifier : ' + r.erreurs.map(x => `« ${x.texte} » (ligne ${x.ligne})`).join(', ') + '.' : ''; }
  let vtT = null; $('#tTexte').oninput = () => { clearTimeout(vtT); vtT = setTimeout(verifierTexte, 200); };
  $('#tAnnuler').onclick = () => ouvrir(ch.id, 'modifier');
  $('#formTexte').onsubmit = e => { e.preventDefault(); ch.titre = $('#tTitre').value.trim() || ch.titre; ch.texte = $('#tTexte').value.replace(/\s+$/, ''); if (garder(ch)) ouvrir(ch.id, 'modifier'); };
  $('#supprimerBtn').onclick = () => {
    if (!confirm(`Supprimer « ${ch.titre} » ? Il ne pourra pas être récupéré.`)) return;
    if (K.utilisateur && ch.dbId) K.supprimer(ch).catch(e => annoncer('Pas pu le retirer en ligne : ' + (e.message || 'réseau')));
    B.chants.splice(B.chants.indexOf(ch), 1); sauver(); const t = ch.titre; ch = null; onglet = 'mes'; peindreListe(); montrer('liste'); annoncer(`« ${t} » est supprimé.`);
  };

  /* ---------- Tonalité du chant, et celle où je joue ---------- */
  function pas(d) { decal = ((decal + d + 5) % 12 + 12) % 12 - 5; manuel = true; peindreChant(); peindreTonDlg(); }
  function peindreTonDlg() {
    $('#tonResume').textContent = `Écrite en ${nomTon(kEcrit)}.` + (entendu ? ` Entendue en ${nomTon(entendu)} (${entendu.etat === 'sure' ? 'sûre' : 'probable'}).` : '') + (decal ? ` Jouée ${decal > 0 ? '+' : '−'}${Math.abs(decal)} demi-ton${Math.abs(decal) > 1 ? 's' : ''} par rapport à l'écrit : ${nomTon(kChant())}.` : '');
  }
  $('#tonBtn').onclick = () => { peindreTonDlg(); $('#dlgTon').showModal(); };
  $('#tonMoins').onclick = () => pas(-1);
  $('#tonPlus').onclick = () => pas(1);
  $('#tonEcrite').onclick = () => { decal = 0; manuel = false; entendu = null; peindreChant(); $('#dlgTon').close(); };
  $('#tonMicro').onclick = () => { $('#dlgTon').close(); if (!ecoute) ecouter(); };
  function peindreJeu() {
    $('#jeuNotes').innerHTML = '<button class="s-tout" data-v="">Comme le chant, sans Transpose</button>' + Array.from({ length: 12 }, (_, i) => `<button data-v="${i}">${esc(nomTon({ tonic: i, mode: 'maj' }))}</button>`).join('');
    presser($('#jeuNotes'), R.jeu == null ? '' : R.jeu);
  }
  $('#jeuBtn').onclick = () => { peindreJeu(); $('#dlgJeu').showModal(); };
  $('#jeuNotes').onclick = e => { const b = e.target.closest('button'); if (!b) return; R.jeu = b.dataset.v === '' ? null : +b.dataset.v; sauver(); $('#dlgJeu').close(); peindreChant(); };

  /* ---------- Idées (mode Jouer) : un passage ou une couleur vers l'accord suivant, dans les règles du catalogue ---------- */
  let idee = null;
  function peindreIdee() {
    idee = null;
    const x = plat[cur], y = plat[cur + 1], d = x && degre(x.c.accord), s = y && degre(y.c.accord);
    if (mode === 'jouer' && R.idees && d && s) {
      const [e] = GP.suggestions({ deg: d, suivant: s, mode: kEcrit.mode, style: 'gospel', niveau: 1, dejaVus: [null, null, null, null] });
      if (e) idee = { e, accords: GP.jouerEntree(e, kEcrit) };
    }
    $('#idee').hidden = !idee; if (!idee) return;
    const o = { k: kChant(), decal, jeu: R.jeu };
    $('#ideeAcc').textContent = idee.accords.map(a => nomCase(a, o)).join(' puis ');
    $('#ideeNom').textContent = idee.e.nom + (idee.e.quand.sur == null ? ', sur les derniers temps' : '');
    $('#ideeAjouter').hidden = estBase;
  }
  $('#ideeEcouter').onclick = () => {
    if (!idee) return; A.contexte(); const v = vue(); A.decalage = v.sh;
    A.jouerSuite(idee.accords.map(a => GP.voicing(mod(a.racine + decal - v.sh), a.q, { niveau: 0, basse: mod(a.basse + decal - v.sh) })), { dur: 60 / ch.bpm * Math.max(1, ch.mesure / 2) });
  };
  // Une couleur remplace l'accord de la case ; un passage prend ses derniers temps, la moitié au plus.
  $('#ideeAjouter').onclick = () => {
    if (!idee || estBase) return; const x = plat[cur], c = x.c, ac = idee.accords.map(a => ({ racine: a.racine, q: a.q, basse: a.basse })), nom = idee.e.nom;
    if (idee.e.quand.sur != null) { c.accord = ac[0]; c.nom = ''; }
    else { const part = Math.min(c.temps / 2, ac.length), l = lignes[x.l]; c.temps -= part; l.splice(l.indexOf(c) + 1, 0, ...ac.map(a => ({ accord: a, nom: '', temps: part / ac.length, paroles: '', melodie: [] }))); }
    ecrire(); annoncer(`Ajouté : ${nom}.`);
  };

  /* ---------- Défiler au tempo (mode Jouer) ---------- */
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
  function peindreDefile() { const b = $('#defiler'); b.lastElementChild.textContent = horloge ? 'Pause' : 'Défiler'; b.firstElementChild.firstElementChild.setAttribute('href', horloge ? '#i-stop' : '#i-play'); }
  $('#defiler').onclick = defiler;
  // Le temps où l'on est reste le même : seule la vitesse change à partir de maintenant.
  const changerBpm = v => { const b = horloge ? horloge.b0 + (montre() - horloge.t0) * ch.bpm / 60 : 0; ch.bpm = borneBpm(v); $('#bpmV').textContent = ch.bpm; if (!estBase) garder(ch); if (horloge) horloge = { t0: montre(), b0: b }; };
  $('#bpmMoins').onclick = () => changerBpm(ch.bpm - 2);
  $('#bpmPlus').onclick = () => changerBpm(ch.bpm + 2);
  $('#taper').onclick = () => {
    const t = performance.now(); taps = taps.filter(x => t - x < 3000); taps.push(t);
    if (taps.length >= 3) { const d = (taps[taps.length - 1] - taps[Math.max(0, taps.length - 5)]) / (Math.min(taps.length, 5) - 1); changerBpm(60000 / d); }
  };

  /* ---------- Mélodie chantée (mode Modifier) : une mesure d'entrée, puis chaque note entendue va dans sa case ---------- */
  let enreg = null, lecture = null, prise = null; // enreg : { depart, notes: [[midi, temps, duree]], tA0, tM0, compte }
  async function chanterMelodie() {
    if (enreg) { arreterDefile(); return; }
    if (!plat.length) { annoncer('Pose d\'abord les accords : la mélodie se range case par case.'); return; }
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

  /* ---------- La tonalité chantée : l'oreille ne sert qu'à elle (et à la mélodie chantée) ---------- */
  let oreille = null, ecoute = false;
  async function ecouter() {
    if (ecoute) { arreterEcoute(); peindreChant(); return; }
    try {
      A.contexte();
      if (!oreille) {
        oreille = new GP.Moteur({ reglages: { modulationAuto: false } });
        oreille.on('tonalite', e => { if (manuel || ecran !== 'chant') return; entendu = { tonic: e.tonic, mode: e.mode, etat: e.etat }; decal = C.decalage(kEcrit, entendu); peindreChant(); });
        oreille.on('note', capter);
      }
      $('#ecouterBtn').setAttribute('aria-busy', 'true');
      await A.micro(oreille); ecoute = true; manuel = false;
      annoncer('J\'écoute : la grille se transpose dès que la tonalité chantée est trouvée.');
    } catch (e) {
      const n = e && e.name;
      annoncer(n === 'NotFoundError' ? 'Aucun micro détecté.' : n === 'NotAllowedError' || n === 'SecurityError' ? 'Le micro est bloqué : autorise-le depuis la barre d\'adresse.' : 'Le micro ne démarre pas.');
    }
    $('#ecouterBtn').removeAttribute('aria-busy'); if (ecran === 'chant') peindreChant();
  }
  function arreterEcoute() { if (ecoute) { A.arreter(); ecoute = false; } }
  $('#ecouterBtn').onclick = ecouter;
  $('#changeTon').onclick = () => { if (!oreille) return; oreille.changerTonalite(maintenant()); annoncer('Changement de tonalité : j\'écoute la nouvelle.'); };

  /* ---------- Réglages ---------- */
  function peindreReglages() { presser($('#notation'), R.notation); $('#rSon').checked = R.son; $('#rIdees').checked = R.idees; }
  const apres = () => { sauver(); peindreReglages(); if (ecran === 'chant') peindreChant(); else if (ecran === 'liste') peindreListe(); };
  $('#reglagesBtn').onclick = () => { peindreReglages(); $('#dlgReglages').showModal(); };
  $('#notation').onclick = e => { const b = e.target.closest('button'); if (!b) return; R.notation = b.dataset.v; apres(); };
  $('#rSon').onchange = e => { R.son = e.target.checked; apres(); };
  $('#rIdees').onchange = e => { R.idees = e.target.checked; apres(); };
  for (const d of $$('dialog')) d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-fermer]')) d.close(); });

  /* ---------- Compte : mes chants en ligne, partage par lien ---------- */
  // shortcut: à la connexion, la version en ligne d'un chant l'emporte sur celle de l'appareil ; à revoir si l'on travaille hors ligne sur deux appareils.
  async function synchroniser() {
    try {
      for (const t of await K.travaux()) {
        const loc = B.chants.find(c => c.dbId === t.id), data = { titre: t.titre, texte: t.texte, ton: t.ton, mesure: t.mesure, bpm: t.bpm, base: t.base_id, dbId: t.id };
        if (loc) Object.assign(loc, data); else B.chants.push({ id: 'm' + t.id, ...data });
      }
      sauver(); for (const c of B.chants.filter(c => !c.dbId)) envoyer(c); // les chants faits avant de se connecter montent dans le compte
      if (ecran === 'liste') peindreListe();
    } catch (e) { annoncer('Tes chants en ligne ne se chargent pas (' + (e.message || 'réseau') + ').'); }
  }
  function peindreCompte() {
    const b = $('#compteBtn'); b.hidden = !K.configure;
    b.firstElementChild.textContent = K.utilisateur ? (K.nom().split(' ')[0] || 'Mon compte') : 'Se connecter';
    b.title = K.utilisateur ? 'Connecté : ' + K.nom() + '. Toucher pour se déconnecter.' : 'Se connecter avec Google pour retrouver tes chants partout et les partager';
  }
  $('#compteBtn').onclick = async () => {
    try {
      if (!K.utilisateur) { await K.connecter(); return; }
      if (!confirm('Se déconnecter ? Tes chants restent dans ton compte.')) return;
      await K.deconnecter();
    } catch (e) { annoncer('La connexion ne répond pas (' + (e.message || 'réseau') + ').'); }
  };
  if (K.configure) K.on(u => {
    if (u) { annoncer('Connecté : tes chants se gardent dans ton compte.'); synchroniser(); }
    else { B.chants = B.chants.filter(c => !c.dbId); sauver(); annoncer('Déconnecté.'); if (ecran === 'chant' && ch && !trouver(ch.id)) montrer('liste'); }
    peindreCompte(); if (ecran === 'liste') peindreListe();
  });
  // Partager : un chant de la Bibliothèque par son adresse ; un des miens par une copie figée en ligne, lisible par qui a le lien.
  $('#partagerBtn').onclick = async () => {
    if (!ch) return;
    let url = location.origin + location.pathname;
    try {
      if (BASE.includes(ch)) url += '?chant=' + encodeURIComponent(ch.id);
      else if (ch.partage) url += '?partage=' + encodeURIComponent(ch.jeton);
      else if (!K.configure) { annoncer('Le partage par lien arrive avec les comptes. En attendant : Exporter mes chants.'); return; }
      else if (!K.utilisateur) { annoncer('Connecte-toi pour partager tes chants.'); return; }
      else url += '?partage=' + encodeURIComponent(await K.partager(ch));
    } catch (e) { annoncer('Le partage ne répond pas (' + (e.message || 'réseau') + ').'); return; }
    if (navigator.share) { try { await navigator.share({ title: ch.titre, url }); return; } catch (e) { /* partage annulé : on copie */ } }
    try { await navigator.clipboard.writeText(url); annoncer('Lien copié : envoie-le à qui tu veux.'); } catch (e) { prompt('Copie ce lien :', url); }
  };
  // Un lien reçu : ?chant= ouvre un chant de la Bibliothèque, ?partage= charge la copie partagée, à garder dans Mes chants.
  async function lienRecu() {
    const p = new URLSearchParams(location.search), id = p.get('chant'), j = p.get('partage');
    if (!id && !j) return;
    history.replaceState(null, '', location.pathname);
    if (id) { if (trouver(id)) ouvrir(id, 'lire'); else annoncer("Ce chant n'existe plus dans la Bibliothèque."); return; }
    if (!K.configure) { annoncer('Ce lien de partage demande les comptes goodplay.'); return; }
    try {
      const d = await K.lirePartage(j); if (!d) { annoncer("Ce partage n'existe plus."); return; }
      temp = { id: 'p' + j, jeton: j, partage: true, titre: d.titre, texte: d.texte, ton: tonValide(d.ton), mesure: d.mesure, bpm: d.bpm, base_id: d.base_id };
      ouvrir(temp.id, 'lire'); annoncer('Chant partagé avec toi. Mode Modifier : « Garder dans Mes chants ».');
    } catch (e) { annoncer('Ce partage ne se charge pas (' + (e.message || 'réseau') + ').'); }
  }

  /* ---------- Départ ---------- */
  const clavier = GP.Clavier($('#clavier'), { basse: 36, haut: 84, mains: true, zoom: !matchMedia('(min-width:1024px)').matches });
  peindreListe(); montrer('liste'); peindreCompte();
  const compte = K.configure ? K.demarrer().then(u => { peindreCompte(); if (u) synchroniser(); }, e => annoncer('Comptes indisponibles (' + e.message + ') : tes chants restent sur cet appareil.')) : Promise.resolve();
  chargerBase.then(() => { if (ecran === 'liste') peindreListe(); });
  Promise.all([chargerBase, compte]).then(lienRecu);
  GP.Live = { B, get BASE() { return BASE; }, ouvrir, choisirMode, etat: () => ({ ecran, onglet, mode, cur, decal, entendu, kEcrit, plat: plat.length, estBase }) };
})();
