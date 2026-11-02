/* Voicing et doigtés enseignés (docs/recherche/doigtes.json). Sans DOM.
   Doigts : 1 = pouce, 5 = auriculaire. Chaque liste suit les notes de la plus grave à la plus aiguë, aux deux mains. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  if (!GP.mod && typeof require === 'function') require('./theorie.js');
  const { mod, Q } = GP;

  const ECARTS = { '1-2': [8, 10], '1-3': [10, 12], '1-4': [12, 14], '1-5': [13, 15], '2-3': [3, 5], '2-4': [5, 7], '2-5': [8, 10], '3-4': [2, 4], '3-5': [5, 7], '4-5': [3, 5] }; // [confort, max]
  const noire = m => [1, 3, 6, 8, 10].includes(mod(m));
  const miroir = (a, gauche) => gauche ? a.slice().reverse() : a;

  /* Décision par intervalles. voisin5 : l'intervalle qui touche l'auriculaire ; voisin1 : celui qui touche le pouce. */
  function doigter(midis, main) {
    const n = midis.length, g = main === 'g', iv = []; for (let i = 1; i < n; i++) iv.push(midis[i] - midis[i - 1]);
    if (n === 1) return [g ? 5 : 1];
    if (n === 2) { const d = iv[0], x = d <= 2 ? 2 : d <= 4 ? 3 : d === 5 ? 4 : 5; return g ? [x, 1] : [1, x]; }
    const v5 = g ? iv[0] : iv[n - 2], v1 = g ? iv[n - 2] : iv[0];
    if (n === 3) {
      if (v5 >= 5) return miroir([1, 2, 5], g);
      // Une seconde ferme la main : sur moins d'une quarte au total, le 5 ne vient pas.
      if (v5 >= 3) return miroir(v1 <= 2 ? [1, 2, 4] : [1, 3, 5], g);
      return miroir(v1 >= 5 ? [1, 4, 5] : v1 >= 3 ? [1, 3, 4] : [1, 2, 3], g);
    }
    if (n === 4) {
      if (v5 <= 2 || (iv[1] >= 4 && v1 <= 2)) return miroir([1, 2, 4, 5], g);
      return miroir(v1 >= 6 ? [1, 3, 4, 5] : [1, 2, 3, 5], g);
    }
    if (n === 5) return miroir([1, 2, 3, 4, 5], g);
    // Gamme à égrener, pas un accord plaqué : le pouce passe.
    const d = []; for (let i = 0; i < n; i++) d.push(i < n - 5 ? (i % 3) + 1 : 5 - (n - 1 - i));
    return g ? d.reverse() : d;
  }
  /* Plus grand dépassement par rapport au confort et par rapport au max, sur toutes les paires de doigts */
  function controleEcarts(midis, doigts) {
    let confort = 0, max = 0;
    for (let i = 0; i < midis.length; i++) for (let j = i + 1; j < midis.length; j++) {
      const a = Math.min(doigts[i], doigts[j]), b = Math.max(doigts[i], doigts[j]), e = ECARTS[a + '-' + b]; if (!e) continue;
      const d = Math.abs(midis[j] - midis[i]); confort = Math.max(confort, d - e[0]); max = Math.max(max, d - e[1]);
    }
    return { confort, max };
  }
  /* Le pouce et le 5 évitent les noires, sauf si tout l'accord est sur des noires. Valeurs de doigtes.json. */
  function coutTouches(midis, doigts) {
    if (midis.every(noire)) return 0;
    let c = 0;
    midis.forEach((m, i) => {
      if (!noire(m)) return;
      const blancheVoisine = (i > 0 && !noire(midis[i - 1])) || (i + 1 < midis.length && !noire(midis[i + 1]));
      if (doigts[i] === 1) c += blancheVoisine ? 3 : 2;
      else if (doigts[i] === 5 && blancheVoisine) c += 1; // plaqué, le pouce sur noire gêne plus que le 5 ; Parncutt donne 1-2 et 2, pour des notes successives
    });
    return c;
  }
  const alertes = (midis, doigts) => (!midis.every(noire) && midis.some((m, i) => doigts[i] === 1 && noire(m))) ? ['pouce-noire'] : [];

  /* Ce que joue la main droite : si la basse est à gauche, elle laisse tomber la fondamentale pour rester légère, et garde tierce, septième, couleurs. */
  function formeDroite(racine, q, basse) {
    let iv = Q[q].slice();
    if (q === 'add2') return [...new Set(iv.map(i => mod(racine + i)))].sort((a, b) => a - b); // add2 garde ses quatre notes, comme au catalogue : sans la tonique il ne se distingue plus de add9
    if (iv.length >= 4) iv = iv.filter(i => mod(racine + i) !== mod(basse));
    if (iv.length >= 4 && mod(racine) !== mod(basse)) iv = iv.filter(i => i !== 0);
    if (iv.length > 4) iv = iv.filter(i => i !== 7);
    return [...new Set(iv.map(i => mod(racine + i)))].sort((a, b) => a - b);
  }
  const distance = (a, b) => a.reduce((s, m) => s + Math.min(...b.map(x => Math.abs(x - m))), 0) / a.length;

  function placerDroite(pcs, prec, plancher) {
    let best = null;
    for (let r = 0; r < pcs.length; r++) {
      const seq = pcs.slice(r).concat(pcs.slice(0, r));
      for (let o = 52; o <= 74; o++) {
        if (mod(o) !== seq[0] || o < plancher) continue;
        let n = o; const notes = [n]; for (let i = 1; i < seq.length; i++) { n = n + 1 + mod(seq[i] - n - 1); notes.push(n); }
        if (notes[notes.length - 1] > 84) continue;
        const d = doigter(notes, 'd'), e = controleEcarts(notes, d); if (e.max > 0) continue;
        const centre = notes.reduce((a, b) => a + b, 0) / notes.length;
        // 1 point par demi-ton de déplacement moyen depuis l'accord précédent ; sans précédent, on vise le milieu du clavier.
        const cout = (prec && prec.length ? distance(notes, prec) : Math.abs(centre - 66) * .5) + coutTouches(notes, d) + Math.max(0, e.confort) + Math.max(0, 60 - centre) + Math.max(0, centre - 72) * .5;
        if (!best || cout < best.cout) best = { notes, d, cout };
      }
    }
    return best;
  }

  /* opts.prec : voicing précédent ; opts.niveau : 0 basse seule, 1 octave, 2 basse, quinte, octave ; opts.basse : classe de la note de gauche (slash). */
  function voicing(racine, q, opts = {}) {
    const { prec = null, niveau = 0, basse = racine } = opts;
    if (!Q[q]) throw new Error('qualité inconnue : ' + q);
    const pb = mod(basse);
    // Basse seule : de Mi2 à Ré♯3. Octave ou 1-5-8 : de Do2 à Si2, sinon le haut de la gauche pousse la droite hors de sa place. Une tierce n'y serait que de la boue.
    let b = niveau >= 1 ? 36 + mod(pb - 36) : 40 + mod(pb - 40);
    if (!niveau && prec && prec.mg && prec.mg.length) { const r = prec.mg[0]; while (b + 12 <= 55 && Math.abs(b + 12 - r) < Math.abs(b - r)) b += 12; while (b - 12 >= 36 && Math.abs(b - 12 - r) < Math.abs(b - r)) b -= 12; }
    const mg = niveau >= 2 ? [b, b + 7, b + 12] : niveau === 1 ? [b, b + 12] : [b];
    const rh = placerDroite(formeDroite(racine, q, pb), prec && prec.md, mg[mg.length - 1] + 1);
    const dg = doigter(mg, 'g');
    return { mg, md: rh.notes, dg, dd: rh.d, alertes: [...alertes(mg, dg), ...alertes(rh.notes, rh.d)] };
  }

  /* Place une forme du catalogue (demi-tons depuis la tonique) dans le registre de chaque main, sans la déformer. */
  function placerForme(accord, tonique, prec, retourner = false) {
    let rh = accord.rh.map(v => tonique + v).sort((a, b) => a - b); const lh = accord.lh.map(v => tonique + v).sort((a, b) => a - b);
    const large = lh[lh.length - 1] - lh[0], bas = large === 7 || large >= 12 ? 36 : 40; // quinte et octave restent claires plus bas ; une septième non
    let lo = lh[0]; while (lo < bas) lo += 12; while (lo >= bas + 12) lo -= 12;
    const mg = lh.map(v => v - lh[0] + lo);
    // Une tierce grave sonne mal : on remonte la main gauche au dessus de Do3.
    for (let i = 1; i < mg.length; i++) if (mg[i] - mg[i - 1] <= 4 && mg[i - 1] < 48) { for (let j = 0; j < mg.length; j++) mg[j] += 12; break; }
    const placer = rh => {
      let bo = null, bc = 1e9;
      for (let k = 2; k <= 7; k++) {
        const n = rh.map(v => v + 12 * k); if (n[0] <= mg[mg.length - 1] || n[0] < 52 || n[n.length - 1] > 88) continue;
        const c = prec && prec.length ? distance(n, prec) : Math.abs(n.reduce((a, x) => a + x, 0) / n.length - 67);
        if (c < bc) { bc = c; bo = n; }
      }
      return bo || rh.map(v => v + 12 * Math.ceil((mg[mg.length - 1] + 1 - rh[0]) / 12));
    };
    let bo = placer(rh);
    // Accord seul et serré : les noires choisissent le renversement. Dans une suite, on garde la forme, sinon la voix qui bouge n'est plus la bonne.
    if (retourner && rh.length === 3 && rh[2] - rh[0] < 12) for (let i = 0; i < 2 && alertes(bo, doigter(bo, 'd')).length; i++) { rh = [rh[1], rh[2], rh[0] + 12]; bo = placer(rh); }
    const dg = doigter(mg, 'g'), dd = doigter(bo, 'd');
    const al = [...alertes(mg, dg), ...alertes(bo, dd)]; if (bo.length <= 5 && controleEcarts(bo, dd).max > 0) al.push('ecart-droite'); if (mg.length <= 5 && controleEcarts(mg, dg).max > 0) al.push('ecart-gauche');
    return { mg, md: bo, dg, dd, alertes: al };
  }

  Object.assign(GP, { voicing, doigter, placerForme, controleEcarts, coutTouches, toucheNoire: noire });
})();
