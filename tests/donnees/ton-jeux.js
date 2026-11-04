'use strict';
/* Jeux de tonalité : les chants du jeu d'entraînement deviennent des suites de notes (secondes) avec la tonalité vraie au fil du temps.
   Variantes : parfait, oreille (profil mesuré sur vocadito), concert (la basse du piano mêlée à la voix, comme l'oreille l'entend en concert simulé), parole (vraie parole LibriVox
   vue par l'oreille, avant le chant), modulation (le chant repris un demi-ton ou un ton plus haut, « le lead monte »).
   node tests/donnees/ton-jeux.js <dossier donnees>   écrit jeu/ton/{validation,test}-<variante>.jsonl et jeu/ton/vraies-voix.jsonl, figés (graines fixes).
   La parole d'entraînement, de validation et de test vient de pistes différentes : jamais la même voix des deux côtés.
   Une ligne : { id, famille, style, debut (début du chant, s), notes: [[midi, début, fin]], verite: [[t, tonique, mode]] }. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { simuler, PROFIL } = require('./oreille-simulee.js');
const { enSecondes } = require('./exemples.js');
const mod12 = x => ((x % 12) + 12) % 12;

function hasard(graine) { let a = graine >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* Parole : notes de l'oreille avant le chant, dans les pistes LibriVox déjà passées dans l'oreille. Début du chant : la première note calée (pistes fiables),
   sinon trois notes tenues (400 ms) en 5 s, comme tests/banc/vraies-voix-libres.js. Renvoie { entrainement, validation, test } : listes de segments [[midi, d, f]]. */
const debutChant = notes => { const t = notes.filter(e => e[2] - e[1] >= .4); for (let i = 0; i + 2 < t.length; i++) if (t[i + 2][1] - t[i][1] <= 5) return t[i][1]; return null; };
function paroles(dossier) {
  const dir = path.join(dossier, 'jeu', 'vraies-voix'), out = { entrainement: [], validation: [], test: [] };
  if (!fs.existsSync(dir)) return out;
  const fichiers = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'bilan.json').sort();
  fichiers.forEach((f, i) => {
    const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), fiable = v.verite && v.verite.fiable;
    // La parole s'arrête au premier passage chanté, même avant la note calée : certaines pistes chantent d'abord un autre couplet ou un prélude
    // (« Abide with me » : 68 s de notes tenues avant la note calée). Sans cette règle, la variante parole du test contenait du chant.
    const t0 = fiable ? Math.min(v.verite.notes.find(n => n[3] !== null)[1], debutChant(v.notes) ?? Infinity) : debutChant(v.notes);
    if (t0 == null || t0 < 4) return;
    const seg = v.notes.filter(n => n[2] < t0 - .3).map(([m, a, b]) => [m, +a.toFixed(3), +b.toFixed(3)]);
    if (seg.length < 5) return;
    // Les pistes fiables servent au test (leur chant y est jugé) ; les autres se partagent entre entraînement et validation.
    (fiable ? out.test : i % 3 === 0 ? out.validation : out.entrainement).push({ id: v.id, notes: seg, duree: t0 });
  });
  // Livres audio LibriVox (tests/donnees/source-parole.js) : découpés en segments de 10 à 25 s, répartis par lecteur (60 / 20 / 20 %).
  const dp = path.join(dossier, 'brut', 'parole');
  if (fs.existsSync(dp)) for (const f of fs.readdirSync(dp).filter(f => f.endsWith('.json')).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(dp, f), 'utf8')), u = hacher(p.lecteur), r = hasard(Math.floor(u * 2 ** 31) + 1);
    const part = u < .6 ? out.entrainement : u < .8 ? out.validation : out.test, n = p.notes;
    for (let i = 0, k = 0; i < n.length; k++) {
      const t0 = n[i][1], long = 10 + 15 * r(); let j = i; while (j < n.length && n[j][2] - t0 <= long) j++;
      if (j - i >= 5) { const seg = n.slice(i, j).map(([m, a, b]) => [m, +(a - t0 + .2).toFixed(3), +(b - t0 + .2).toFixed(3)]); part.push({ id: `${f}#${k}`, notes: seg, duree: seg[seg.length - 1][2], lecteur: p.lecteur, langue: p.langue }); }
      i = Math.max(j, i + 1);
    }
  }
  return out;
}
/* Une longue annonce (un pasteur parle une ou deux minutes avant le cantique) : segments de la même partie mis bout à bout jusqu'à cible secondes.
   Le test l'a montré : sans annonces longues à l'entraînement (5 segments sur 652 dépassaient 45 s), la Raison finissait par se croire « sûre » pendant la parole. */
function longue(pool, r, cible) {
  const notes = []; let t = 0;
  while (t < cible) { const p = pool[Math.floor(r() * pool.length)]; notes.push(...p.notes.map(([m, a, b]) => [m, +(a + t).toFixed(3), +(b + t).toFixed(3)])); t += p.duree + .6 + r(); }
  return { id: 'longue', notes, duree: t };
}
const hacher = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };

/* Ce que la Raison reçoit quand le vrai moteur redécoupe ces notes (notes très brèves ou collées fondues, basse aiguillée) : rejouées en hauteurs à 50 Hz.
   Sert à rendre le réseau robuste au découpage : un rejeu de notes déjà découpées en perdait 15 % et faisait chuter la variante parole de 73 à 59 %. */
function redecouper(notes) {
  const GP = globalThis.GP; if (!GP || !GP.Moteur) require('../../js/moteur.js');
  const AV = .5, m = new globalThis.GP.Moteur({ sr: 16000, reglages: { params: { raison: 'apprise' } } }), recus = [];
  if (!m.R) throw new Error('Raison apprise absente : js/raison-poids.js manque');
  m.R.note = e => { recus.push({ midi: e.midi, debut: e.debut - AV, fin: e.fin - AV }); return null; };
  const fin = notes.length ? notes[notes.length - 1].fin + 1 : 0; let j = 0;
  for (let t = .02; t <= fin + AV + 1e-9; t += .02) {
    const u = t - AV; while (j < notes.length && notes[j].fin < u) j++;
    const n = notes[j] && notes[j].debut <= u ? notes[j] : null;
    m.hauteur(t, n ? n.midi : null, n ? 1 : 0, n ? .05 : .001);
  }
  return recus;
}

/* Une variante d'un chant : notes [[midi, début, fin]] et vérité [[t, tonique, mode]]. redecoupe : passer le résultat dans le découpage du moteur. */
function variante(rec, sorte, opts = {}) {
  const v = variante0(rec, sorte, opts);
  return opts.redecoupe ? { ...v, notes: redecouper(v.notes) } : v;
}
function variante0(rec, sorte, { graine = 1, parole = null, parole2 = null, facteur = 1, demi = 0 } = {}) {
  const r = hasard(graine), ton = rec.ton;
  let { notes } = enSecondes(rec, facteur);
  if (sorte === 'couplets') {
    // Comme à l'église : une annonce, trois couplets (l'oreille les entend chaque fois un peu autrement), parfois une parole entre le 2e et le 3e.
    const vers = notes[notes.length - 1].fin + 1.2 + r(), out = [];
    let t = parole ? parole.duree + .5 + r() * 1.5 : 0; const debut = t;
    if (parole) out.push(...parole.notes.map(([midi, a, b]) => ({ midi, debut: a, fin: b })));
    for (let c = 0; c < 3; c++) {
      if (c === 2 && parole2 && r() < .5) { out.push(...parole2.notes.map(([midi, a, b]) => ({ midi, debut: a + t, fin: b + t }))); t += parole2.duree + 1; }
      out.push(...simuler(notes, PROFIL, graine + 101 * c).map(n => ({ ...n, debut: n.debut + t, fin: n.fin + t })));
      t += vers;
    }
    return { notes: out, verite: [[debut, ton.tonique, ton.mode]], debut };
  }
  if (sorte === 'modulation') {
    const fin = notes[notes.length - 1].fin + .8, d = demi || (r() < .5 ? 1 : 2);
    notes = notes.concat(notes.map(n => ({ midi: n.midi + d, debut: n.debut + fin, fin: n.fin + fin })));
    const vues = simuler(notes, PROFIL, graine);
    return { notes: vues, verite: [[0, ton.tonique, ton.mode], [fin, mod12(ton.tonique + d), ton.mode]], debut: 0 };
  }
  if (sorte === 'concert') {
    // L'oreille entend tantôt la voix, tantôt la basse du piano (tests/donnees/concert.js : 14 à 58 % de basse selon le niveau du piano).
    const pB = .1 + .5 * r(), s = 60 / ((rec.bpm || 90) * facteur), flux = [];
    const accA = q => { for (const a of rec.accords) if (q >= a[0] - 1e-6 && q < a[0] + a[1] - 1e-6) return a; return null; };
    for (const n of notes) {
      const a = accA(n.debut / s);
      if (a && r() < pB) {
        const b = 36 + mod12(ton.tonique + (a[4] == null ? a[2] : a[4])), d = flux[flux.length - 1];
        if (d && d.basse && d.midi === b && n.debut - d.fin < .3) d.fin = n.fin; else flux.push({ midi: b, debut: n.debut, fin: n.fin, basse: true });
      } else flux.push({ ...n });
    }
    return { notes: simuler(flux, PROFIL, graine), verite: [[0, ton.tonique, ton.mode]], debut: 0 };
  }
  let vues = sorte === 'parfait' ? notes.map(n => ({ ...n })) : simuler(notes, PROFIL, graine), debut = 0;
  if (sorte === 'parole' && parole) {
    debut = parole.duree + .5 + r() * 1.5;
    vues = parole.notes.map(([midi, a, b]) => ({ midi, debut: a, fin: b })).concat(vues.map(n => ({ ...n, debut: n.debut + debut, fin: n.fin + debut })));
  }
  return { notes: vues, verite: [[debut, ton.tonique, ton.mode]], debut };
}

const SORTES = ['parfait', 'oreille', 'parole', 'modulation', 'concert', 'redecoupe', 'couplets', 'parole-longue'];
function main(dossier, seules = SORTES) {
  const J = path.join(dossier, 'jeu'), dst = path.join(J, 'ton'), P = paroles(dossier);
  fs.mkdirSync(dst, { recursive: true });
  console.log(`parole : ${P.entrainement.length} segments d'entraînement, ${P.validation.length} de validation, ${P.test.length} de test`);
  // redecoupe : l'oreille simulée repassée dans le découpage du moteur (contrôle de robustesse, comme un autre téléphone découperait autrement)
  // parole-longue : une annonce de 45 s à 2 min 30 avant le chant
  for (const partie of ['validation', 'test']) {
    const recs = fs.readFileSync(path.join(J, partie + '.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)), pp = P[partie];
    for (const sorte of SORTES.filter(s => seules.includes(s))) {
      const lignes = recs.map((rec, i) => {
        const g = 7919 * (i + 1) + SORTES.indexOf(sorte), rl = hasard(g + 13);
        const v = sorte === 'redecoupe' ? variante(rec, 'oreille', { graine: 7919 * (i + 1) + 1, redecoupe: true })
          : sorte === 'parole-longue' ? variante(rec, 'parole', { graine: g, parole: longue(pp, rl, 45 + 105 * rl()) })
          : variante(rec, sorte, { graine: g, parole: pp.length ? pp[i % pp.length] : null, parole2: pp.length ? pp[(i * 7 + 3) % pp.length] : null });
        return JSON.stringify({ id: rec.id, famille: rec.famille, style: rec.style, origine: rec.origine, alertes: rec.alertes, debut: +v.debut.toFixed(3), notes: v.notes.map(n => [n.midi, +n.debut.toFixed(3), +n.fin.toFixed(3)]), verite: v.verite.map(([t, k, m]) => [+t.toFixed(3), k, m]) });
      });
      fs.writeFileSync(path.join(dst, `${partie}-${sorte}.jsonl`), lignes.join('\n') + '\n');
      console.log(`${partie}-${sorte} : ${lignes.length} chants`);
    }
  }
  fs.writeFileSync(path.join(dst, 'paroles.json'), JSON.stringify(P));
  if (seules !== SORTES) return; // seulement quelques variantes : vraies voix inchangées
  // Vraies voix : l'enregistrement entier, annonce comprise ; le chant commence à la première note calée.
  const dir = path.join(J, 'vraies-voix'), vv = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'bilan.json').sort()) {
    const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (!v.verite || !v.verite.fiable) continue;
    vv.push(JSON.stringify({ id: v.id, famille: v.famille, style: ['vraie voix'], debut: v.verite.notes.find(n => n[3] !== null)[1], notes: v.notes, verite: [[v.verite.notes.find(n => n[3] !== null)[1], v.verite.tonique, v.verite.mode]], tonalitesMoteur: v.tonalites }));
  }
  fs.writeFileSync(path.join(dst, 'vraies-voix.jsonl'), vv.join('\n') + '\n');
  console.log(`vraies voix : ${vv.length}`);
}

{ // une modulation d'un ton : la vérité change au début de la reprise, transposée
  const rec = { ton: { tonique: 0, mode: 'maj' }, bpm: 60, notes: [[60, 0, 1], [62, 1, 1], [64, 2, 2]], squelette: [[0, 4, 1, 0]] };
  const v = variante(rec, 'modulation', { demi: 2, graine: 3 });
  assert.deepStrictEqual(v.verite, [[0, 0, 'maj'], [4.8, 2, 'maj']]);
  const p = variante(rec, 'parole', { parole: { notes: [[50, 0, .1], [52, .2, .3]], duree: 1 }, graine: 2 });
  assert.ok(p.debut >= 1.5 && p.notes[0].midi === 50 && p.verite[0][0] === p.debut);
  const l = longue([{ notes: [[50, .2, .4]], duree: 10 }], hasard(1), 45);
  assert.ok(l.duree >= 45 && l.notes.length === 5 && l.notes.every((n, i) => !i || n[1] > l.notes[i - 1][2]));
}

// node tests/donnees/ton-jeux.js <dossier> [variante,variante…] : toutes par défaut
if (require.main === module && process.argv[2]) main(process.argv[2], process.argv[3] ? process.argv[3].split(',') : SORTES);
module.exports = { variante, paroles, hasard, redecouper, longue };
