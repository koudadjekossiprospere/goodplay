'use strict';
/* Balayage rapide du verrouillage de tonalité. Le vrai _tonalite et le vrai _fixeTon, rejoués sur les notes déjà extraites : ni audio, ni accords à chaque essai.
   node tests/banc/balayage-tonalite.js                        grille par défaut, chants pairs, graine 1
   --grille '{"attenteMin":[3,4],"margeLock":[3,5]}'           grille de paramètres (produit cartésien)
   --jeux '[{"attenteMin":8},{}]'              jeux explicites, un par ligne ; le premier : l'ancienne attente fixe ; {} : le moteur tel quel
   --graines 1,3                                               plusieurs graines (pairs seulement)
   --controle                                                  impairs, graine 2 : pour lire un jeu déjà choisi, jamais pour régler
   --verifie                                                   le rejeu doit donner les mêmes tonalités que le moteur complet
   La première fois, mesure.js rend l'audio et garde les trames en cache. Voix synthétique : valeurs absolues optimistes. */
const fs = require('fs'), path = require('path');
const { SCENES, CORPUS, chantDe, executer, metriques, pool, CACHE } = require('../mesure.js');
const GP = globalThis.GP;

const SC = ['simple, studio', 'simple, salle', 'vocalises, salle'], BREF = { 'simple, studio': 'studio', 'simple, salle': 'salle', 'vocalises, salle': 'vocal.' };
const OBJ = { medMax: 5, justeMin: 87, chgMax: .2 };
const ficDe = j => path.join(CACHE, Buffer.from(j.scene).toString('hex').slice(0, 60) + '-' + j.idx + '-' + j.graine + '.json'); // même nom que mesure.js

/* Ce qui précède _tonalite ne dépend pas de la tonalité : on l'extrait une fois. */
function extrait(tr) {
  const m = new GP.Moteur({ sr: 16000 }), ev = [];
  m._tempo = () => {};
  m._tonalite = (e, d) => ev.push(['_tonalite', m.tNow, e, d]);
  m._noteBasse = b => ev.push(['_noteBasse', m.tNow, b]);
  for (const [t, md, cf, rms] of tr) m.hauteur(t, md, cf, rms);
  return ev;
}
function rejoue(c, evs, params) {
  const m = new GP.Moteur({ sr: 16000, reglages: { params } }), keys = []; let now = 0;
  m._refaire = () => {};
  m.on('tonalite', k => { const l = keys[keys.length - 1]; if (!l || l.tonic !== k.tonic || l.mode !== k.mode) keys.push({ t: now, tonic: k.tonic, mode: k.mode, isMod: k.modulation, correction: !!k.correction }); });
  for (const [fn, t, a, b] of evs) { now = t; m.tNow = t; m[fn](a, b); }
  return { keys };
}
function mesureUn(c, keys) {
  const r = metriques(c, { keys, chords: [], grille: [], notes: 1, corrPost: 0, corrigees: 0 }), d0 = c.notes[0].start;
  // Sur ces scènes sans modulation, tout changement de tonalité est vu par le musicien, marqué correction ou non.
  return { reel: r.lock == null ? null : r.lock - d0, ok: r.lockOk, chg: Math.max(0, keys.length - 1), fausses: r.fausses, tj: r.tempsJuste, tt: r.tempsTotal, tj0: r.tempsJuste, tt0: (c.duree - d0) / .25, sans: r.lock == null ? 1 : 0, mode: c.mode };
}
function cumul(l) {
  const v = l.filter(r => r.reel != null).map(r => r.reel).sort((a, b) => a - b), S = k => l.reduce((a, r) => a + r[k], 0);
  return { n: l.length, med: v[v.length >> 1], p90: v[Math.min(v.length - 1, Math.floor(v.length * .9))], ok: 100 * S('ok') / Math.max(1, v.length), chg: S('chg') / l.length, nchg: S('chg'), tj: 100 * S('tj') / S('tt'), tj0: 100 * S('tj0') / S('tt0'), fausses: S('fausses'), sans: S('sans') };
}
const f = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '-';
const cell = s => `${f(s.med).padStart(4)} ${f(s.p90).padStart(5)} ${f(s.ok, 0).padStart(4)} ${f(s.chg, 2).padStart(5)} ${f(s.tj, 0).padStart(4)} ${f(s.tj0, 0).padStart(4)} ${String(s.fausses).padStart(2)}`;
const ENTETE = `  ${SC.map(s => BREF[s].padEnd(32)).join(' | ')}\n  ${SC.map(() => ' med   p90  1er  corr  ton ton0 fm').join(' | ')}`;

async function main() {
  const A = process.argv.slice(2), arg = n => { const i = A.indexOf('--' + n); return i >= 0 ? A[i + 1] : null; }, controle = A.includes('--controle');
  const graines = controle ? [2] : (arg('graines') || '1').split(',').map(Number), idx = [...CORPUS.keys()].filter(i => i % 2 === (controle ? 1 : 0));
  const jobs = []; for (const graine of graines) for (const scene of SC) for (const i of idx) jobs.push({ partie: 'b', scene, idx: i, graine, trames: true, params: {}, variantes: ['base'] });
  const manque = jobs.filter(j => !fs.existsSync(ficDe(j)));
  if (manque.length) { console.log(`${manque.length} rendus à calculer...`); await pool(manque); }
  const t0 = Date.now(), donnees = jobs.map(j => { const tr = JSON.parse(fs.readFileSync(ficDe(j), 'utf8')); return { scene: j.scene, c: chantDe(j.graine, j.scene, j.idx), evs: extrait(tr), j, tr }; });

  if (A.includes('--verifie')) {
    const pars = JSON.parse(arg('jeux') || '[{}]')[0]; let n = 0;
    for (const d of donnees) { const a = rejoue(d.c, d.evs, pars).keys, b = executer(d.c, { tr: d.tr }, 'base', pars).keys; if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`rejeu différent : ${d.j.scene}, ${d.j.idx}\n${JSON.stringify(a)}\n${JSON.stringify(b)}`); n++; }
    console.log(`rejeu identique au moteur complet sur ${n} rendus`); return;
  }
  donnees.forEach(d => { delete d.tr; });
  const essai = p => { const par = {}; for (const d of donnees) (par[d.scene] = par[d.scene] || []).push(mesureUn(d.c, rejoue(d.c, d.evs, p).keys)); return Object.fromEntries(SC.map(s => [s, cumul(par[s])])); };

  let jeux = arg('jeux') && JSON.parse(arg('jeux'));
  if (!jeux) {
    const g = JSON.parse(arg('grille') || '{"attenteMin":[2.5,3,3.5,4,5],"notesLock":[3,4,5],"margeLock":[0,0.1,0.2,0.3,0.4,0.5,0.7,1,1.5,2],"bonusFin":[0.5,1,2],"attente":[6,8]}'); jeux = [{}];
    for (const k in g) jeux = jeux.flatMap(o => g[k].map(v => ({ ...o, [k]: v })));
  }
  const res = jeux.map(p => ({ p, s: essai(p) })), st = r => r.s[SC[0]];
  const tient = r => st(r).med <= OBJ.medMax && st(r).ok >= OBJ.justeMin && SC.every(s => r.s[s].chg <= OBJ.chgMax) && SC.every(s => !r.s[s].fausses);
  console.log(`${controle ? 'CONTRÔLE, impairs' : 'RÉGLAGE, pairs'}, graines ${graines}, ${donnees.length} rendus, ${jeux.length} jeux, ${((Date.now() - t0) / 1000).toFixed(0)} s. Temps en s réelles depuis la 1re note ; med et p90 ; 1er = % premiers verrous justes ; corr = changements visibles par chant ; ton = % juste depuis le verrou ; ton0 = depuis la 1re note ; fm = fausses modulations.`);
  const imprime = l => { console.log(ENTETE); l.forEach(r => console.log(`  ${SC.map(s => cell(r.s[s])).join(' | ')}  ${JSON.stringify(r.p)}${tient(r) ? '  OBJECTIF' : ''}`)); };
  if (jeux.length <= 40) { imprime(res); return; }
  // Courbe temps contre justesse : pour chaque premier verrou juste atteint en studio, le jeu le plus rapide qui reste sous le plafond de corrections.
  const score = r => SC.reduce((a, s) => a + r.s[s].ok, 0), ok = res.filter(tient).sort((a, b) => score(b) - score(a) || SC.reduce((x, s) => x + r0(a, s), 0) - SC.reduce((x, s) => x + r0(b, s), 0));
  function r0(r, s) { return r.s[s].med; }
  console.log(`\n${ok.length} jeux tiennent l'objectif en studio (médiane <= ${OBJ.medMax} s, 1ers verrous >= ${OBJ.justeMin} %, corrections <= ${OBJ.chgMax} par chant et 0 fausse modulation partout). Les meilleurs :`); imprime(ok.slice(0, 15));
  const fr = {}; for (const r of res) { if (!SC.every(s => r.s[s].chg <= OBJ.chgMax)) continue; const k = f(st(r).ok, 0); if (!fr[k] || st(r).med < st(fr[k]).med) fr[k] = r; }
  console.log('\nCourbe : le plus rapide en studio par niveau de premiers verrous justes (corrections <= plafond)'); imprime(Object.values(fr).sort((a, b) => st(a).med - st(b).med));
}
main().catch(e => { console.error(e); process.exit(1); });
