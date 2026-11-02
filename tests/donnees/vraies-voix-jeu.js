'use strict';
/* Jeu de test sur vraies voix : chaque piste LibriVox rapprochée d'un air du jeu passe dans la vraie oreille (js/moteur.js), puis ses notes sont calées
   sur la mélodie connue (alignement des intervalles, couplets répétés) pour donner à chaque note entendue le degré de basse attendu.
   node tests/donnees/vraies-voix-jeu.js <dossier donnees> [k n]   (lit jeu/librivox-test.json, jeu/test.jsonl, brut/librivox ; écrit jeu/vraies-voix/*.json)
   En parallèle : lancer k = 0 à n-1, puis une passe sans k ni n pour les calages et le bilan.
   Le PCM décodé est temporaire et effacé aussitôt. Vérité estimée par alignement, pas validée par une oreille humaine. */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), { spawnSync } = require('child_process');
const mod12 = x => ((x % 12) + 12) % 12, EPS = 1e-6;
// Fiable : la voix tient la note attendue au moins 70 % du temps chanté calé. Contrôle du 2 novembre 2026 : 71 pistes sur 151 passent,
// et aucun des 453 calages sur un chant pris au hasard (3 par piste) ; à 65 %, 3 témoins passaient déjà.
const COUPLETS_MAX = 8, ALIGNE_MIN = .7;

const fondre = notes => notes.reduce((o, n) => { const d = o[o.length - 1]; if (d && d.midi === n.midi && n.debut - d.fin < .08) d.fin = n.fin; else o.push({ ...n }); return o; }, []);

/* Cale les notes entendues (secondes) sur la mélodie du chant (noires), répétée en couplets : alignement temporel (DTW) entre la voix et la mélodie jouée
   à tempo régulier, en trames de 0,15 s, début et fin libres côté voix (annonce parlée, fin d'enregistrement). Chaque étirement du tempo coûte : sans cette
   contrainte, un alignement de notes (essayé d'abord, sur les intervalles puis sur les hauteurs) calait presque aussi bien un chant pris au hasard.
   On essaie les 3 transpositions les plus plausibles (histogrammes de classes de hauteur) et 1 à 8 couplets.
   Renvoie pour chaque note entendue la position dans le chant (t en noires, couplet), ou t null hors du passage calé ;
   part : trames chantées du passage où la voix tient la note attendue ; cout : coût moyen du chemin (0 parfait, 1 tout faux). */
const DT = .2, ETIRE = .35, BANDE = .3, SPQ_MIN = .25, SPQ_MAX = 1.5; // trame (s), coût d'un étirement, largeur de bande (part de la voix), noire entre 40 et 240 à la minute
const cout = (y, x) => (y === null && x === null ? .1 : y === null || x === null ? .6 : x === y ? 0 : (x - y + 12) % 12 === 1 || (y - x + 12) % 12 === 1 ? .5 : 1);
function caler(vues, chant) {
  const mel = chant.notes.filter(n => n[0] !== null), v = fondre(vues).filter(n => n.fin - n.debut >= .06);
  if (!v.length || !mel.length) return null;
  const t0 = v[0].debut, n = Math.ceil((v[v.length - 1].fin - t0) / DT), X = new Array(n).fill(null);
  for (const x of v) for (let c = Math.floor((x.debut - t0) / DT); c < Math.min(n, Math.ceil((x.fin - t0) / DT)); c++) X[c] = mod12(x.midi);
  const q = chant.notes.reduce((s, x) => Math.max(s, x[1] + x[2]), 0), hv = Array(12).fill(0), hm = Array(12).fill(0);
  for (const x of v) hv[mod12(x.midi)] += x.fin - x.debut;
  for (const x of mel) hm[mod12(x[0])] += x[2];
  const Ts = [...Array(12).keys()].map(T => [T, hm.reduce((s, w, pc) => s + w * hv[mod12(pc + T)], 0)]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  const bande = Math.max(20, Math.ceil(BANDE * n));
  let best = null;
  for (const T of Ts) for (let K = 1; K <= COUPLETS_MAX; K++) {
    const spq = n * DT / (K * q); // la voix chante K couplets sur toute sa durée : point de départ, le chemin s'étire au besoin
    if (spq < SPQ_MIN || spq > SPQ_MAX) continue;
    const m = Math.ceil(K * q * spq / DT), Y = new Array(m), pos = new Array(m);
    for (let r = 0; r < m; r++) {
      const tq = (r + .5) * DT / spq, k = Math.floor(tq / q), u = tq - k * q, note = chant.notes.find(x => u >= x[1] && u < x[1] + x[2]);
      Y[r] = note && note[0] !== null ? mod12(note[0] + T) : null; pos[r] = { couplet: k, t: u };
    }
    // DTW, lignes = mélodie (entière), colonnes = voix (début et fin libres)
    const Dc = new Float32Array(m * n).fill(Infinity), L = new Uint16Array(m * n), P = new Uint8Array(m * n);
    for (let r = 0; r < m; r++) for (let c = Math.max(0, Math.floor(r * n / m) - bande); c < Math.min(n, Math.ceil(r * n / m) + bande); c++) {
      const k = r * n + c, e = cout(Y[r], X[c]);
      if (r === 0) { Dc[k] = e; L[k] = 1; continue; }
      let b = Dc[k - n - 1] + e, l = L[k - n - 1] + 1, p = 1;
      if (c === 0) { b = Infinity; }
      const up = Dc[k - n] + e + ETIRE, left = c > 0 ? Dc[k - 1] + e + ETIRE : Infinity;
      if (up < b) { b = up; l = L[k - n] + 1; p = 2; }
      if (left < b) { b = left; l = L[k - 1] + 1; p = 3; }
      Dc[k] = b; L[k] = l; P[k] = p;
    }
    let cf = 0; for (let c = 1; c < n; c++) if (Dc[(m - 1) * n + c] / L[(m - 1) * n + c] < Dc[(m - 1) * n + cf] / L[(m - 1) * n + cf]) cf = c;
    const moy = Dc[(m - 1) * n + cf] / L[(m - 1) * n + cf];
    if (!best || moy < best.moy) best = { moy, T, K, m, n, P, Y, X, pos, cf };
  }
  if (!best) return null;
  // Chemin : pour chaque trame de voix, la trame de mélodie calée.
  const { P, pos, Y, m, cf, T, K } = best, cal = new Array(n).fill(-1);
  let r = m - 1, c = cf, chantees = 0, tenues = 0;
  while (r >= 0 && c >= 0) {
    if (cal[c] < 0) { cal[c] = r; if (X[c] !== null && Y[r] !== null) { chantees++; if (X[c] === Y[r]) tenues++; } }
    if (r === 0) break;
    const p = P[r * n + c]; if (p === 1) { r--; c--; } else if (p === 2) r--; else c--;
  }
  const notes = v.map(x => { const c0 = Math.min(n - 1, Math.floor(((x.debut + x.fin) / 2 - t0) / DT)), rr = cal[c0]; return rr < 0 ? { ...x, t: null } : { ...x, ...pos[rr] }; });
  return { notes, couplets: K, transpose: T > 5 ? T - 12 : T, part: chantees ? tenues / chantees : 0, cout: best.moy };
}

const degreA = (sq, t) => { for (const c of sq) if (t >= c[0] - EPS && t < c[0] + c[1] - EPS) return c; return sq[sq.length - 1]; };

/* k sur n : ce processus traite une piste sur n (décodage en parallèle) ; la passe 0 sur 1 refait seulement les calages et le bilan. */
function main(dossier, k = 0, n = 1) {
  const { ecouter } = require('../vraies-voix.js');
  const J = path.join(dossier, 'jeu'), pistes = JSON.parse(fs.readFileSync(path.join(J, 'librivox-test.json'), 'utf8')).filter((_, i) => i % n === k);
  const chants = new Map(fs.readFileSync(path.join(J, 'test.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.id, r]));
  const sortie = path.join(J, 'vraies-voix'), tmp = path.join(os.tmpdir(), `goodplay-pcm-${k}.f32`), bilan = [];
  fs.mkdirSync(sortie, { recursive: true });
  for (const p of pistes) {
    const cible = path.join(sortie, p.id.replace(/\//g, '__') + '.json'), chant = chants.get(p.chant);
    if (!chant) { bilan.push({ id: p.id, motif: 'chant absent du test' }); continue; }
    if (!fs.existsSync(cible)) {
      const d = spawnSync(process.execPath, [path.join(__dirname, '..', 'decode-pcm.js'), path.join(dossier, 'brut', 'librivox', p.fichier), tmp], { encoding: 'utf8', timeout: 300000 });
      if (d.status !== 0 || !fs.existsSync(tmp)) { bilan.push({ id: p.id, motif: 'décodage impossible' }); continue; }
      const b = fs.readFileSync(tmp), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), r = ecouter(x, 48000);
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(cible, JSON.stringify({ id: p.id, titre: p.titre, lecteur: p.lecteur, chant: p.chant, famille: p.famille, duree: +(x.length / 48000).toFixed(2), accordage: +r.m.accordage.toFixed(3),
        notes: r.ev.note.map(e => [Math.round(e.midi), +e.debut.toFixed(3), +e.fin.toFixed(3)]), tonalites: r.ev.tonalite.map(k => [+k.t.toFixed(2), k.tonic, k.mode]) }));
    }
    const vv = JSON.parse(fs.readFileSync(cible, 'utf8'));
    const c = caler(vv.notes.map(([midi, debut, fin]) => ({ midi, debut, fin })), chant);
    if (!c) { bilan.push({ id: p.id, motif: 'aucun alignement' }); continue; }
    vv.verite = {
      tonique: mod12(chant.ton.tonique + c.transpose), mode: chant.ton.mode, couplets: c.couplets, partAlignee: +c.part.toFixed(3), fiable: c.part >= ALIGNE_MIN,
      // une ligne par note entendue (notes répétées fondues) : midi, début, fin, degré attendu (null si la note n'est pas calée), fondamentale relative
      notes: c.notes.map(n => { const s = n.t === null ? null : degreA(chant.squelette, n.t); return [n.midi, +n.debut.toFixed(3), +n.fin.toFixed(3), s ? s[2] : null, s ? s[3] : null]; })
    };
    fs.writeFileSync(cible, JSON.stringify(vv));
    bilan.push({ id: p.id, titre: p.titre, notes: vv.notes.length, couplets: c.couplets, part: c.part, fiable: vv.verite.fiable });
  }
  const ok = bilan.filter(b => b.fiable);
  console.log(`pistes ${pistes.length}, calées de façon fiable (voix sur la note attendue au moins ${100 * ALIGNE_MIN} % du temps) : ${ok.length}`);
  for (const b of bilan) console.log(`  ${b.id} : ${b.motif || `${b.notes} notes, ${b.couplets} couplets, ${(100 * b.part).toFixed(0)} % calées`}`);
  if (n === 1) fs.writeFileSync(path.join(J, 'vraies-voix', 'bilan.json'), JSON.stringify(bilan, null, 1));
}

{ // une mélodie chantée deux fois, une tierce plus haut, au tempo du chant, avec une note parasite : le calage retrouve les couplets, la transposition, la position
  const chant = { notes: [[60, 0, 1], [62, 1, 1], [64, 2, 1], [65, 3, 1], [67, 4, 2], [65, 6, 1], [64, 7, 1], [62, 8, 1], [60, 9, 2]].map(n => [...n, 0, 0]) };
  const vues = [];
  for (let k = 0; k < 2; k++) for (const [h, t, d] of chant.notes) vues.push({ midi: h + 4, debut: (k * 11 + t) * .5, fin: (k * 11 + t + d) * .5 - .05 });
  vues.splice(14, 0, { midi: 75, debut: 7.9, fin: 7.98 });
  const c = caler(vues, chant);
  assert.strictEqual(c.transpose, 4); assert.strictEqual(c.couplets, 2); assert.ok(c.part > .8, c.part);
  assert.ok(Math.abs(c.notes[4].t - 5) < 1, c.notes[4].t); assert.strictEqual(c.notes[c.notes.length - 1].couplet, 1);
  // une autre mélodie, sans rapport, se cale mal
  const autre = { notes: [[60, 0, 2], [67, 2, 1], [66, 3, 1], [61, 4, 2], [70, 6, 3], [63, 9, 2]].map(n => [...n, 0, 0]) };
  assert.ok(caler(vues, autre).cout > c.cout + .2, 'autre ' + caler(vues, autre).cout + ' vrai ' + c.cout);
}

if (require.main === module && process.argv[2]) main(process.argv[2], +(process.argv[3] || 0), +(process.argv[4] || 1));
module.exports = { caler };
