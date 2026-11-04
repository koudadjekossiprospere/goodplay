'use strict';
/* Banc de tonalité : un « décideur » reçoit les notes une à une et affiche une tonalité ; on la compare à la vérité depuis le début du chant.
   node tests/donnees/eval-tonalite.js <dossier donnees> <moteur|raison> [partie=validation|test] [variantes séparées par des virgules]
   moteur : le GP.Moteur actuel, notes rejouées au rythme de ses tics. raison : GP.Raison (js/raison.js) nourrie directement des notes.
   Mesures, par chant puis en moyenne : temps en bonne tonalité, juste dès, finale juste, changements d'affichage, et surtout la promesse
   « les yeux fermés » : quand l'état est « sûre », part du temps où la tonalité est juste (précision) et part du temps passé « sûre » (couverture). */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = path.join(__dirname, '..', '..');
require(path.join(R, 'js', 'theorie.js')); require(path.join(R, 'js', 'moteur.js'));
const GP = globalThis.GP;
const GRACE_MOD = 8;
const mod12 = x => ((x % 12) + 12) % 12, med = a => { const s = [...a].filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/* Le moteur actuel : notes rejouées en hauteurs à 50 Hz, un peu de silence d'abord. Renvoie [[t, tonique, mode, état]]. */
function moteur(notes, params = {}) {
  const AV = .5, m = new GP.Moteur({ sr: 16000, reglages: { params } }), aff = [], fin = notes.length ? notes[notes.length - 1][2] + 1 : 0;
  m.on('tonalite', k => aff.push([k.t - AV, k.tonic, k.mode, k.etat || 'probable']));
  let j = 0;
  for (let t = .02; t <= fin + AV + 1e-9; t += .02) {
    const u = t - AV; while (j < notes.length && notes[j][2] < u) j++;
    const n = notes[j] && notes[j][1] <= u ? notes[j] : null;
    m.hauteur(t, n ? n[0] : null, n ? 1 : 0, n ? .05 : .001);
  }
  return aff;
}

/* GP.Raison : notes données à la fermeture de chaque note, comme le fera le moteur. */
function raison(notes, params = {}) {
  if (!GP.Raison) require(path.join(R, 'js', 'raison.js'));
  const r = new GP.Raison(params), aff = [];
  for (const [midi, debut, fin] of notes) { const e = r.note({ midi, debut, fin }); if (e) aff.push([e.t, e.tonic, e.mode, e.etat]); }
  return aff;
}

// apprise : le vrai moteur avec la Raison apprise branchée (ce que l'appli fera tourner).
// moteur : l'ancien calcul (profil), la référence, même depuis que la Raison apprise est le défaut.
const DECIDEURS = { moteur: (notes, params = {}) => moteur(notes, { raison: 'profil', ...params }), raison, apprise: (notes, params = {}) => moteur(notes, { raison: 'apprise', ...params }) };

/* Mesures d'un chant. aff : [[t, tonique, mode, état]] (chaque ligne vaut jusqu'à la suivante) ; verite : [[t, tonique, mode]]. */
function mesurer(item, aff) {
  const t0 = item.debut, fin = item.notes[item.notes.length - 1][2], V = item.verite;
  const vraieA = t => { let v = V[0]; for (const x of V) if (x[0] <= t + 1e-9) v = x; return v; };
  const coupes = [...new Set([t0, fin, ...aff.map(a => a[0]), ...V.map(v => v[0])])].filter(t => t >= t0 && t <= fin).sort((a, b) => a - b);
  let juste = 0, sure = 0, sureJuste = 0, jusDes = null, tSure = null;
  const affA = t => { let a = null; for (const x of aff) if (x[0] <= t + 1e-9) a = x; return a; };
  for (let i = 0; i + 1 < coupes.length; i++) {
    const a = coupes[i], b = coupes[i + 1], mil = (a + b) / 2, x = affA(mil), v = vraieA(mil), ok = x && x[1] === v[1] && x[2] === v[2];
    if (ok) { juste += b - a; if (jusDes === null) jusDes = a - t0; }
    // « Sûre » : les GRACE_MOD s qui suivent un vrai changement de tonalité ne comptent pas, personne ne l'entend à l'instant ; le délai est mesuré à part.
    const grace = V.some((v, k) => k > 0 && mil >= v[0] && mil < v[0] + GRACE_MOD);
    if (x && x[3] === 'sure' && !grace) { sure += b - a; if (ok) sureJuste += b - a; if (tSure === null) tSure = a - t0; }
  }
  const der = affA(fin), vf = vraieA(fin), okF = der && der[1] === vf[1] && der[2] === vf[2];
  const rel = der && der[2] !== vf[2] && mod12(der[1] - vf[1]) === (vf[2] === 'maj' ? 9 : 3), dom = der && der[2] === vf[2] && mod12(der[1] - vf[1]) === 7;
  const changes = aff.filter((x, i) => x[0] >= t0 && i > 0 && (x[1] !== aff[i - 1][1] || x[2] !== aff[i - 1][2])).length;
  let detecte = null, delai = null;
  if (V.length > 1) { const tm = V[1][0], k = aff.find(x => x[0] >= tm - 1e-9 && x[1] === V[1][1] && x[2] === V[1][2]); const avant = affA(tm); detecte = !!k || (avant && avant[1] === V[1][1] && avant[2] === V[1][2]); delai = k ? k[0] - tm : detecte ? 0 : null; }
  return { duree: fin - t0, juste, sure, sureJuste, jusDes, tSure, finale: !!okF, rel: !!rel, dom: !!dom, aucune: !der, changes, detecte, delai };
}

/* Chaque chant compte pour au plus PLAFOND s : un morceau de vingt minutes (il y en a) ne doit pas peser comme vingt chants. */
const PLAFOND = 180;
function bilan(res) {
  const n = res.length, f = r => Math.min(1, PLAFOND / Math.max(r.duree, 1e-9));
  const T = res.reduce((s, r) => s + f(r) * r.duree, 0), S = res.reduce((s, r) => s + f(r) * r.sure, 0);
  const o = {
    chants: n, tempsJuste: res.reduce((s, r) => s + r.juste / r.duree, 0) / n, jusDes: med(res.map(r => r.jusDes ?? Infinity)), finale: res.filter(r => r.finale).length / n,
    precisionSure: S ? res.reduce((s, r) => s + f(r) * r.sureJuste, 0) / S : null, couvertureSure: S / T, tSure: med(res.map(r => r.tSure ?? Infinity)),
    changes: res.reduce((s, r) => s + r.changes, 0) / n, changesMin: res.reduce((s, r) => s + r.changes * 60 / Math.max(r.duree, 30), 0) / n, relatif: res.filter(r => r.rel).length / n, dominante: res.filter(r => r.dom).length / n
  };
  const m = res.filter(r => r.detecte !== null);
  if (m.length) { o.modDetectee = m.filter(r => r.detecte).length / m.length; o.modDelai = med(m.map(r => r.delai ?? Infinity)); }
  return o;
}

const pc = x => (x == null || !isFinite(x) ? '-' : (100 * x).toFixed(1) + ' %'), s1 = x => (x == null || !isFinite(x) ? 'jamais' : x.toFixed(1) + ' s');
function ligne(nom, b) {
  return `| ${nom} | ${b.chants} | ${pc(b.tempsJuste)} | ${s1(b.jusDes)} | ${pc(b.finale)} | ${pc(b.precisionSure)} | ${pc(b.couvertureSure)} | ${s1(b.tSure)} | ${b.changes.toFixed(2)} | ${pc(b.relatif)} / ${pc(b.dominante)} | ${b.modDetectee != null ? pc(b.modDetectee) + ', ' + s1(b.modDelai) : '-'} |`;
}
const ENTETE = '| jeu | chants | temps en bonne tonalité | juste dès | finale juste | « sûre » : juste | « sûre » : part du temps | sûre dès | changements | finale relatif / dominante | modulation vue, délai |\n|---|---|---|---|---|---|---|---|---|---|---|';

const EGLISE = ['cantique', 'gospel', 'noel', 'spiritual'];
/* Tierce contredite : sur la première tonalité écrite, la mélodie tient plus longtemps la tierce de l'autre mode que la sienne (ré mineur écrit, fa dièse chanté, fa jamais).
   Le mode de l'étiquette n'est alors pas celui qu'on entend (mode juif « freygish », armure de convenance…). Indépendant de tout modèle. */
function tierceContredite(it) {
  const V = it.verite, fin = V.length > 1 ? V[1][0] : Infinity, d = new Array(12).fill(0);
  for (const [m, a, b] of it.notes) if (b >= it.debut && a < fin) d[mod12(Math.round(m) - V[0][1])] += b - a;
  const tot = d.reduce((s, x) => s + x, 0), sienne = V[0][2] === 'maj' ? d[4] : d[3], autre = V[0][2] === 'maj' ? d[3] : d[4];
  return autre > sienne && autre >= .02 * tot;
}
const SOUS = { 'église': it => (it.style || []).some(s => EGLISE.includes(s)), 'étiquette nette': it => !(it.alertes || []).some(a => /finale modale|mode écrit contredit/.test(a)) && !tierceContredite(it) };
function lireJeu(dossier, nom) { return fs.readFileSync(path.join(dossier, 'jeu', 'ton', nom + '.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); }

function evaluer(items, decideur, params) { return items.map(it => mesurer(it, decideur(it.notes, params))); }

function main(dossier, nomD, partie = 'validation', variantes = 'parfait,oreille,parole,modulation') {
  const d = DECIDEURS[nomD], out = {};
  console.log(`\n${nomD}, ${partie}\n` + ENTETE);
  for (const v of variantes.split(',')) {
    const items = v === 'vraies-voix' ? lireJeu(dossier, 'vraies-voix') : lireJeu(dossier, `${partie}-${v}`), res = evaluer(items, d), b = bilan(res);
    out[v] = b; console.log(ligne(v, b));
    // Sous-ensembles : chants d'église ; étiquette nette (ni finale modale, ni mode écrit contredit par la finale), où la vérité est fiable.
    for (const [nom, f] of Object.entries(SOUS)) { const idx = items.map((it, i) => (f(it) ? i : -1)).filter(i => i >= 0); if (idx.length && idx.length < items.length) { const bb = bilan(idx.map(i => res[i])); out[v + ' / ' + nom] = bb; console.log(ligne(`  ${v}, ${nom}`, bb)); } }
  }
  fs.writeFileSync(path.join(dossier, 'jeu', 'ton', `resultats-${nomD}-${partie}.json`), JSON.stringify(out, null, 1));
}

{ // affichage : rien pendant 2 s, puis Do faux (La mineur) « probable », puis Do majeur « sûre » à 6 s ; vérité Do majeur dès 0, fin à 10 s
  const it = { debut: 0, notes: [[60, 0, 10]], verite: [[0, 0, 'maj']] };
  const m = mesurer(it, [[2, 9, 'min', 'probable'], [6, 0, 'maj', 'sure']]);
  assert.strictEqual(m.juste, 4); assert.strictEqual(m.sure, 4); assert.strictEqual(m.sureJuste, 4); assert.strictEqual(m.jusDes, 6); assert.ok(m.finale); assert.strictEqual(m.changes, 1);
  const mm = mesurer({ debut: 0, notes: [[60, 0, 10]], verite: [[0, 0, 'maj'], [5, 2, 'maj']] }, [[1, 0, 'maj', 'sure'], [7, 2, 'maj', 'sure']]);
  assert.ok(mm.detecte); assert.strictEqual(mm.delai, 2); assert.strictEqual(mm.juste, 7);
}

if (require.main === module && process.argv[3]) main(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
module.exports = { mesurer, bilan, evaluer, lireJeu, moteur, raison, ligne, ENTETE, SOUS, tierceContredite };
