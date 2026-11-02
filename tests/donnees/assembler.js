'use strict';
/* Assemble le jeu d'entraînement de l'Intuition : contrôle de cohérence, familles d'airs (versions d'une même mélodie), découpage, rapport.
   node tests/donnees/assembler.js <dossier donnees>   (lit jeu/goodplay.jsonl s'il existe, jeu/openhymnal.jsonl, jeu/openewld.jsonl, jeu/pdmx.jsonl, brut/librivox/manifeste.json)
   Écrit jeu/entrainement.jsonl, jeu/validation.jsonl, jeu/test.jsonl, jeu/librivox-test.json, jeu/rapport.md.
   Découpage par famille : deux versions d'un même air ne sont jamais de part et d'autre. Le corpus de tests/ et les airs chantés
   dans LibriVox vont d'office au test, pour mesurer l'Intuition sur des chants qu'elle n'a jamais vus. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const B = require('../genere-base-hymnes.js');
globalThis.GP = globalThis.GP || {}; require('../../js/theorie.js');

const mod12 = x => ((x % 12) + 12) % 12, EPS = 1e-6;
const CONSONANCE_MIN = .5, SIM_FAMILLE = .8, VERSIONS_MAX = 3, PART_TEST = .1, PART_VALIDATION = .1, PART_MES_CHANTS = .3;
const TRIADES = { dim: [0, 3, 6], N: [], '5': [0, 7] };
const tonsAccord = q => TRIADES[q] || (GP.notesAccord ? GP.notesAccord(0, q) : [0, 4, 7]);

/* Part du temps chanté où la note appartient à l'accord indiqué : une étiquette décalée ou dans le mauvais ton tombe sous 0,5. */
function consonance(r) {
  let ok = 0, tout = 0, j = 0;
  for (const [h, t, d] of r.notes) {
    if (h === null) continue;
    while (j + 1 < r.accords.length && r.accords[j + 1][0] <= t + EPS) j++;
    const c = r.accords[j]; tout += d;
    if (c && t >= c[0] - EPS && t < c[0] + c[1] - EPS && tonsAccord(c[3]).map(i => mod12(i + c[2])).includes(mod12(h - r.ton.tonique))) ok += d;
  }
  return tout ? ok / tout : 0;
}

const intervallesDe = r => { const h = r.notes.filter(n => n[0] !== null).map(n => n[0]), o = []; for (let i = 1; i < h.length; i++) if (h[i] !== h[i - 1]) o.push(h[i] - h[i - 1]); return o; };

/* Familles : MinHash sur les 5-grammes d'intervalles pour trouver les paires candidates, puis LCS (le même alignement que la base) pour confirmer. */
function familles(recs) {
  const H = 32, BANDES = 8, R = H / BANDES, seeds = Array.from({ length: H }, (_, i) => (i + 1) * 2654435761 >>> 0);
  const hash = (s, seed) => { let h = seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const ivs = recs.map(intervallesDe), parent = recs.map((_, i) => i);
  const racine = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const seaux = new Map();
  ivs.forEach((iv, k) => {
    const sh = new Set(); for (let i = 0; i + 5 <= iv.length; i++) sh.add(iv.slice(i, i + 5).join(','));
    if (!sh.size) return;
    const sig = seeds.map(s => { let m = Infinity; for (const x of sh) { const v = hash(x, s); if (v < m) m = v; } return m; });
    for (let b = 0; b < BANDES; b++) { const cle = b + ':' + sig.slice(b * R, b * R + R).join('.'); if (!seaux.has(cle)) seaux.set(cle, []); seaux.get(cle).push(k); }
  });
  const vues = new Set();
  for (const l of seaux.values()) for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) {
    const a = l[x], b = l[y], cle = a < b ? a + ',' + b : b + ',' + a;
    if (vues.has(cle) || racine(a) === racine(b)) continue;
    vues.add(cle);
    const ia = ivs[a], ib = ivs[b], court = Math.min(ia.length, ib.length);
    if (court < 10 || court / Math.max(ia.length, ib.length) < .5) continue;
    if (B.aligner(ia, ib).length / court >= SIM_FAMILLE) parent[racine(a)] = racine(b);
  }
  return recs.map((_, i) => racine(i));
}

/* Hachage stable vers [0, 1) : FNV puis mélange final de MurmurHash3, sinon des clés voisines tombent dans les mêmes tranches. */
const fnv = s => {
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const normTitre = t => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\s*\d+\s*[-.:]\s*/, '').split(' - ')[0].replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|o|oh|a|le|la|les)\b/g, ' ').replace(/\s+/g, ' ').trim();

/* Corpus de tests/ (grilles simples écrites à la main, temps en noires) au format du jeu : il sert seulement au test. */
function corpusEnJeu(racineProjet) {
  const c = JSON.parse(fs.readFileSync(path.join(racineProjet, 'tests', 'corpus', 'chants.json'), 'utf8'));
  return c.map((s, i) => {
    let t = 0; const notes = s.notes.map(([h, d]) => { const n = [h, t, d, null, 0]; t += d; return n; });
    const fin = [...notes].reverse().find(n => n[0] !== null); if (fin) fin[4] = 1;
    let u = 0; const sq = s.basse.map(([deg, d]) => { const rel = GP.DEGRES[s.mode][deg][0], x = [u, d, deg, rel]; u += d; return x; });
    return { id: 'corpus-' + i, source: 'corpus goodplay (tests/corpus/chants.json)', licence: 'domaine public', droits: { statut: 'corpus', preuve: 'fiabilité ' + s.fiabilite }, style: ['cantique'], titre: s.titre, compositeur: '', ton: { tonique: s.tonique, mode: s.mode, modal: false }, mesure: [s.mesure, 4], bpm: s.bpm, notes, accords: sq.map(([t0, d, deg, rel]) => [t0, d, rel, GP.DEGRES[s.mode][deg][1], null]), squelette: sq, origine: 'grille simple', accordAnalyse: null, texture: null, phrases: 'aucune', marques: 0, alertes: [] };
  });
}

function main(dossier) {
  const racineProjet = path.join(__dirname, '..', '..'), J = path.join(dossier, 'jeu'), motifs = {};
  const lire = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  let recs = [...lire(path.join(J, 'goodplay.jsonl')), ...lire(path.join(J, 'openhymnal.jsonl')), ...lire(path.join(J, 'openewld.jsonl')), ...lire(path.join(J, 'pdmx.jsonl'))];
  const corpus = corpusEnJeu(racineProjet);
  recs = recs.filter(r => { r.consonance = +consonance(r).toFixed(3); if (r.consonance >= CONSONANCE_MIN) return true; motifs['étiquettes incohérentes avec la mélodie'] = (motifs['étiquettes incohérentes avec la mélodie'] || 0) + 1; return false; });
  for (const c of corpus) c.consonance = +consonance(c).toFixed(3);
  const tous = [...recs, ...corpus], fam = familles(tous);
  // Nom de famille : le plus petit identifiant de ses chants, stable d'une passe à l'autre tant que ce chant reste.
  const nom = new Map(); tous.forEach((r, i) => { const n = nom.get(fam[i]); if (!n || r.id < n) nom.set(fam[i], r.id); });
  tous.forEach((r, i) => { r.famille = 'fam-' + nom.get(fam[i]); });

  // Versions : au plus 3 par famille. Mes chants d'abord (ton répertoire, ta voix), puis Open Hymnal (droits les mieux établis), puis les accords écrits, puis la meilleure cohérence.
  const parFam = new Map();
  for (const r of tous) { if (!parFam.has(r.famille)) parFam.set(r.famille, []); parFam.get(r.famille).push(r); }
  const rang = r => (r.source.startsWith('corpus') ? 0 : r.origine === 'mes-chants' ? .5 : r.source.startsWith('Open Hymnal') ? 1 : r.origine === 'symboles' ? 2 : 3) - r.consonance / 10;
  const garde = [];
  for (const [f, l] of parFam) {
    l.sort((a, b) => rang(a) - rang(b));
    const g = l.filter(r => r.source.startsWith('corpus')).concat(l.filter(r => !r.source.startsWith('corpus')).slice(0, VERSIONS_MAX));
    for (const r of l) if (!g.includes(r)) motifs['version en trop dans sa famille'] = (motifs['version en trop dans sa famille'] || 0) + 1;
    for (const r of g) { r.versionsFamille = l.length; garde.push(r); }
  }

  // Airs chantés dans LibriVox : rapprochés par le titre, leur famille part au test.
  const manif = path.join(dossier, 'brut', 'librivox', 'manifeste.json'), pistes = fs.existsSync(manif) ? JSON.parse(fs.readFileSync(manif, 'utf8')) : [];
  const parTitre = new Map();
  for (const r of garde) { const k = normTitre(r.titre); if (k.length >= 4 && !parTitre.has(k)) parTitre.set(k, r); }
  // Titre identique, sinon l'un contient l'autre (10 lettres au moins : « Silent Night, Holy Night » et « Silent Night »).
  const cles = [...parTitre.keys()];
  const trouve = k => parTitre.get(k) || (k.length >= 10 ? parTitre.get(cles.find(c => c.length >= 10 && (c.startsWith(k) || k.startsWith(c)))) : null);
  const lv = pistes.map(p => { const k = normTitre(p.titre), r = trouve(k); return { ...p, cle: k, famille: r ? r.famille : null, chant: r ? r.id : null, titreJeu: r ? r.titre : null }; });
  const forces = new Set([...corpus.map(c => c.famille), ...lv.filter(p => p.famille).map(p => p.famille)]);

  // Mes chants : 30 % au test, sinon on ne mesurerait jamais le modèle sur ton répertoire ; pas de validation, ils sont trop rares.
  const part = r => (forces.has(r.famille) ? 'test' : r.origine === 'mes-chants' ? (fnv(r.famille) < PART_MES_CHANTS ? 'test' : 'entrainement')
    : fnv(r.famille) < PART_TEST ? 'test' : fnv(r.famille) < PART_TEST + PART_VALIDATION ? 'validation' : 'entrainement');
  const sorties = { entrainement: [], validation: [], test: [] };
  for (const r of garde) { r.partie = part(r); sorties[r.partie].push(r); }
  for (const [k, l] of Object.entries(sorties)) fs.writeFileSync(path.join(J, k + '.jsonl'), l.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(J, 'librivox-test.json'), JSON.stringify(lv.filter(p => p.famille), null, 1));
  fs.writeFileSync(path.join(J, 'rapport.md'), rapport(sorties, motifs, lv, tous.length));
  console.log(fs.readFileSync(path.join(J, 'rapport.md'), 'utf8'));
}

function rapport(S, motifs, lv, n0) {
  const L = [], all = Object.values(S).flat(), pc = (a, b) => (b ? (100 * a / b).toFixed(1) + ' %' : '-');
  const compte = (l, f) => { const o = {}; for (const r of l) for (const k of [].concat(f(r))) o[k] = (o[k] || 0) + 1; return o; };
  const table = (titre, f) => {
    const ks = [...new Set(all.flatMap(r => [].concat(f(r))))].sort();
    L.push(`\n### ${titre}\n\n| | ${ks.join(' | ')} |\n|---|${ks.map(() => '---|').join('')}`);
    for (const [p, l] of Object.entries(S)) { const c = compte(l, f); L.push(`| ${p} (${l.length}) | ${ks.map(k => c[k] || 0).join(' | ')} |`); }
  };
  L.push('# Jeu d\'entraînement de l\'Intuition : rapport\n', `Généré par tests/donnees/assembler.js. Chants avant familles : ${n0}. Gardés : ${all.length}, en ${new Set(all.map(r => r.famille)).size} familles d'airs.`);
  L.push('\nÉcartés à l\'assemblage :'); for (const [m, n] of Object.entries(motifs)) L.push(`- ${m} : ${n}`);
  table('Sources', r => r.source.split(' ')[0]);
  table('Styles', r => r.style);
  table('Mode', r => r.ton.mode + (r.ton.modal ? ' (modal)' : ''));
  table('Origine des accords', r => r.origine);
  table('Mesure', r => r.mesure.join('/'));
  table('Fins de phrase', r => r.phrases);
  const dureeS = r => { const q = r.notes.reduce((m, n) => Math.max(m, n[1] + n[2]), 0); return q * 60 / (r.bpm || 90); };
  L.push('\n### Volume\n\n| | chants | notes | heures (au tempo écrit, 90 à la noire sinon) | familles |\n|---|---|---|---|---|');
  for (const [p, l] of Object.entries(S)) L.push(`| ${p} | ${l.length} | ${l.reduce((s, r) => s + r.notes.filter(n => n[0] !== null).length, 0)} | ${(l.reduce((s, r) => s + dureeS(r), 0) / 3600).toFixed(1)} | ${new Set(l.map(r => r.famille)).size} |`);
  for (const mode of ['maj', 'min']) {
    const l = all.filter(r => r.ton.mode === mode), t = Array(8).fill(0); let tot = 0, chrom = 0;
    for (const r of l) for (const [, d, deg, rel] of r.squelette) { t[deg] += d; tot += d; if (!(mode === 'maj' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).includes(rel)) chrom += d; }
    L.push(`\n### Degrés du squelette, ${mode === 'maj' ? 'majeur' : 'mineur'} (part du temps, ${l.length} chants)\n\n| ${[1, 2, 3, 4, 5, 6, 7].join(' | ')} | chromatique |\n|---|---|---|---|---|---|---|---|\n| ${[1, 2, 3, 4, 5, 6, 7].map(d => pc(t[d], tot)).join(' | ')} | ${pc(chrom, tot)} |`);
  }
  const q = compte(all.flatMap(r => r.accords.map(a => a[3])), x => x), tq = Object.values(q).reduce((s, x) => s + x, 0);
  L.push('\n### Qualités d\'accords (nombre d\'accords)\n\n' + Object.entries(q).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${pc(n, tq)}`).join(', '));
  const rythme = all.map(r => { const bar = r.mesure[0] * 4 / r.mesure[1], tt = r.notes.reduce((m, n) => Math.max(m, n[1] + n[2]), 0); return r.squelette.length / (tt / bar); }).sort((a, b) => a - b);
  L.push(`\n### Qualité\n\n- Changements de degré du squelette par mesure : médiane ${rythme[rythme.length >> 1].toFixed(2)} (q10 ${rythme[Math.floor(.1 * rythme.length)].toFixed(2)}, q90 ${rythme[Math.floor(.9 * rythme.length)].toFixed(2)}).`);
  const cons = all.map(r => r.consonance).sort((a, b) => a - b);
  L.push(`- Cohérence mélodie et accord (part du temps chanté sur une note de l'accord) : médiane ${cons[cons.length >> 1]}, q10 ${cons[Math.floor(.1 * cons.length)]}.`);
  const aa = all.filter(r => r.accordAnalyse !== null && r.accordAnalyse !== undefined).map(r => r.accordAnalyse).sort((a, b) => a - b);
  if (aa.length) L.push(`- Accords écrits contre analyse des voix, sur les ${aa.length} partitions qui ont les deux : même fondamentale ${(100 * aa[aa.length >> 1]).toFixed(0)} % du temps (médiane). C'est l'ordre de grandeur du bruit des étiquettes tirées d'une harmonisation.`);
  const al = compte(all, r => r.alertes); L.push('- Alertes : ' + Object.entries(al).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' ; ') + '.');
  const st = compte(all, r => r.droits.statut); L.push('- Droits, nature de la preuve : ' + Object.entries(st).map(([k, n]) => `${k} ${n}`).join(', ') + '.');
  const lvOk = lv.filter(p => p.famille);
  L.push(`\n### Vraies voix (LibriVox)\n\n${lv.length} pistes, ${lvOk.length} rapprochées d'un air du jeu par le titre (leur famille est au test) :\n`);
  for (const p of lvOk) L.push(`- ${p.titre} → ${p.titreJeu} (${p.chant})`);
  return L.join('\n') + '\n';
}

{ // contrôles : la cohérence, les familles, le découpage
  const r = { ton: { tonique: 0 }, notes: [[60, 0, 1], [62, 1, 1], [null, 2, 1], [67, 3, 1]], accords: [[0, 2, 0, 'maj', null], [2, 2, 7, 'maj', null]] };
  assert.strictEqual(consonance(r), 2 / 3);
  const mel = (base, sauts) => ({ notes: sauts.reduce((l, s) => { l.push([l[l.length - 1][0] + s, 0, 1]); return l; }, [[base, 0, 1]]) });
  const s1 = [2, 2, 1, 2, -2, -1, -2, -2, 4, 3, -3, 5, -5, 2, 2, 1, -1, -2, 7, -7, 2, 2], s2 = [5, -3, -2, 4, 1, -1, 3, -3, 2, -4, 7, -7, 1, 1, 2, -2, 3, -1, -2, 5, -5, 2];
  const f = familles([mel(60, s1), mel(65, s1), mel(62, s1.slice(0, 20).concat([1, 1])), mel(60, s2)]);
  assert.ok(f[0] === f[1] && f[1] === f[2] && f[3] !== f[0], 'familles ' + f);
  assert.strictEqual(normTitre('Silent Night - Franz Gruber'), 'silent night');
  assert.strictEqual(normTitre('01 - Abide with Me'), 'abide with me');
}

if (require.main === module && process.argv[2]) main(process.argv[2]);
module.exports = { consonance, familles, normTitre };
