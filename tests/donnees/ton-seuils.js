'use strict';
/* Réglage final de la Raison à réseau : température (calibration des probabilités) puis seuils de décision, sur la validation seulement.
   node tests/donnees/ton-seuils.js <dossier donnees> <modele.json> [autres modeles.json…]   écrit js/raison-poids.js (plusieurs modèles : ensemble, log-probabilités moyennées)
   Contrainte « les yeux fermés » : sur chaque variante de validation, « sûre » juste au moins PRECISION du temps. Sous cette contrainte,
   le plus de temps en bonne tonalité possible, et les modulations vues. Le test n'est jamais regardé ici.
   Les sorties du réseau ne dépendent pas des seuils : elles sont calculées une fois par note, puis seules les décisions sont rejouées. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = path.join(__dirname, '..', '..');
globalThis.GP = globalThis.GP || {}; require(path.join(R, 'js', 'theorie.js')); require(path.join(R, 'js', 'raison.js'));
const { mesurer, bilan, lireJeu, SOUS } = require('./eval-tonalite.js');
let PRECISION = .98; const STABILITE = .03; // un changement d'affichage par minute coûte autant que 3 points de temps en bonne tonalité

/* Log-sorties du réseau (température 1) pour chaque note d'un chant. */
function sorties(it, poids) {
  const r = new GP.Raison({ temperature: 1 }, poids);
  return it.notes.map(([midi, a, b]) => { r.note({ midi, debut: a, fin: b }); return Float64Array.from(r.la); });
}
const lse = v => { let m = -Infinity; for (const x of v) if (x > m) m = x; let s = 0; for (const x of v) s += Math.exp(x - m); return m + Math.log(s); };

/* Décisions rejouées sur les sorties gardées, avec la vraie logique de js/raison.js (_decider). */
function rejouer(it, cache, poids, params) {
  const r = new GP.Raison(params, poids), aff = [], T = params.temperature || 1;
  it.notes.forEach(([midi, a, b], i) => {
    const o = cache[i], z = lse(Array.from(o, x => x / T));
    for (let k = 0; k < 24; k++) r.la[k] = o[k] / T - z;
    const m = Math.round(midi), pc = ((m % 12) + 12) % 12;
    r.prec = { pc, midi: m, debut: a, w: 1 }; r.precFin = b;
    if (b - a >= .09) r._entendu(pc, b - a);
    const e = r._decider(b); if (e) aff.push([e.t, e.tonic, e.mode, e.etat]);
  });
  return mesurer(it, aff);
}
function perte(items, caches, T) {
  let L = 0, W = 0;
  items.forEach((it, j) => {
    const V = it.verite;
    it.notes.forEach(([midi, a, b], i) => {
      if (b < it.debut) return;
      let v = V[0]; for (const x of V) if (x[0] <= b + 1e-9) v = x;
      const o = caches[j][i], z = lse(Array.from(o, x => x / T)), w = Math.min(2, Math.max(.05, (it.notes[i + 1] ? it.notes[i + 1][1] : b + .5) - a));
      L -= w * (o[v[1] * 2 + (v[2] === 'maj' ? 0 : 1)] / T - z); W += w;
    });
  });
  return L / W;
}
/* Borne basse de la précision « sûre », affichée à côté de la moyenne : une erreur « sûre » dure souvent tout un chant, si bien que quelques chants
   décident de la moyenne. Les chants sont rééchantillonnés (B tirages, graine fixe), quantile q. Pas une contrainte : même en notes parfaites elle plafonne
   vers 97 %, faute d'étiquettes toutes justes (la moyenne exigée reste l'objectif réaliste). */
function bornePrecision(res, B = 200, q = .05) {
  let g = 12345; const alea = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
  const p = Array.from({ length: B }, () => bilan(res.map(() => res[Math.floor(alea() * res.length)])).precisionSure ?? 1).sort((a, b) => a - b);
  return p[Math.floor(q * B)];
}
{ // 20 chants d'une minute, un seul « sûr » faux de bout en bout : la moyenne vaut 95 %, la borne basse nettement moins ; tout juste, 100 %
  const r = ok => ({ duree: 60, juste: 60, sure: 60, sureJuste: ok ? 60 : 0, jusDes: 0, tSure: 0, finale: true, changes: 0, detecte: null });
  const res = Array.from({ length: 20 }, (_, i) => r(i > 0));
  assert(Math.abs(bilan(res).precisionSure - .95) < 1e-9 && bornePrecision(res) < .9 && bornePrecision(res.map(() => r(true))) === 1, 'borne basse');
}
function coordonnees(f, depart, grilles, tours = 2) {
  let best = { ...depart }, bv = f(best);
  for (let t = 0; t < tours; t++) for (const [k, vals] of Object.entries(grilles)) for (const v of vals) { if (v === best[k]) continue; const c = { ...best, [k]: v }, cv = f(c); if (cv < bv - 1e-6) { bv = cv; best = c; } }
  return { best, bv };
}

function main(dossier, fichiers, cible, depart) {
  const Ns = fichiers.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))), N = Ns[0], poids = Ns.length > 1 ? { reseaux: Ns, params: {} } : { reseau: N, params: {} };
  const noms = ['parfait', 'oreille', 'parole', 'modulation', 'concert', 'redecoupe', 'couplets', 'parole-longue', 'concert-audio'];
  const V = Object.fromEntries(noms.map(v => [v, lireJeu(dossier, 'validation-' + v)]));
  const C = Object.fromEntries(noms.map(v => [v, V[v].map(it => sorties(it, poids))]));
  // Contrôle : rejouer les décisions sur les sorties gardées donne exactement la même chose que le vrai js/raison.js.
  for (const [j, it] of V.parole.slice(0, 25).entries()) {
    const prm = { temperature: 1.3, pSure: .9 }, vrai = new GP.Raison(prm, poids), aff = [];
    for (const [midi, a, b] of it.notes) { const e = vrai.note({ midi, debut: a, fin: b }); if (e) aff.push([e.t, e.tonic, e.mode, e.etat]); }
    const x = JSON.stringify(mesurer(it, aff)), y = JSON.stringify(rejouer(it, C.parole[j], poids, prm));
    if (x !== y) throw new Error('rejeu différent du vrai décideur : ' + x + ' / ' + y);
  }
  // Calibration : la température qui minimise la perte de validation (un seul nombre).
  const tousI = noms.flatMap(v => V[v]), tousC = noms.flatMap(v => C[v]);
  let T = 1, bt = perte(tousI, tousC, 1);
  for (const t of [.5, .6, .7, .8, .9, 1.1, 1.25, 1.5, 1.75, 2, 2.5]) { const p = perte(tousI, tousC, t); if (p < bt) { bt = p; T = t; } }
  console.log(`température ${T} (perte de validation ${bt.toFixed(4)}, à température 1 : ${perte(tousI, tousC, 1).toFixed(4)})`);
  // La promesse « sûre » se juge là où la vérité est fiable (étiquette nette) ; le temps en bonne tonalité se compte sur tous les chants.
  const net = Object.fromEntries(noms.map(v => [v, V[v].map((it, i) => (SOUS['étiquette nette'](it) ? i : -1)).filter(i => i >= 0)]));
  const evalue = (prm, borne = false) => Object.fromEntries(noms.flatMap(v => { const res = V[v].map((it, j) => rejouer(it, C[v][j], poids, prm)), rn = net[v].map(i => res[i]); return [[v, bilan(res)], [v + ' net', { ...bilan(rn), borne: borne ? bornePrecision(rn) : null }]]; }));
  const objectif = p => {
    const r = evalue({ ...p, temperature: T }), pire = Math.min(...noms.map(v => r[v + ' net'].precisionSure ?? 1));
    const tj = noms.reduce((s, v) => s + r[v].tempsJuste, 0) / noms.length, couv = noms.reduce((s, v) => s + r[v].couvertureSure, 0) / noms.length;
    const chg = noms.reduce((s, v) => s + r[v].changesMin, 0) / noms.length; // changements d'affichage par minute : la stabilité compte
    return -(tj + .15 * (r.modulation.modDetectee ?? 0) + .05 * couv - STABILITE * chg) + (pire < PRECISION ? 5 * (PRECISION - pire) + .5 : 0);
  };
  const dep = { limite: 4.6, attenteMin: 2.5, pMontre: .6, dChange: .2, tenueChange: 1, pSure: .97, voixSure: 10, tenueSure: 10, pGarde: .6, nGarde: 3, pMod: .9, nMod: 3 };
  if (depart) { const p = JSON.parse(fs.readFileSync(depart, 'utf8').replace(/^[\s\S]*?raisonPoids = /, '').replace(/;\s*$/, '')).params; for (const k in dep) if (k in p) dep[k] = p[k]; console.log(`départ ${depart} : objectif ${objectif(dep).toFixed(4)}`); }
  const g ={ attenteMin: [1.5, 2.5, 3.5], pMontre: [.5, .6, .75, .9], dChange: [.05, .1, .2, .35, .5], tenueChange: [0, 1, 2, 4, 6], pSure: [.9, .95, .97, .985, .993, .998], voixSure: [3, 6, 10, 15, 20, 30], tenueSure: [0, 5, 10, 15, 20, 30], pMod: [.6, .75, .9, .97], nMod: [1, 2, 3, 5, 8], pGarde: [.3, .5, .6, .75, .9], nGarde: [1, 2, 3, 5] };
  const { best } = coordonnees(objectif, dep, g, 2), params = { ...best, temperature: T };
  console.log('seuils : ' + JSON.stringify(params));
  console.log(`objectif ${objectif(best).toFixed(4)}`);
  console.log('| validation | temps en bonne tonalité | juste dès | finale | « sûre » juste (borne basse) | « sûre » part du temps | sûre dès | modulation vue | changements par minute |\n|---|---|---|---|---|---|---|---|---|');
  const pc = x => (x == null || !isFinite(x) ? '-' : (100 * x).toFixed(1) + ' %'), r = evalue(params, true);
  for (const v of noms.flatMap(x => [x, x + ' net'])) { const b = r[v]; console.log(`| ${v} | ${pc(b.tempsJuste)} | ${b.jusDes.toFixed(1)} s | ${pc(b.finale)} | ${pc(b.precisionSure)}${b.borne != null ? ' (' + pc(b.borne) + ')' : ''} | ${pc(b.couvertureSure)} | ${isFinite(b.tSure) ? b.tSure.toFixed(1) + ' s' : 'jamais'} | ${b.modDetectee != null ? pc(b.modDetectee) + ' en ' + b.modDelai.toFixed(1) + ' s' : '-'} | ${b.changesMin.toFixed(2)} |`); }
  const r6 = x => Math.round(x * 1e6) / 1e6, propre = M => JSON.parse(JSON.stringify({ H: M.H, I: M.I, Wih: M.Wih, Whh: M.Whh, bih: M.bih, bhh: M.bhh, Wo: M.Wo, bo: M.bo, traits: M.traits }, (k, v) => (typeof v === 'number' ? r6(v) : v)));
  const sortie = { version: 2, date: new Date().toISOString().slice(0, 10), ...(Ns.length > 1 ? { reseaux: Ns.map(propre) } : { reseau: propre(N) }), params, apprentissage: { modeles: Ns.map(M => ({ H: M.H, version: M.traits.version || 1, perteValidation: M.perteVal, epoques: M.epoques.length })), temperature: T } };
  fs.writeFileSync(cible, '/* Généré par tests/donnees/ton_reseau.py puis tests/donnees/ton-seuils.js : réseau et seuils de la Raison apprise (js/raison.js). Ne pas éditer à la main. */\nglobalThis.GP = globalThis.GP || {};\nglobalThis.GP.raisonPoids = ' + JSON.stringify(sortie) + ';\n');
  console.log(`écrit ${cible} (${(fs.statSync(cible).size / 1024).toFixed(1)} Ko)`);
}

// --sortie <fichier> : écrire ailleurs que js/raison-poids.js (comparer plusieurs modèles en parallèle)
// --precision <p> : exiger plus que 98 % sur la validation, une marge pour des chants jamais vus
// --depart <raison-poids.js> : partir des seuils d'un réglage précédent (la recherche ne peut alors que faire mieux qu'eux)
if (require.main === module && process.argv[3]) {
  const a = process.argv.slice(2), k = a.indexOf('--sortie'), cible = k >= 0 ? a.splice(k, 2)[1] : path.join(R, 'js', 'raison-poids.js');
  const p = a.indexOf('--precision'); if (p >= 0) PRECISION = +a.splice(p, 2)[1];
  const d = a.indexOf('--depart'), depart = d >= 0 ? a.splice(d, 2)[1] : null;
  main(a[0], a.slice(1), cible, depart);
}
module.exports = { sorties, rejouer, bornePrecision };
